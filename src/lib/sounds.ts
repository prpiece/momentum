/*
 * Sound effects, synthesized with Web Audio so no sound files ship with the app (D63).
 * Each sound is a few enveloped notes; `times` repeats one back to back, which makes an alarm.
 */
import type { SoundEvent, SoundName } from "../domain/types";
import { useSettings } from "../stores/settings";

type Note = { f: number; at: number; dur: number; wave?: OscillatorType; gain?: number; /** Glide to this pitch. */ to?: number };

const NOTES: Record<Exclude<SoundName, "none">, Note[]> = {
  chime: [
    { f: 880, at: 0, dur: 0.6 },
    { f: 1318.5, at: 0.14, dur: 0.6 },
  ],
  pop: [{ f: 520, to: 1250, at: 0, dur: 0.13, gain: 0.9 }],
  ding: [
    { f: 1568, at: 0, dur: 1.1 },
    { f: 3136, at: 0, dur: 0.5, gain: 0.25 },
  ],
  marimba: [
    { f: 523.25, at: 0, dur: 0.3, wave: "triangle", gain: 1.2 },
    { f: 784, at: 0.09, dur: 0.35, wave: "triangle", gain: 1.2 },
  ],
  fanfare: [
    { f: 523.25, at: 0, dur: 0.22, wave: "triangle" },
    { f: 659.25, at: 0.11, dur: 0.22, wave: "triangle" },
    { f: 783.99, at: 0.22, dur: 0.22, wave: "triangle" },
    { f: 1046.5, at: 0.33, dur: 0.9, wave: "triangle" },
    { f: 1046.5, at: 0.33, dur: 0.9, gain: 0.4 },
  ],
};

export const SOUND_LABELS: Record<SoundName, string> = { chime: "Chime", pop: "Pop", ding: "Ding", marimba: "Marimba", fanfare: "Fanfare", none: "None" };

/** Plays a sound at `volume` (0..1). Silent when there's no audio device. */
export function playSound(name: SoundName, volume: number, times = 1) {
  if (name === "none" || volume <= 0) return;
  const notes = NOTES[name];
  const period = Math.max(...notes.map((n) => n.at + n.dur)) + 0.15;
  try {
    const ctx = new AudioContext();
    for (let r = 0; r < times; r++) {
      for (const n of notes) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const t = ctx.currentTime + r * period + n.at;
        o.type = n.wave ?? "sine";
        o.frequency.setValueAtTime(n.f, t);
        if (n.to) o.frequency.exponentialRampToValueAtTime(n.to, t + n.dur * 0.6);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.18 * volume * (n.gain ?? 1), t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + n.dur + 0.05);
      }
    }
    setTimeout(() => void ctx.close(), (times * period + 0.5) * 1000);
  } catch {
    // No audio device: everything else still works.
  }
}

/** The sound Settings → Sounds picked for `event`, unless sound effects are off. */
export function playEvent(event: SoundEvent, times = 1) {
  const { enabled, volume, picks } = useSettings.getState().settings.sounds;
  if (enabled) playSound(picks[event], volume, times);
}
