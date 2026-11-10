/**
 * Pack de preuves — parcours HTTP sur le serveur réel (B-10, chantier 4).
 *
 * Exécution (serveur démarré, comptes fraîchement réinitialisés) :
 *   npm run seed:auth -- --reset
 *   E2E_BASE_URL=http://127.0.0.1:3100 E2E_PASSWORD=… DATABASE_URL_ADMIN=… \
 *     npx tsx --conditions=react-server scripts/check-evidence-pack-http.ts
 *
 * ⚠️ FIXTURE DÉCLARÉE. Comme pour le chantier 3, l'analyse est marquée probante par la
 *   fixture `fixture-test-probant` (aucune donnée satellite réelle, B1). Le pack
 *   signale cette source comme non officielle : le test le vérifie.
 *
 * Verdicts attendus :
 *   · le pack est produit, il est cohérent (verifierPack), et il contient la pièce
 *     telle que déposée (même condensat, mêmes octets) ;
 *   · une pièce sans fichier figure comme manquante, sans faire échouer le pack ;
 *   · la réponse 200 porte le condensat de l'archive, et le journal l'enregistre ;
 *   · un lecteur (sans export:run) est refusé (403) ; une autre organisation ne voit
 *     rien (404) ;
 *   · une pièce altérée sur le support, ou absente, fait échouer le pack en 500 avec
 *     l'identifiant de la pièce, et ne laisse aucune trace d'export ;
 *   · après réparation du support, le pack est à nouveau produit.
 */
import { randomUUID, createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

import { BASE, PASSWORD, Session, connecter } from "./e2e/client";
import { unzipSync } from "fflate";

import { verifierPack } from "../src/lib/evidence/pack";

const RUN = Date.now().toString(36);
let passed = 0;
const failures: string[] = [];
const erreursServeur: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  🔴 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(titre: string): void {
  console.log(`\n##### ${titre} #####`);
}

type Reponse = { status: number; json: any };

const PAUSE_MS = 70;
const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS));

async function appel(s: Session, methode: string, chemin: string, corps?: unknown): Promise<Reponse> {
  await pause();
  const entetes: Record<string, string> =
    methode === "GET" ? {} : { "idempotency-key": `pack-${RUN}-${randomUUID()}` };
  // Une chaîne est un corps JSON déjà écrit : la précision des coordonnées est conservée.
  const r = (typeof corps === "string"
    ? await s.request(methode, chemin, undefined, corps, entetes)
    : await s.request(methode, chemin, corps, undefined, entetes)) as Reponse;
  if (r.status >= 500) erreursServeur.push(`${methode} ${chemin} → ${r.status}`);
  return r;
}

async function envoyerFichier(s: Session, champs: Record<string, string>, contenu: string): Promise<Reponse> {
  await pause();
  const form = new FormData();
  for (const [k, v] of Object.entries(champs)) form.set(k, v);
  form.set("file", new Blob([contenu], { type: "application/pdf" }), `piece-${RUN}.pdf`);
  const res = await fetch(`${BASE}/api/v1/documents`, {
    method: "POST",
    headers: { accept: "application/json", cookie: s.cookieHeader() },
    body: form,
    redirect: "manual",
  });
  if (res.status >= 500) erreursServeur.push(`POST /api/v1/documents → ${res.status}`);
  const texte = await res.text();
  let json: any = null;
  try {
    json = texte ? JSON.parse(texte) : null;
  } catch {
    json = { brut: texte.slice(0, 200) };
  }
  return { status: res.status, json };
}

interface Telechargement {
  status: number;
  headers: Headers;
  octets: Uint8Array;
  json: any;
}

/** Téléchargement brut : le pack est binaire, il ne passe pas par le décodage JSON du client. */
async function telecharger(s: Session | null, chemin: string): Promise<Telechargement> {
  await pause();
  const res = await fetch(`${BASE}${chemin}`, {
    method: "GET",
    headers: s ? { cookie: s.cookieHeader() } : {},
    redirect: "manual",
  });
  if (res.status >= 500) erreursServeur.push(`GET ${chemin} → ${res.status}`);
  const octets = new Uint8Array(await res.arrayBuffer());
  let json: any = null;
  if (res.headers.get("content-type")?.includes("json")) {
    try {
      json = JSON.parse(new TextDecoder().decode(octets));
    } catch {
      json = null;
    }
  }
  return { status: res.status, headers: res.headers, octets, json };
}

const sha256 = (o: Uint8Array): string => createHash("sha256").update(o).digest("hex");
const ALEA = "00000000-0000-4000-8000-00000000abcd";

function polygone(lon: number, lat: number): string {
  const f = (v: number): string => v.toFixed(6);
  const l1 = lon + 0.01;
  const a1 = lat + 0.01;
  return `{"type":"Polygon","coordinates":[[[${f(lon)},${f(lat)}],[${f(l1)},${f(lat)}],[${f(l1)},${f(a1)}],[${f(lon)},${f(a1)}],[${f(lon)},${f(lat)}]]]}`;
}

async function main(): Promise<void> {
  if (!PASSWORD) throw new Error("E2E_PASSWORD absent : renseignez le mot de passe des comptes de test (sans l'afficher).");
  if (!process.env.DATABASE_URL_ADMIN) throw new Error("DATABASE_URL_ADMIN absent (fixture et contrôles de journal).");

  const db = new Client({ connectionString: process.env.DATABASE_URL_ADMIN });
  await db.connect();
  const stockage = process.env.GF_STORAGE_DIR ?? join(process.cwd(), "var", "storage");

  const admin = await connecter("admin@geoforest.eu", "admin-A");
  const lecteur = await connecter("lecteur@geoforest.eu", "lecteur-A");
  const adminB = await connecter("admin@tenant-b.test", "admin-B");

  // ------------------------------------------------------------------ Fixtures
  section("Fixtures (via l'API, organisation A)");
  const nom = `PACK-${RUN}`;
  const fournisseur = await appel(admin, "POST", "/api/v1/suppliers", { name: `Fournisseur ${nom}`, commodity: "cocoa", country: "CI" });
  const produit = await appel(admin, "POST", "/api/v1/products", { name: `Produit ${nom}`, commodity: "cocoa", countryOfOrigin: "CI", annualVolumeKg: 1000 });
  check("fournisseur et produit créés", fournisseur.status < 300 && produit.status < 300, `${fournisseur.status}/${produit.status}`);
  const supplierId = fournisseur.json?.id;

  const dds = await appel(admin, "POST", "/api/v1/due-diligence", {
    title: `Dossier ${nom}`,
    commodity: "cocoa",
    supplierId,
    productId: produit.json?.id,
    netWeightKg: 500,
  });
  check("dossier créé", dds.status < 300 && typeof dds.json?.id === "string", `${dds.status}`);
  const ddsId: string = dds.json?.id;

  const audit = await appel(
    admin,
    "POST",
    "/api/v1/audit/parcel",
    `{"geojson":${polygone(-3.223457, 5.223457)},"commodity":"cocoa","harvest_date":"2025-03-01","operator":{"name":"Op ${nom}","eori":"FR12345678901234"},"parcel_reference":"${nom}","due_diligence_id":"${ddsId}"}`,
  );
  check("analyse rattachée au dossier", audit.status < 300 && typeof audit.json?.audit_id === "string", `${audit.status} ${JSON.stringify(audit.json ?? {}).slice(0, 240)}`);
  const auditId: string = audit.json?.audit_id;

  const contenuPiece = `%PDF-1.4 ${RUN} pack de preuves`;
  const piece = await envoyerFichier(admin, { title: `Titre ${nom}`, category: "LAND_TENURE", supplierId }, contenuPiece);
  check("pièce déposée avec son fichier", piece.status < 300, `${piece.status}`);
  const pieceId: string = piece.json?.id ?? piece.json?.document?.id;

  const sansFichier = await appel(admin, "POST", "/api/v1/documents", {
    title: `Sans fichier ${nom}`,
    category: "TAX_CLEARANCE",
    supplierId,
  });
  check("pièce déclarée sans fichier", sansFichier.status < 300, `${sansFichier.status}`);
  const idSansFichier: string | undefined = sansFichier.json?.id ?? sansFichier.json?.document?.id;

  // FIXTURE : analyse marquée probante, source explicite (B1 BLOCKED_EXTERNAL).
  await db.query(
    "UPDATE parcel_audits SET analysis_probative = true, analysis_source = 'fixture-test-probant' WHERE id = $1",
    [auditId],
  );
  console.log("  ℹ️  fixture : analyse marquée probante (source fixture-test-probant, non satellite)");

  const cheminPack = `/api/v1/due-diligence/${ddsId}/evidence-pack`;

  // ------------------------------------------------------------ Pack complet
  section("Pack complet (administrateur)");
  const p = await telecharger(admin, cheminPack);
  check("réponse 200", p.status === 200, `${p.status}`);
  check("type ZIP", (p.headers.get("content-type") ?? "").includes("application/zip"));
  check("en-tête de condensat présent", /^[0-9a-f]{64}$/.test(p.headers.get("x-geoforest-sha256") ?? ""));
  check(
    "condensat d'en-tête = condensat du corps",
    p.headers.get("x-geoforest-sha256") === sha256(p.octets),
  );
  // Archive conservée pour la vérification hors ligne (scripts/verifier-pack.ts), si demandé.
  if (process.env.PACK_SORTIE) writeFileSync(process.env.PACK_SORTIE, p.octets);
  const rapport = verifierPack(p.octets);
  check("archive cohérente (verifierPack)", rapport.ok, rapport.anomalies.join(" ; "));
  const m = rapport.manifeste as any;
  check("manifeste : dossier identifié", m?.dossier?.id === ddsId);
  const pieceDecrite = (m?.pieces ?? []).find((x: any) => x.document_id === pieceId);
  check("pièce déposée décrite avec son condensat", pieceDecrite?.sha256 === sha256(new TextEncoder().encode(contenuPiece)));
  check("pièce déposée présente dans l'archive", pieceDecrite?.fichier && rapport.fichiers >= 6);
  if (pieceDecrite?.fichier) {
    const entrees = unzipSync(p.octets);
    check(
      "octets de la pièce identiques à ceux déposés",
      Buffer.from(entrees[pieceDecrite.fichier]).equals(Buffer.from(contenuPiece)),
    );
  }
  if (idSansFichier) {
    const decrite = (m?.pieces ?? []).find((x: any) => x.document_id === idSansFichier);
    check("pièce sans fichier figurant comme manquante", decrite?.sans_fichier === true && decrite?.fichier === null);
  }
  check(
    "non vérifié : antivirus absent signalé",
    (m?.non_verifie ?? []).some((t: string) => t.includes("antivirus")),
  );
  check(
    "non vérifié : source non officielle signalée",
    (m?.non_verifie ?? []).some((t: string) => t.includes("fixture-test-probant")),
  );
  check(
    "non vérifié : absence de transmission TRACES signalée",
    (m?.non_verifie ?? []).some((t: string) => t.includes("TRACES NT")),
  );
  check("readiness présente dans le manifeste", typeof m?.readiness?.etat === "string", `${m?.readiness?.etat}`);
  check("analyse décrite avec sa provenance", (m?.analyses ?? []).some((a: any) => a.id === auditId && a.source === "fixture-test-probant"));
  check("journal : entrées du dossier présentes", (m?.journal?.entrees_dossier ?? 0) >= 2, `${m?.journal?.entrees_dossier}`);

  // --------------------------------------------------------------- Journal
  section("Journalisation de l'export");
  const exports = async (): Promise<number> => {
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM gf_audit_logs WHERE entity_type = 'DDS' AND entity_id = $1 AND action = 'EXPORT' AND details->>'nature' = 'pack_preuves'",
      [ddsId],
    );
    return rows[0].n;
  };
  const avant = await exports();
  const p2 = await telecharger(admin, cheminPack);
  check("second pack produit", p2.status === 200, `${p2.status}`);
  const apres = await exports();
  check("chaque pack réussi est journalisé", apres === avant + 1, `${avant} → ${apres}`);
  const { rows: derniers } = await db.query(
    "SELECT details->>'sha256_archive' AS sha FROM gf_audit_logs WHERE entity_type = 'DDS' AND entity_id = $1 AND action = 'EXPORT' AND details->>'nature' = 'pack_preuves' ORDER BY sequence DESC LIMIT 1",
    [ddsId],
  );
  check("journal : condensat de l'archive = condensat renvoyé", derniers[0]?.sha === p2.headers.get("x-geoforest-sha256"));

  // ------------------------------------------------------------ Autorisations
  section("Autorisations et cloisonnement");
  const lect = await telecharger(lecteur, cheminPack);
  check("lecteur (sans export:run) : 403", lect.status === 403, `${lect.status}`);
  const etr = await telecharger(adminB, cheminPack);
  check("autre organisation : 404, aucune fuite", etr.status === 404, `${etr.status}`);
  const anonyme = await telecharger(null, cheminPack);
  check("sans session : refusé", anonyme.status === 401 || anonyme.status === 403, `${anonyme.status}`);
  const inconnu = await telecharger(admin, `/api/v1/due-diligence/${ALEA}/evidence-pack`);
  check("dossier inexistant : 404", inconnu.status === 404, `${inconnu.status}`);
  const mal = await telecharger(admin, "/api/v1/due-diligence/pas-un-uuid/evidence-pack");
  check("identifiant mal formé : 404", mal.status === 404, `${mal.status}`);
  check("refus : aucune trace d'export", (await exports()) === apres);

  // ------------------------------------------------------------- Incidents
  section("Incident : contenu altéré sur le support");
  const { rows: cle } = await db.query("SELECT storage_key FROM gf_documents WHERE id = $1", [pieceId]);
  const chemin = join(stockage, ...String(cle[0].storage_key).split("/"));
  check("fichier de la pièce présent sur le support", existsSync(chemin));
  const original = readFileSync(chemin);
  try {
    // Même taille, un seul octet modifié : seul le contrôle de condensat peut refuser.
    const altere = Buffer.from(original);
    altere[altere.length - 1] ^= 0x01;
    writeFileSync(chemin, altere);
    const alt = await telecharger(admin, cheminPack);
    check("pack refusé en 500 (un octet modifié, taille identique)", alt.status === 500, `${alt.status}`);
    check("le refus désigne la pièce", alt.json?.piece === pieceId, `${alt.json?.piece ?? "—"}`);
    check("le refus invoque l'empreinte", String(alt.json?.detail ?? "").includes("empreinte"));
    check("réponse d'erreur JSON, pas d'archive", (alt.headers.get("content-type") ?? "").includes("application/json"));
    check("refus : aucune trace d'export", (await exports()) === apres);
  } finally {
    writeFileSync(chemin, original);
  }
  const repare = await telecharger(admin, cheminPack);
  check("après restauration du support : pack à nouveau produit", repare.status === 200, `${repare.status}`);

  section("Incident : taille différente sur le support");
  const avantTaille = await exports();
  writeFileSync(chemin, Buffer.concat([original, Buffer.from("\n% ajout hors application\n")]));
  try {
    const taille = await telecharger(admin, cheminPack);
    check("pack refusé en 500 (taille différente)", taille.status === 500, `${taille.status}`);
    check("le refus désigne la pièce (taille)", taille.json?.piece === pieceId, `${taille.json?.piece ?? "—"}`);
    check("refus : aucune trace d'export (taille)", (await exports()) === avantTaille);
  } finally {
    writeFileSync(chemin, original);
  }

  section("Incident : fichier absent du support");
  const aside = `${chemin}.absent`;
  renameSync(chemin, aside);
  try {
    const abs = await telecharger(admin, cheminPack);
    check("pack refusé en 500 (fichier absent)", abs.status === 500, `${abs.status}`);
    check("le refus désigne la pièce absente", abs.json?.piece === pieceId, `${abs.json?.piece ?? "—"}`);
  } finally {
    renameSync(aside, chemin);
  }
  const repare2 = await telecharger(admin, cheminPack);
  check("après remise en place : pack à nouveau produit", repare2.status === 200, `${repare2.status}`);

  // ------------------------------------------------------------ Bilan
  section("Erreurs serveur");
  // Les seuls 500 attendus sont les trois incidents provoqués ci-dessus.
  const attendus = erreursServeur.filter((e) => e.startsWith(`GET ${cheminPack} → 500`));
  check(
    "aucune réponse 5xx hors incidents provoqués",
    erreursServeur.length === attendus.length,
    erreursServeur.filter((e) => !attendus.includes(e)).join(" ; ") || "aucune",
  );
  check("exactement trois incidents provoqués", attendus.length === 3, `${attendus.length}`);

  await db.end();
  console.log(`\nRésultat : ${passed} contrôle(s) réussi(s), ${failures.length} échec(s).`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((erreur) => {
  console.error("🔴 Erreur inattendue :", erreur);
  process.exit(1);
});
