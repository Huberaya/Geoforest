/**
 * Banc d'essai HTTP réel : PostgreSQL (PGlite) + serveur Next.js.
 *
 * ⚠️ Deux limites, mesurées et non supposées.
 *
 *   1. **Le serveur tourne en superutilisateur, et il n'existe pas de moyen
 *      simple de l'éviter ici.** `PGLiteSocketServer` n'authentifie pas : toute
 *      connexion arrive en `postgres`. Forcer le rôle avec `SET ROLE` a été
 *      essayé (`tests/helpers/relais-role.ts`) et **ne peut pas fonctionner
 *      avec deux rôles** : PGlite n'a qu'une seule session PostgreSQL, si bien
 *      qu'un `SET ROLE` posé par une connexion s'applique à toutes les autres,
 *      y compris à la connexion d'administration dont l'authentification a
 *      besoin. Mesuré : après `SET ROLE geoforest_app` par le relais, un client
 *      `pg` connecté directement au socket — donc « en postgres » — rapporte
 *      lui aussi `current_user = geoforest_app` et ne voit plus `gf_users`.
 *
 *      Ces tests HTTP prouvent donc le **filtrage applicatif** des routes, pas
 *      l'application de la RLS. Celle-ci est prouvée sous le rôle réel dans
 *      `tests/sql/isolation.test.ts` et `tests/sql/privileges.test.ts`, et le
 *      motif de connexion (`SET ROLE` + `set_config` transactionnel) est
 *      éprouvé sur un vrai client réseau dans `tests/sql/connexion-applicative.test.ts`.
 *      Aucun résultat de ce fichier ne doit être présenté comme une preuve RLS.
 *
 *   2. PGlite ne sert qu'une transaction à la fois : les scénarios sont
 *      séquentiels ; les courses de jetons sont couvertes au niveau SQL
 *      (`tests/sql/refresh-consommation.test.ts`).
 *
 * Ces tests ne remplacent pas une recette sur PostgreSQL serveur, mais ils
 * exercent les vrais gestionnaires de route, les vrais cookies, les vrais
 * statuts et les vrais messages d'erreur.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout as attendre } from "node:timers/promises";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

import { hashPassword } from "../../src/lib/auth/password";
import { totpCode } from "../../src/lib/auth/totp";
import {
  appliquerMigrations,
  ORG_A,
  ORG_B,
  semerDeuxTenants,
} from "../helpers/migrations";

export const MOT_DE_PASSE = "MotDePasse!2026";
export const EMAIL_A = "a@exemple.test";
export const EMAIL_B = "b@exemple.test";
export const EMAIL_ADMIN_A = "admin.a@exemple.test";
export const EMAIL_ADMIN_B = "admin.b@exemple.test";
export const EMAIL_ADMIN_LOCK = "admin.lock@exemple.test";
export const EMAIL_REFRESH = "refresh.a@exemple.test";
export const EMAIL_SUSPENDU = "suspendu.a@exemple.test";

const PORT_DB = 55491;
const PORT_APP = 3103;

export class ClientHttp {
  readonly base: string;
  readonly cookies = new Map<string, string>();

  constructor(base: string) {
    this.base = base;
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.set("cookie", cookie);

    const response = await fetch(`${this.base}${path}`, {
      ...init,
      headers,
      redirect: "manual",
    });

    // `getSetCookie` renvoie chaque en-tête séparément : un analyseur naïf de
    // `headers.get("set-cookie")` fusionnerait les cookies et perdrait le
    // second (le refresh), ce qui masquerait justement les défauts de session.
    for (const ligne of response.headers.getSetCookie()) {
      const [paire] = ligne.split(";");
      const egal = paire.indexOf("=");
      if (egal === -1) continue;
      const nom = paire.slice(0, egal).trim();
      const valeur = paire.slice(egal + 1).trim();
      if (/Max-Age=0/i.test(ligne) || valeur === "") this.cookies.delete(nom);
      else this.cookies.set(nom, valeur);
    }

    return response;
  }

  async json<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ statut: number; corps: T; entetes: Headers }> {
    const response = await this.fetch(path, init);
    const corps = (await response.json().catch(() => null)) as T;
    return { statut: response.status, corps, entetes: response.headers };
  }

  poserCookie(nom: string, valeur: string): void {
    this.cookies.set(nom, valeur);
  }

  cookie(nom: string): string | undefined {
    return this.cookies.get(nom);
  }
}

export interface Banc {
  client: PGlite;
  serveur: PGLiteSocketServer;
  next: ChildProcess;
  base: string;
  clientHttp(): ClientHttp;
  arreterBaseDeDonnees(): Promise<void>;
  arreter(): Promise<void>;
}

async function arreterProcessus(child: ChildProcess): Promise<void> {
  try {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([once(child, "exit"), attendre(5_000)]);
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {
    // déjà terminé
  }
}

export async function demarrerBanc(): Promise<Banc> {
  const client = await PGlite.create();
  await appliquerMigrations(client);
  await semerDeuxTenants(client);

  const hash = await hashPassword(MOT_DE_PASSE);
  await client.exec(`
    update gf_users set password_hash = '${hash}'
     where id in (
       'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
       'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
     );

    insert into gf_users (organization_id, email, name, role, status, password_hash, token_version)
    values
      ('${ORG_A}', '${EMAIL_ADMIN_A}',     'Admin A',        'admin',    'active',    '${hash}', 0),
      ('${ORG_B}', '${EMAIL_ADMIN_B}',     'Admin B',        'admin',    'active',    '${hash}', 0),
      ('${ORG_A}', '${EMAIL_ADMIN_LOCK}',  'Admin verrou',   'admin',    'active',    '${hash}', 0),
      ('${ORG_A}', '${EMAIL_REFRESH}',     'Session A',      'viewer',   'active',    '${hash}', 0),
      ('${ORG_A}', '${EMAIL_SUSPENDU}',    'Compte suspendu','viewer',   'suspended', '${hash}', 0);
  `);

  const serveur = new PGLiteSocketServer({
    db: client,
    port: PORT_DB,
    host: "127.0.0.1",
    // ⚠️ La valeur par défaut est 1 : la seconde connexion du pool couperait
    //   la première. L'application ouvre deux pools (applicatif et admin).
    maxConnections: 10,
  });
  await serveur.start();

  const url = `postgresql://postgres@127.0.0.1:${PORT_DB}/postgres`;
  const next = spawn("npx", ["next", "dev", "-p", String(PORT_APP)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: url,
      DATABASE_URL_ADMIN: url,
      AUTH_SECRET: "secret-de-test-suffisamment-long-0123456789",
      // La limitation de cadence est mesurée par les tests unitaires ; ici elle
      // masquerait les scénarios d'authentification derrière des 429.
      GF_RATE_LIMIT: "off",
      GF_LOG_FILE: "off",
      GF_STORAGE_DIR: "/tmp/geoforest-http-storage",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  const journal = (prefixe: string) => (morceau: Buffer) => {
    const texte = morceau.toString("utf8").trim();
    if (texte) process.stderr.write(`[${prefixe}] ${texte.slice(0, 500)}\n`);
  };
  next.stdout?.on("data", journal("next"));
  next.stderr?.on("data", journal("next-err"));

  const base = `http://127.0.0.1:${PORT_APP}`;
  let pret = false;
  for (let i = 0; i < 120 && !pret; i += 1) {
    try {
      await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5_000) });
      pret = true;
    } catch {
      await attendre(1_000);
    }
  }
  if (!pret) {
    await arreterProcessus(next);
    await serveur.stop().catch(() => undefined);
    await client.close().catch(() => undefined);
    throw new Error("Le serveur Next.js n'a pas répondu dans le délai imparti.");
  }

  let baseArretee = false;

  return {
    client,
    serveur,
    next,
    base,
    clientHttp: () => new ClientHttp(base),
    async arreterBaseDeDonnees() {
      if (baseArretee) return;
      baseArretee = true;
      await Promise.race([serveur.stop(), attendre(5_000)]);
    },
    async arreter() {
      await arreterProcessus(next);
      if (!baseArretee) await Promise.race([serveur.stop(), attendre(5_000)]);
      await Promise.race([client.close(), attendre(5_000)]);
    },
  };
}

/** Connexion simple (rôles sans MFA). */
export async function connecter(client: ClientHttp, email: string): Promise<void> {
  const { statut, corps } = await client.json<{ status?: string }>("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: MOT_DE_PASSE }),
  });
  if (statut !== 200) throw new Error(`Connexion ${email} refusée : ${statut}`);
  if (corps.status !== "authenticated") {
    throw new Error(`Connexion ${email} inattendue : ${corps.status}`);
  }
}

/**
 * Connexion d'un rôle soumis à la MFA, enrôlement compris.
 *
 * Renvoie le secret TOTP : les tests qui doivent produire un code valide plus
 * tard (ou un code faux) l'utilisent.
 */
export async function connecterAvecMfa(client: ClientHttp, email: string): Promise<string> {
  const { statut, corps } = await client.json<{
    status?: string;
    setup?: { secret?: string };
  }>("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: MOT_DE_PASSE }),
  });
  if (statut !== 200) throw new Error(`Connexion MFA ${email} refusée : ${statut}`);
  if (corps.status !== "mfa_setup_required" || !corps.setup?.secret) {
    throw new Error(`Enrôlement MFA ${email} inattendu : ${corps.status}`);
  }

  const code = totpCode(corps.setup.secret, Math.floor(Date.now() / 1000 / 30));
  const validation = await client.json<{ status?: string }>("/api/v1/auth/mfa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (validation.statut !== 200 || validation.corps.status !== "authenticated") {
    throw new Error(`Validation MFA ${email} refusée : ${validation.statut}`);
  }
  return corps.setup.secret;
}
