/**
 * Client HTTP partagé des tests de bout en bout et de cloisonnement.
 *
 * Extrait de `parcours.ts` (P-recette) pour que le parcours E2E et le contrôle
 * cross-tenant utilisent exactement la même mécanique de session, de cookie
 * et d'enrôlement MFA. Aucun contournement : chaque requête passe par l'API.
 */
import { totpCode } from "../../src/lib/auth/totp";

export const BASE = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
export const PASSWORD = process.env.E2E_PASSWORD ?? "";

/** Client HTTP minimal avec cookie jar (les cookies de session sont posés par le serveur). */
export class Session {
  private cookies = new Map<string, string>();
  constructor(public readonly label: string) {}

  private absorb(res: Response): void {
    const h = res.headers as Headers & { getSetCookie?: () => string[] };
    const lines = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
    for (const line of lines) {
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      if (idx <= 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (/max-age=0/i.test(line) || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async request(method: string, path: string, body?: unknown, rawBody?: string): Promise<{ status: number; json: any }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined || rawBody !== undefined) headers["content-type"] = "application/json";
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      // rawBody : texte JSON envoyé tel quel. La précision EUDR (6 décimales) se
      // mesure sur le texte source : JSON.stringify effacerait les zéros finaux.
      body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    this.absorb(res);
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: res.status, json };
  }

  get(path: string) {
    return this.request("GET", path);
  }
  post(path: string, body?: unknown) {
    return this.request("POST", path, body ?? {});
  }
  postBrut(path: string, rawBody: string) {
    return this.request("POST", path, undefined, rawBody);
  }
  patch(path: string, body?: unknown) {
    return this.request("PATCH", path, body ?? {});
  }
  delete(path: string) {
    return this.request("DELETE", path);
  }
}

/** Connexion complète, avec enrôlement MFA si le rôle l'exige et que le compte n'est pas encore enrôlé. */
export async function connecter(email: string, label: string): Promise<Session> {
  const s = new Session(label);
  const r = await s.post("/api/v1/auth/login", { email, password: PASSWORD });
  if (r.status === 200 && r.json?.status === "authenticated") return s;
  if (r.json?.status === "mfa_setup_required") {
    const secret: string = r.json.setup.secret;
    const counter = Math.floor(Date.now() / 30000);
    const code = totpCode(secret, counter);
    const m = await s.post("/api/v1/auth/mfa", { code });
    if (m.status !== 200 && m.status !== 201) {
      throw new Error(`Enrôlement MFA refusé pour ${email} (HTTP ${m.status})`);
    }
    return s;
  }
  if (r.json?.status === "mfa_required") {
    throw new Error(
      `Le compte ${email} a déjà un MFA enrôlé : relancer « npm run seed:auth -- --reset » avant le parcours (le secret n'est pas stocké par ce harnais).`,
    );
  }
  throw new Error(`Connexion impossible pour ${email} (HTTP ${r.status})`);
}

