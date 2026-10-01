import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Paramètres OWASP recommandés pour scrypt (mémoire ~16 Mo par dérivation).
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 12;

export interface PasswordPolicyResult {
  ok: boolean;
  reasons: string[];
}

/**
 * Politique de mot de passe : longueur minimale 12, au moins 3 des 4 familles
 * de caractères, refus des mots de passe trop courants.
 */
export function checkPasswordPolicy(password: string, email?: string): PasswordPolicyResult {
  const reasons: string[] = [];
  const input = typeof password === "string" ? password : "";

  if (input.length < MIN_PASSWORD_LENGTH) {
    reasons.push(`au moins ${MIN_PASSWORD_LENGTH} caractères`);
  }

  const families = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(input),
  ).length;
  const requiredFamilies = input.length >= 16 ? 2 : 3;
  if (families < requiredFamilies) {
    reasons.push(
      `au moins ${requiredFamilies} familles de caractères sur 4 (minuscule, majuscule, chiffre, spécial)`,
    );
  }

  const lower = input.toLowerCase();
  const localPart = email?.split("@")[0]?.toLowerCase() ?? "";
  if (localPart.length >= 4 && lower.includes(localPart)) {
    reasons.push("ne pas contenir l'identifiant");
  }
  if (WEAK_PASSWORDS.some((weak) => lower === weak || lower.startsWith(weak))) {
    reasons.push("ne pas être un mot de passe courant");
  }

  return { ok: reasons.length === 0, reasons };
}

const WEAK_PASSWORDS = [
  "password",
  "motdepasse",
  "azerty",
  "qwerty",
  "123456",
  "geoforest",
  "eudr",
  "letmein",
  "welcome",
  "admin",
  "changeme",
];

/** Format de stockage : scrypt:N:r:p:saltB64:hashB64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt:${N}:${R}:${P}:${salt.toString("base64")}:${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");

  try {
    const derived = await scrypt(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: MAXMEM,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function generateRecoveryCode(): string {
  return randomBytes(5).toString("hex").toUpperCase();
}
