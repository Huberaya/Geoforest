/**
 * TOTP — RFC 6238 (HMAC-SHA1, fenêtre de 30 s, 6 chiffres).
 * Compatible Google Authenticator, Microsoft Authenticator, Authy, FreeOTP…
 * Implémenté avec `jose` pour rester compatible Edge Runtime.
 */
import { createHmac, randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // base32 RFC 4648
export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;
/** Tolérance : ±1 fenêtre (= ±30 s) pour absorber le décalage d'horloge. */
export const TOTP_SKEW = 1;

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  return base32Encode(bytes);
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cleaned) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("Caractère base32 invalide");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const msg = Buffer.alloc(8);
  // Node écrit en big-endian — compteur sur 64 bits.
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter % 0x100000000, 4);

  const digest = createHmac("sha1", key).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const code = binary % 10 ** TOTP_DIGITS;
  return String(code).padStart(TOTP_DIGITS, "0");
}

function currentCounter(): number {
  return Math.floor(Date.now() / 1000 / TOTP_PERIOD);
}

/** Vérifie un code en tolérant ±`TOTP_SKEW` fenêtres. Renvoie le décalage accepté ou null. */
export function verifyTotp(secretBase32: string, code: string): number | null {
  const normalized = String(code ?? "").replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;

  const counter = currentCounter();
  for (let drift = -TOTP_SKEW; drift <= TOTP_SKEW; drift += 1) {
    if (totpCode(secretBase32, counter + drift) === normalized) return drift;
  }
  return null;
}

/** URI `otpauth://` pour l'ajout dans une application d'authentification. */
export function totpProvisioningUri(secretBase32: string, accountName: string): string {
  const label = encodeURIComponent(`GeoForest Trace:${accountName}`);
  const issuer = encodeURIComponent("GeoForest Trace");
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}
