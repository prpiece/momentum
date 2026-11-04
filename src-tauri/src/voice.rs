//! Voice quick-add (PLAN D81): the opt-in Parakeet model download, microphone capture and
//! on-device transcription. The download is the only network call besides the update check.
use serde::Serialize;
use sha2::{Digest, Sha256};
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineTransducerModelConfig};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

/// Parakeet TDT 0.6B v2 (English), int8 sherpa-onnx build. Pinned: a changed file fails the hash.
const MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2";
const MODEL_SHA256: &str = "157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad";
const MODEL_BYTES: u64 = 482_468_385;
/// The archive's top folder, and the files the recognizer needs from it.
const ARCHIVE_DIR: &str = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8";
const MODEL_FILES: [&str; 4] = ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"];
/// A stuck hotkey must not record forever.
const MAX_SECONDS: usize = 120;

/// What Settings → Voice shows. Mirrored by `ModelStatus` in src/domain/voice.ts.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ModelStatus {
    Missing,
    Downloading { received: u64, total: u64 },
    Verifying,
    Ready,
    Error { message: String },
}

#[derive(Default)]
pub struct Voice {
    status: Mutex<Option<ModelStatus>>,
    cancel: AtomicBool,
    recognizer: Mutex<Option<Arc<OfflineRecognizer>>>,
    recording: Mutex<Option<Recording>>,
}

struct Recording {
    stop: mpsc::Sender<()>,
    done: thread::JoinHandle<Result<(Vec<f32>, u32), String>>,
}

fn voice_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("voice"))
}

/// The model folder only exists once a verified archive was fully unpacked (see `install`).
fn model_dir(voice: &Path) -> PathBuf {
    voice.join("model")
}

fn is_ready(voice: &Path) -> bool {
    MODEL_FILES.iter().all(|f| model_dir(voice).join(f).is_file())
}

fn set_status(app: &AppHandle, v: &Voice, s: ModelStatus) {
    *v.status.lock().unwrap() = Some(s.clone());
    let _ = app.emit("voice:model", s);
}

fn sha256_hex(path: &Path) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    io::copy(&mut file, &mut hasher)?;
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Checks the downloaded archive, unpacks it beside the final folder and renames it into place,
/// so a crash at any point leaves either no model or a complete one, never half of one.
fn install(archive: &Path, voice: &Path, sha256: &str, top: &str) -> Result<(), String> {
    if sha256_hex(archive).map_err(|e| e.to_string())? != sha256 {
        let _ = fs::remove_file(archive);
        return Err("The download was damaged (checksum mismatch). Try again.".into());
    }
    let unpack = voice.join("unpack");
    let _ = fs::remove_dir_all(&unpack);
    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    tar::Archive::new(bzip2::read::BzDecoder::new(file)).unpack(&unpack).map_err(|e| format!("Couldn't unpack the voice model: {e}"))?;
    let unpacked = unpack.join(top);
    if !MODEL_FILES.iter().all(|f| unpacked.join(f).is_file()) {
        let _ = fs::remove_dir_all(&unpack);
        return Err("The voice model archive is missing files.".into());
    }
    let _ = fs::remove_dir_all(model_dir(voice));
    fs::rename(&unpacked, model_dir(voice)).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&unpack);
    let _ = fs::remove_file(archive);
    Ok(())
}

/// Whether a partial file can be continued: only if the server honoured the Range request.
fn resumes(existing: u64, status: u16) -> bool {
    existing > 0 && status == 206
}

#[tauri::command]
pub fn voice_model_status(app: AppHandle, v: State<Voice>) -> Result<ModelStatus, String> {
    let ready = is_ready(&voice_dir(&app)?);
    let mut s = v.status.lock().unwrap();
    // Busy or failed states are live; otherwise the disk is the truth (e.g. after a restart).
    let live = matches!(*s, Some(ModelStatus::Downloading { .. } | ModelStatus::Verifying | ModelStatus::Error { .. }));
    if !live {
        *s = Some(if ready { ModelStatus::Ready } else { ModelStatus::Missing });
    }
    Ok(s.clone().unwrap_or(ModelStatus::Missing))
}

/// User-initiated (Settings → Voice). Streams to `voice/model.tar.bz2.part`, resuming a partial
/// file after a network error; Cancel deletes it.
#[tauri::command]
pub async fn voice_download(app: AppHandle) -> Result<(), String> {
    let v = app.state::<Voice>();
    {
        let mut s = v.status.lock().unwrap();
        if matches!(*s, Some(ModelStatus::Downloading { .. } | ModelStatus::Verifying)) {
            return Ok(());
        }
        *s = Some(ModelStatus::Downloading { received: 0, total: MODEL_BYTES });
    }
    v.cancel.store(false, Ordering::Relaxed);
    let result = download_and_install(&app, &v).await;
    match &result {
        Ok(()) => set_status(&app, &v, ModelStatus::Ready),
        Err(_) if v.cancel.load(Ordering::Relaxed) => set_status(&app, &v, ModelStatus::Missing),
        Err(message) => set_status(&app, &v, ModelStatus::Error { message: message.clone() }),
    }
    result
}

async fn download_and_install(app: &AppHandle, v: &Voice) -> Result<(), String> {
    let dir = voice_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let part = dir.join("model.tar.bz2.part");
    let existing = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    set_status(app, v, ModelStatus::Downloading { received: existing, total: MODEL_BYTES });
    if existing < MODEL_BYTES {
        let mut req = reqwest::Client::new().get(MODEL_URL);
        if existing > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={existing}-"));
        }
        let net = |e: reqwest::Error| format!("Download failed: {e}");
        let mut resp = req.send().await.and_then(|r| r.error_for_status()).map_err(net)?;
        let append = resumes(existing, resp.status().as_u16());
        let mut file = fs::OpenOptions::new().create(true).write(true).append(append).truncate(!append).open(&part).map_err(|e| e.to_string())?;
        let mut received = if append { existing } else { 0 };
        let mut reported = received;
        while let Some(chunk) = resp.chunk().await.map_err(net)? {
            if v.cancel.load(Ordering::Relaxed) {
                drop(file);
                let _ = fs::remove_file(&part);
                return Err("Download cancelled".into());
            }
            file.write_all(&chunk).map_err(|e| e.to_string())?;
            received += chunk.len() as u64;
            if received - reported >= 1 << 20 {
                reported = received;
                set_status(app, v, ModelStatus::Downloading { received, total: MODEL_BYTES });
            }
        }
        file.flush().map_err(|e| e.to_string())?;
    }
    set_status(app, v, ModelStatus::Verifying);
    tauri::async_runtime::spawn_blocking(move || install(&part, &dir, MODEL_SHA256, ARCHIVE_DIR))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn voice_cancel_download(v: State<Voice>) {
    v.cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub fn voice_remove(app: AppHandle, v: State<Voice>) -> Result<(), String> {
    v.recognizer.lock().unwrap().take();
    let dir = voice_dir(&app)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Couldn't remove the voice model: {e}"))?;
    }
    set_status(&app, &v, ModelStatus::Missing);
    Ok(())
}

fn load_recognizer(dir: &Path) -> Result<OfflineRecognizer, String> {
    let file = |f: &str| Some(dir.join(f).to_string_lossy().into_owned());
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.transducer = OfflineTransducerModelConfig { encoder: file(MODEL_FILES[0]), decoder: file(MODEL_FILES[1]), joiner: file(MODEL_FILES[2]) };
    config.model_config.tokens = file(MODEL_FILES[3]);
    config.model_config.model_type = Some("nemo_transducer".into());
    config.model_config.num_threads = thread::available_parallelism().map_or(2, |n| n.get().clamp(1, 4) as i32);
    OfflineRecognizer::create(&config).ok_or_else(|| "Couldn't load the voice model. Try removing and downloading it again.".into())
}

/// Loaded on first use and kept; callers are on background threads.
fn recognizer(app: &AppHandle) -> Result<Arc<OfflineRecognizer>, String> {
    let v = app.state::<Voice>();
    let mut slot = v.recognizer.lock().unwrap();
    if let Some(r) = slot.as_ref() {
        return Ok(r.clone());
    }
    let r = Arc::new(load_recognizer(&model_dir(&voice_dir(app)?))?);
    *slot = Some(r.clone());
    Ok(r)
}

fn transcribe(r: &OfflineRecognizer, samples: &[f32], rate: u32) -> String {
    let stream = r.create_stream();
    // sherpa-onnx resamples to the model's 16 kHz itself.
    stream.accept_waveform(rate as i32, samples);
    r.decode(&stream);
    stream.get_result().map(|res| res.text.trim().to_string()).unwrap_or_default()
}

/// Mono f32 from an interleaved buffer of any sample format.
fn push_mono<T: cpal::Sample>(data: &[T], channels: usize, out: &mut Vec<f32>) -> f32
where
    f32: cpal::FromSample<T>,
{
    let mut sum_sq = 0.0;
    for frame in data.chunks(channels.max(1)) {
        let m = frame.iter().map(|s| s.to_sample::<f32>()).sum::<f32>() / frame.len() as f32;
        sum_sq += m * m;
        out.push(m);
    }
    (sum_sq / (data.len() / channels.max(1)).max(1) as f32).sqrt()
}

/// Records the default input device on its own thread (cpal streams aren't `Send` everywhere)
/// until `stop` fires, emitting `voice:level` (0..1) for the popup's meter.
fn record(app: AppHandle, stop: mpsc::Receiver<()>, started: mpsc::Sender<Result<(), String>>) -> Result<(Vec<f32>, u32), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::SampleFormat as F;
    let fail = |started: &mpsc::Sender<Result<(), String>>, msg: String| {
        let _ = started.send(Err(msg.clone()));
        Err(msg)
    };
    let Some(device) = cpal::default_host().default_input_device() else {
        return fail(&started, "No microphone found.".into());
    };
    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => return fail(&started, format!("Couldn't open the microphone: {e}")),
    };
    let (rate, channels) = (config.sample_rate(), config.channels() as usize);
    let max = rate as usize * MAX_SECONDS;
    let buf = Arc::new(Mutex::new(Vec::<f32>::with_capacity(rate as usize * 10)));
    let level = Arc::new(AtomicU32::new(0));
    macro_rules! stream {
        ($t:ty) => {{
            let (buf, level) = (buf.clone(), level.clone());
            device.build_input_stream(
                config.clone().into(),
                move |data: &[$t], _: &_| {
                    let mut b = buf.lock().unwrap();
                    if b.len() < max {
                        level.store(push_mono(data, channels, &mut b).to_bits(), Ordering::Relaxed);
                    }
                },
                |e| eprintln!("microphone stream error: {e}"),
                None,
            )
        }};
    }
    let stream = match config.sample_format() {
        F::F32 => stream!(f32),
        F::I16 => stream!(i16),
        F::U16 => stream!(u16),
        F::I32 => stream!(i32),
        F::U8 => stream!(u8),
        f => return fail(&started, format!("Unsupported microphone format {f}")),
    };
    let stream = match stream.map_err(|e| e.to_string()).and_then(|s| s.play().map(|_| s).map_err(|e| e.to_string())) {
        Ok(s) => s,
        Err(e) => return fail(&started, format!("Couldn't start the microphone: {e}")),
    };
    let _ = started.send(Ok(()));
    while let Err(mpsc::RecvTimeoutError::Timeout) = stop.recv_timeout(Duration::from_millis(60)) {
        // RMS of speech sits around 0.01..0.3; stretch it so the meter moves.
        let _ = app.emit("voice:level", (f32::from_bits(level.load(Ordering::Relaxed)) * 6.0).min(1.0));
    }
    drop(stream);
    let samples = std::mem::take(&mut *buf.lock().unwrap());
    Ok((samples, rate))
}

/// Push-to-talk pressed (or the popup's mic clicked): start recording, and warm the model up
/// meanwhile so the release only waits for decoding.
#[tauri::command]
pub async fn voice_start(app: AppHandle) -> Result<(), String> {
    let v = app.state::<Voice>();
    if !is_ready(&voice_dir(&app)?) {
        return Err("The voice model isn't installed.".into());
    }
    if v.recording.lock().unwrap().is_some() {
        return Ok(());
    }
    let (stop_tx, stop_rx) = mpsc::channel();
    let (started_tx, started_rx) = mpsc::channel();
    let rec_app = app.clone();
    let done = thread::spawn(move || record(rec_app, stop_rx, started_tx));
    let started = tauri::async_runtime::spawn_blocking(move || started_rx.recv().unwrap_or_else(|_| Err("The microphone thread stopped.".into())))
        .await
        .map_err(|e| e.to_string())?;
    started?;
    *v.recording.lock().unwrap() = Some(Recording { stop: stop_tx, done });
    let warm = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = recognizer(&warm);
    });
    Ok(())
}

fn finish_recording(v: &Voice) -> Option<thread::JoinHandle<Result<(Vec<f32>, u32), String>>> {
    let rec = v.recording.lock().unwrap().take()?;
    let _ = rec.stop.send(());
    Some(rec.done)
}

/// Push-to-talk released: stop and return the transcript (empty if nothing was heard).
#[tauri::command]
pub async fn voice_stop(app: AppHandle) -> Result<String, String> {
    let Some(done) = finish_recording(&app.state::<Voice>()) else { return Ok(String::new()) };
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let (samples, rate) = done.join().map_err(|_| "The microphone thread crashed.".to_string())??;
        if samples.len() < rate as usize / 4 {
            return Ok(String::new());
        }
        let r = recognizer(&app)?;
        Ok(transcribe(&r, &samples, rate))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The popup was closed while listening: drop the recording.
#[tauri::command]
pub fn voice_cancel(v: State<Voice>) {
    finish_recording(&v);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("momentum-voice-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// A tiny stand-in archive with the same layout as the real one.
    fn fake_archive(dir: &Path, files: &[&str]) -> (PathBuf, String) {
        let path = dir.join("model.tar.bz2.part");
        let enc = bzip2::write::BzEncoder::new(fs::File::create(&path).unwrap(), bzip2::Compression::fast());
        let mut tar = tar::Builder::new(enc);
        for f in files {
            let mut h = tar::Header::new_gnu();
            h.set_size(2);
            h.set_mode(0o644);
            h.set_cksum();
            tar.append_data(&mut h, format!("top/{f}"), &b"ok"[..]).unwrap();
        }
        tar.into_inner().unwrap().finish().unwrap();
        let hash = sha256_hex(&path).unwrap();
        (path, hash)
    }

    #[test]
    fn installs_a_verified_archive_atomically() {
        let d = tmp("ok");
        let (archive, hash) = fake_archive(&d, &MODEL_FILES);
        assert!(!is_ready(&d));
        install(&archive, &d, &hash, "top").unwrap();
        assert!(is_ready(&d));
        assert!(!archive.exists() && !d.join("unpack").exists());
    }

    #[test]
    fn rejects_a_damaged_download_and_deletes_it() {
        let d = tmp("bad");
        let (archive, _) = fake_archive(&d, &MODEL_FILES);
        assert!(install(&archive, &d, &"0".repeat(64), "top").unwrap_err().contains("checksum"));
        assert!(!is_ready(&d) && !archive.exists());
    }

    #[test]
    fn never_marks_an_incomplete_model_ready() {
        let d = tmp("partial");
        let (archive, hash) = fake_archive(&d, &MODEL_FILES[..2]);
        assert!(install(&archive, &d, &hash, "top").is_err());
        assert!(!is_ready(&d) && !d.join("unpack").exists());
    }

    #[test]
    fn resumes_only_on_partial_content() {
        assert!(resumes(10, 206));
        assert!(!resumes(10, 200));
        assert!(!resumes(0, 206));
    }

    #[test]
    fn downmixes_to_mono() {
        let mut out = Vec::new();
        let rms = push_mono(&[0.5f32, -0.5, 1.0, 0.0], 2, &mut out);
        assert_eq!(out, vec![0.0, 0.5]);
        assert!((rms - (0.125f32).sqrt()).abs() < 1e-6);
        let mut out = Vec::new();
        push_mono(&[i16::MAX], 1, &mut out);
        assert!((out[0] - 1.0).abs() < 1e-3);
    }

    /// Real transcription: `MOMENTUM_VOICE_MODEL=<unpacked model dir> MOMENTUM_VOICE_WAV=<file.wav>
    /// cargo test --lib transcribes_a_wav -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn transcribes_a_wav() {
        let model = std::env::var("MOMENTUM_VOICE_MODEL").expect("MOMENTUM_VOICE_MODEL");
        let wav = sherpa_onnx::Wave::read(&std::env::var("MOMENTUM_VOICE_WAV").expect("MOMENTUM_VOICE_WAV")).expect("wav");
        let r = load_recognizer(Path::new(&model)).unwrap();
        let text = transcribe(&r, wav.samples(), wav.sample_rate() as u32);
        println!("transcript: {text}");
        assert!(!text.is_empty());
    }
}
