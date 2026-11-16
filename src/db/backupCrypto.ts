/*
 * Passphrase encryption for backups (FEAT-06). The backup JSON text is replaced by this envelope (itself JSON):
 *   { app: "Momentum", encrypted: 1, kdf: "PBKDF2-SHA256", iterations, salt, iv, data }
 * `salt` (16 bytes), `iv` (12 bytes) and `data` (AES-256-GCM ciphertext + 16-byte tag) are base64.
 * The key is PBKDF2-SHA256(passphrase, salt, iterations). A wrong passphrase or any change fails the GCM tag.
 * In a .zip only the JSON entry is encrypted; attached images stay as files. Cloud copies are the JSON alone.
 */
const ITERATIONS = 600_000;
const enc = new TextEncoder();

const b64 = (b: Uint8Array) => btoa(Array.from(b, (c) => String.fromCharCode(c)).join(""));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(pass: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

type Envelope = { app: "Momentum"; encrypted: 1; kdf: "PBKDF2-SHA256"; iterations: number; salt: string; iv: string; data: string };

function envelope(text: string): Envelope | null {
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== "object" || v === null) return null;
    const o = v as Record<string, unknown>;
    const ok = o.encrypted === 1 && o.kdf === "PBKDF2-SHA256" && typeof o.iterations === "number" && typeof o.salt === "string" && typeof o.iv === "string" && typeof o.data === "string";
    return ok ? (o as Envelope) : null;
  } catch {
    return null;
  }
}

export const isEncryptedBackup = (text: string) => envelope(text) !== null;

export async function encryptBackup(json: string, pass: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(pass, salt, ITERATIONS), enc.encode(json));
  const e: Envelope = { app: "Momentum", encrypted: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(data)) };
  return JSON.stringify(e);
}

/** Throws "Wrong passphrase, or the backup is damaged." when the tag doesn't verify. */
export async function decryptBackup(text: string, pass: string): Promise<string> {
  const e = envelope(text);
  if (!e) throw new Error("That backup isn't encrypted.");
  if (e.iterations < 1 || e.iterations > 5_000_000) throw new Error("Unsupported backup encryption.");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(e.iv) }, await key(pass, unb64(e.salt), e.iterations), unb64(e.data));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Wrong passphrase, or the backup is damaged.");
  }
}

/** Cloud copies are named `momentum-auto-<stamp>.json[.enc]` (stamp sorts by time): the names beyond the newest `keep`. */
export const cloudExcess = (names: string[], keep: number) =>
  names
    .filter((n) => /^momentum-auto-[\d-]+\.json$/.test(n))
    .sort()
    .slice(0, Math.max(0, names.filter((n) => /^momentum-auto-[\d-]+\.json$/.test(n)).length - Math.max(1, keep)));
