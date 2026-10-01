/**
 * Supervisionnaire.
 *
 * ⚠️ P1-06 — c'est ce programme qui porte le critère d'acceptation du chantier :
 *   « une panne de base est détectée en < 2 min avec alerte envoyée ». Aucune
 *   détection n'existe sans lui : le produit expose l'état de ses composants,
 *   mais c'est une boucle extérieure qui doit interroger, évaluer et prévenir.
 *
 *   Ce choix n'est pas un pis-aller. Un supervisionnaire **hors** du processus
 *   supervisé reste en vie quand celui-ci tombe — ce qui est précisément sa
 *   raison d'être. Une boucle interne ne remarquerait jamais son propre décès.
 *
 * Usage :
 *   npx tsx scripts/supervise.ts [--intervalle 20] [--une-fois] [--duree 3600]
 *
 * Variables :
 *   GF_SUPERVISE_URL      base de l'instance (défaut http://127.0.0.1:3000)
 *   GF_METRICS_TOKEN      jeton accepté par /api/metrics et /api/observability/alertes
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
function option(nom: string, defaut: string): string {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut;
}
const uneFois = args.includes("--une-fois");

const BASE = (process.env.GF_SUPERVISE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const INTERVALLE_S = Math.max(5, Number(option("intervalle", "20")));
const DUREE_S = Number(option("duree", "0"));
const JETON = process.env.GF_METRICS_TOKEN?.trim() ?? "";
const SORTIE = resolve(option("sortie", "var/supervision/superviseur.log"));

mkdirSync(dirname(SORTIE), { recursive: true });

function tracer(objet: Record<string, unknown>): void {
  const ligne = JSON.stringify({ ts: new Date().toISOString(), ...objet });
  appendFileSync(SORTIE, ligne + "\n", "utf8");
  console.log(ligne);
}

function entetes(): Record<string, string> {
  return JETON ? { Authorization: `Bearer ${JETON}` } : {};
}

async function sonder(chemin: string, init: RequestInit = {}): Promise<{ statut: number; corps: unknown }> {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), 15_000);
  try {
    const reponse = await fetch(`${BASE}${chemin}`, {
      ...init,
      headers: { ...entetes(), ...(init.headers ?? {}) },
      signal: controleur.signal,
      cache: "no-store",
    });
    const texte = await reponse.text();
    let corps: unknown = texte;
    try {
      corps = JSON.parse(texte);
    } catch {
      /* corps non JSON : conservé tel quel */
    }
    return { statut: reponse.status, corps };
  } finally {
    clearTimeout(minuteur);
  }
}

let arret = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    arret = true;
  });
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function cycle(): Promise<void> {
  // 1. Santé. Une erreur réseau n'est pas une panne « douce » : c'est
  //    l'instance qui ne répond plus, ce qui est le pire des cas.
  const sante = await sonder("/api/health").catch((error: unknown) => ({
    statut: 0,
    corps: { erreur: error instanceof Error ? error.message : String(error) },
  }));

  tracer({ evenement: "sante", statut: sante.statut, corps: sante.corps });

  // 2. Évaluation des règles, puis envoi. Même instance injoignable, la boucle
  //    continue : c'est tout l'intérêt d'être dehors.
  const evaluation = await sonder("/api/observability/alertes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }).catch((error: unknown) => ({
    statut: 0,
    corps: { erreur: error instanceof Error ? error.message : String(error) },
  }));

  const corps = evaluation.corps as { aEnvoyer?: Array<{ code: string; etat: string }>; envois?: unknown[] };
  tracer({
    evenement: "evaluation",
    statut: evaluation.statut,
    aEnvoyer: (corps.aEnvoyer ?? []).map((a) => `${a.code}:${a.etat}`),
    envois: corps.envois ?? [],
  });

  // 3. Instantané des mesures, pour l'historique.
  if (JETON) {
    const mesures = await sonder("/api/metrics").catch(() => ({ statut: 0, corps: null }));
    tracer({ evenement: "mesures", statut: mesures.statut });
  }
}

async function main(): Promise<void> {
  tracer({
    evenement: "superviseur.demarre",
    base: BASE,
    intervalleSecondes: INTERVALLE_S,
    jeton: JETON ? "configuré" : "absent",
  });

  if (uneFois) {
    await cycle();
    return;
  }

  const fin = DUREE_S > 0 ? Date.now() + DUREE_S * 1000 : null;
  while (!arret && (!fin || Date.now() < fin)) {
    const debut = Date.now();
    await cycle();
    const reste = INTERVALLE_S * 1000 - (Date.now() - debut);
    if (arret) break;
    // ⚠️ On attend le reste de l'intervalle, pas l'intervalle entier : un cycle
    //   lent doit décaler le suivant sans jamais le raccourcir jusqu'à zéro,
    //   sinon une panne lente se transformerait en rafale.
    await dormir(Math.max(1000, reste));
  }
  tracer({ evenement: "superviseur.arrete" });
}

void main();
