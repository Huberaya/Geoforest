/**
 * Banc d'essai du chantier P1-06 — règles, mesures, réduction et motifs.
 *
 * Exécution :
 *     npx tsx --conditions=react-server scripts/check-p106-regles.ts
 *
 * ⚠️ Pourquoi `--conditions=react-server`.
 *   Les modules d'observabilité portent `import "server-only"` : c'est une
 *   garde qui interdit de les embarquer dans un paquet client. Sous `tsx`,
 *   cette garde se déclenche — à juste titre, puisqu'on n'est pas dans le
 *   serveur React. La condition de résolution `react-server` la neutralise pour
 *   l'exécution hors navigateur, sans toucher au code du produit.
 *
 * ⚠️ Pourquoi un banc séparé de la suite HTTP.
 *   Les seuils sont lus dans l'environnement au moment de l'appel. Les éprouver
 *   contre le serveur exigerait de le relancer pour chaque valeur — une minute
 *   par cas. Le banc s'exécute dans son propre processus : il peut donc
 *   configurer `GF_BACKUP_DIR` ou `GF_ALERT_DISQUE_POURCENT` à volonté et
 *   vérifier chaque branche, y compris celles qu'aucun essai en service ne
 *   atteindrait.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { motifDeRoute } from "../src/lib/observability/contexte";
import { rediger } from "../src/lib/observability/journal";
import {
  enregistrerRequete,
  expositionPrometheus,
  fenetre,
  reinitialiser,
  resumeRoutes,
} from "../src/lib/observability/metriques";
import { SEUILS, evaluer, sonderDisque, sonderGfw, sonderSauvegarde } from "../src/lib/alerting/regles";

let reussis = 0;
let echecs = 0;

function verifier(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    reussis += 1;
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    echecs += 1;
    console.log(`  🔴 ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(titre: string): void {
  console.log(`\n##### ${titre} #####`);
}

// ------------------------------------------------------------------ A. motifs
section("A. Motifs de route — journaliser sans fuir d'identifiant");
{
  const cas: Array<[string, string]> = [
    ["/api/v1/documents/0a3b6c9e-0f12-4a5b-8c7d-9e0f1a2b3c4d/download", "/api/v1/documents/:id/download"],
    ["/api/v1/plots", "/api/v1/plots"],
    ["/api/v1/plots/0a3b6c9e0f124a5b8c7d9e0f1a2b3c4d", "/api/v1/plots/:id"],
    ["/api/v1/suppliers/12/audits", "/api/v1/suppliers/:id/audits"],
  ];
  for (const [entree, attendu] of cas) {
    const obtenu = motifDeRoute(entree);
    verifier(`« ${entree} » ⇒ « ${attendu} »`, obtenu === attendu, obtenu);
  }
  const avecSecret = motifDeRoute("/api/v1/documents/0a3b6c9e-0f12-4a5b-8c7d-9e0f1a2b3c4d/url");
  verifier(
    "aucun identifiant ne subsiste dans le motif",
    !/0a3b6c9e/i.test(avecSecret),
    avecSecret,
  );
}

// --------------------------------------------------------------- B. réduction
section("B. Réduction — ce qui ne doit jamais atteindre un journal");
{
  const objet = {
    email: "admin@geoforest.eu",
    password: "Trace!Demo2026x",
    imbrique: { token: "abc.def.ghi", api_key: "GFW-1234", normal: "visible" },
    liste: [{ secret: "x" }, { ok: 1 }],
    nombre: 42,
  };
  const s = JSON.stringify(rediger(objet));
  verifier("le mot de passe est masqué", !s.includes("Trace!Demo2026x"), s.slice(0, 120));
  verifier("le jeton est masqué", !s.includes("abc.def.ghi"));
  verifier("la clé d'API est masquée", !s.includes("GFW-1234"));
  verifier("un secret imbriqué est masqué", !s.includes('"secret":"x"'));
  verifier("les valeurs anodines sont conservées", s.includes("visible") && s.includes("42"));

  const longue = "x".repeat(900);
  const tronque = String((rediger({ texte: longue }) as { texte: string }).texte);
  verifier("une très longue chaîne est tronquée", tronque.length < 600 && tronque.includes("tronqué"),
    `${tronque.length} caractères`);

  const err = rediger(new Error("boom")) as { type: string; message: string; pile: string };
  verifier("une erreur conserve son type et son message", err.type === "Error" && err.message === "boom");
  verifier("la pile est tronquée à 12 lignes", err.pile.split("\n").length <= 12,
    `${err.pile.split("\n").length} ligne(s)`);

  // Cycles : un objet qui se référence lui-même ne doit pas faire exploser la
  // sérialisation — donc la requête — au seul motif qu'on la journalise.
  const cyclique: Record<string, unknown> = { nom: "a" };
  cyclique.lui = cyclique;
  let tient = true;
  try {
    JSON.stringify(rediger(cyclique));
  } catch {
    tient = false;
  }
  verifier("un objet cyclique ne fait pas échouer la réduction", tient);
}

// ---------------------------------------------------------------- C. mesures
section("C. Mesures par route");
{
  reinitialiser();
  for (let i = 0; i < 100; i += 1) {
    enregistrerRequete({ route: "/api/v1/plots", methode: "GET", statut: 200, dureeMs: 10 + i });
  }
  for (let i = 0; i < 10; i += 1) {
    enregistrerRequete({ route: "/api/v1/audits", methode: "POST", statut: 500, dureeMs: 500 });
  }
  const resume = resumeRoutes();
  const plots = resume.find((r) => r.route === "GET /api/v1/plots");
  const audits = resume.find((r) => r.route === "POST /api/v1/audits");

  verifier("les requêtes sont comptées", plots?.requetes === 100, `${plots?.requetes}`);
  verifier("les 5xx sont comptées séparément", audits?.echecs5xx === 10, `${audits?.echecs5xx}`);
  verifier("le taux d'erreur est calculé", audits?.tauxErreur5xx === 1, `${audits?.tauxErreur5xx}`);
  verifier("la précision est annoncée comme estimée", plots?.precision === "estimé");
  verifier("le p95 est calculé sur l'échantillon", (plots?.p95Ms ?? 0) >= 100, `p95 = ${plots?.p95Ms} ms`);
  verifier("le maximum est retenu", plots?.maxMs === 109, `${plots?.maxMs} ms`);

  const f = fenetre("POST /api/v1/audits", 5);
  verifier("la fenêtre glissante agrège la minute courante", f.total === 10 && f.echecs5xx === 10,
    `${f.total} requête(s)`);
  const inconnue = fenetre("GET /inexistant", 5);
  verifier("une route inconnue a un taux nul, pas un taux de 0 % trompeur",
    inconnue.total === 0);

  const prom = expositionPrometheus();
  verifier("l'exposition Prometheus nomme les routes", prom.includes('route="/api/v1/plots"'));
  verifier("l'exposition ne contient aucun identifiant", !/0a3b6c9e/i.test(prom));
  verifier("l'exposition déclare la disponibilité", prom.includes("geoforest_up 1"));
}

// ------------------------------------------------------------------- D. disque
section("D. Règles — occupation disque");
{
  const precedent = process.env.GF_ALERT_DISQUE_POURCENT;
  process.env.GF_ALERT_DISQUE_POURCENT = "1";
  const sature = sonderDisque(process.cwd());
  verifier("un seuil à 1 % déclenche l'état « dégradé »", sature.etat === "degrade", sature.detail);
  process.env.GF_ALERT_DISQUE_POURCENT = "100";
  const large = sonderDisque(process.cwd());
  verifier("un seuil à 100 % laisse l'état « ok »", large.etat === "ok", large.detail);
  if (precedent === undefined) delete process.env.GF_ALERT_DISQUE_POURCENT;
  else process.env.GF_ALERT_DISQUE_POURCENT = precedent;

  const mesure = sonderDisque(process.cwd()).mesure;
  verifier("la mesure est chiffrée (pourcentage, seuil, octets)",
    typeof mesure.pourcent === "number" && typeof mesure.seuil === "number" && typeof mesure.libreOctets === "number");
}

// --------------------------------------------------------------- E. sauvegarde
section("E. Règles — fraîcheur des sauvegardes");
{
  const racine = mkdtempSync(join(tmpdir(), "gf-sauvegarde-"));
  const precedent = process.env.GF_BACKUP_DIR;

  delete process.env.GF_BACKUP_DIR;
  const nonConfigure = sonderSauvegarde();
  verifier("aucune sauvegarde configurée ⇒ « non_configure », pas « ok »",
    nonConfigure.etat === "non_configure", nonConfigure.detail.slice(0, 70));

  const vide = join(racine, "vide");
  mkdirSync(vide);
  process.env.GF_BACKUP_DIR = vide;
  const videS = sonderSauvegarde();
  verifier("répertoire vide ⇒ « indisponible »", videS.etat === "indisponible", videS.detail.slice(0, 60));

  const frais = join(racine, "frais");
  mkdirSync(frais);
  writeFileSync(join(frais, "app_db-2026-10-01.dump"), "x");
  process.env.GF_BACKUP_DIR = frais;
  const fraisS = sonderSauvegarde();
  verifier("sauvegarde fraîche ⇒ « ok »", fraisS.etat === "ok", fraisS.detail.slice(0, 60));

  const ancien = join(racine, "ancien");
  mkdirSync(ancien);
  const fichier = join(ancien, "app_db-vieux.dump");
  writeFileSync(fichier, "x");
  const il_y_a_longtemps = Date.now() / 1000 - (SEUILS.SAUVEGARDE_HEURES + 5) * 3600;
  utimes(fichier, il_y_a_longtemps, il_y_a_longtemps);
  process.env.GF_BACKUP_DIR = ancien;
  const ancienS = sonderSauvegarde();
  verifier("sauvegarde trop ancienne ⇒ « dégradé »", ancienS.etat === "degrade", ancienS.detail.slice(0, 60));
  verifier("l'ancienneté est chiffrée dans la mesure",
    typeof (ancienS.mesure.ageHeures as number) === "number");

  const absent = join(racine, "absent");
  process.env.GF_BACKUP_DIR = absent;
  const absentS = sonderSauvegarde();
  verifier("répertoire déclaré mais absent ⇒ « indisponible »", absentS.etat === "indisponible");

  if (precedent === undefined) delete process.env.GF_BACKUP_DIR;
  else process.env.GF_BACKUP_DIR = precedent;
}

// ---------------------------------------------------------------------- F. GFW
section("F. Règles — fournisseur satellite");
{
  reinitialiser();
  const sansAppel = sonderGfw();
  verifier("sans appel enregistré ⇒ « non_configure », jamais « ok »",
    sansAppel.etat === "non_configure", sansAppel.detail.slice(0, 70));
}

// ------------------------------------------------------------------ G. évaluation
// ⚠️ Section encapsulée dans une fonction : `tsx` produit ici du CJS, qui
//   n'accepte pas d'attente au premier niveau. `evaluer()` est asynchrone
//   depuis qu'il sonde lui-même la base et le stockage.
async function sectionEvaluation(): Promise<void> {
section("G. Évaluation — ce qui part en alerte");
{
  reinitialiser();
  process.env.GF_ALERT_DISQUE_POURCENT = "1";
  const { aEnvoyer, deja } = await evaluer();
  const codes = aEnvoyer.map((a) => a.code);
  verifier("la saturation disque est détectée", codes.includes("disque_sature"), codes.join(", "));
  verifier("la sauvegarde non configurée est signalée", codes.includes("sauvegarde_absente"));
  verifier("chaque alerte porte une action à entreprendre",
    aEnvoyer.every((a) => typeof a.action === "string" && a.action.length > 10));
  verifier("chaque alerte porte des mesures chiffrées",
    aEnvoyer.every((a) => typeof a.mesures === "object" && Object.keys(a.mesures).length > 0));

  // Déduplication : une seconde évaluation immédiate ne renvoie rien de plus.
  const seconde = await evaluer();
  verifier("la même alerte n'est pas renvoyée dans le délai de garde",
    seconde.aEnvoyer.filter((a) => a.etat === "déclenchée").length === 0 && seconde.deja > 0,
    `${seconde.deja} déjà active(s)`);
  delete process.env.GF_ALERT_DISQUE_POURCENT;
}
}

// Le format de sortie étant CJS, l'attente se fait par promesse : pas
// d'`await` au premier niveau.
void sectionEvaluation().then(() => {
  console.log(`\nCONTRÔLES RÉUSSIS : ${reussis}/${reussis + echecs}`);
  process.exit(echecs === 0 ? 0 : 1);
});

/** Modifie la date de dernière modification d'un fichier (utilitaires de test). */
function utimes(chemin: string, atime: number, mtime: number): void {
  utimesSync(chemin, atime, mtime);
}
