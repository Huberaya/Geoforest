/**
 * Machine d'état des dossiers DDS — parcours HTTP sur le serveur réel (B-12, chantier 3).
 *
 * Exécution (serveur démarré, comptes fraîchement réinitialisés) :
 *   npm run seed:auth -- --reset
 *   E2E_BASE_URL=http://127.0.0.1:3100 E2E_PASSWORD=… DATABASE_URL_ADMIN=… \
 *     npx tsx --conditions=react-server scripts/check-dds-etats-http.ts
 *
 * ⚠️ FIXTURE DÉCLARÉE. Aucune analyse satellite réelle n'est disponible dans ce
 *   environnement (B1, BLOCKED_EXTERNAL). Pour atteindre READY_FOR_DECLARATION, le
 *   script pose le drapeau `analysis_probative` sur l'audit de test, avec la source
 *   `fixture-test-probant` (jamais une source satellite). Ce test prouve la machine
 *   d'état et le contrôle de l'export ; il ne prouve pas la donnée satellite.
 *
 * Verdicts attendus :
 *   · SUBMITTED, DECLARED, EXPORTED ne sont jamais atteints par PATCH ;
 *   · EXPORTED n'est posé que par l'export d'un dossier READY_FOR_DECLARATION, et
 *     l'export le fait dans la même transaction, tracé au journal ;
 *   · un dossier figé refuse rattachement, détachement et modification de ses données ;
 *   · un export qui ne tient plus la readiness est refusé et ne change pas le statut ;
 *   · une organisation étrangère ne voit, ne modifie ni n'exporte rien (404) ;
 *   · aucune réponse 5xx.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { BASE, PASSWORD, Session, connecter } from "./e2e/client";

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

// Cadence du client de test (limiteur : 150 requêtes / 10 s par organisation).
const PAUSE_MS = 70;
const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS));

async function appel(s: Session, methode: string, chemin: string, corps?: unknown): Promise<Reponse> {
  await pause();
  // Idempotence (P1-11) : sans clé, une requête identique est rejouée pendant 30 s, réponse
  // de la première. Chaque écriture porte donc sa propre clé : elle est réellement exécutée.
  const entetes: Record<string, string> =
    methode === "GET" ? {} : { "idempotency-key": `ddsetat-${RUN}-${randomUUID()}` };
  // Une chaîne est un corps JSON déjà écrit : la précision des coordonnées (EUDR) est conservée.
  const r = (typeof corps === "string"
    ? await s.request(methode, chemin, undefined, corps, entetes)
    : await s.request(methode, chemin, corps, undefined, entetes)) as Reponse;
  if (r.status >= 500) erreursServeur.push(`${methode} ${chemin} → ${r.status}`);
  return r;
}

async function envoyerFichier(s: Session, champs: Record<string, string>): Promise<Reponse> {
  await pause();
  const form = new FormData();
  for (const [k, v] of Object.entries(champs)) form.set(k, v);
  form.set("file", new Blob([`%PDF-1.4 ${RUN}`], { type: "application/pdf" }), `piece-${RUN}.pdf`);
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

const reussi = (r: Reponse) => r.status >= 200 && r.status < 300;
const refuse = (r: Reponse, code: number) => r.status === code;
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

  const admin = await connecter("admin@geoforest.eu", "admin-A");
  const lecteur = await connecter("lecteur@geoforest.eu", "lecteur-A");
  const adminB = await connecter("admin@tenant-b.test", "admin-B");

  // ------------------------------------------------------------------ Fixtures
  section("Fixtures (via l'API, organisation A)");
  const nom = `DDS-ETAT-${RUN}`;
  const fournisseur = await appel(admin, "POST", "/api/v1/suppliers", { name: `Fournisseur ${nom}`, commodity: "cocoa", country: "CI" });
  const produit = await appel(admin, "POST", "/api/v1/products", { name: `Produit ${nom}`, commodity: "cocoa", countryOfOrigin: "CI", annualVolumeKg: 1000 });
  check("fournisseur et produit créés", reussi(fournisseur) && reussi(produit), `${fournisseur.status}/${produit.status}`);
  const supplierId = fournisseur.json?.id;
  const productId = produit.json?.id;

  const dds = await appel(admin, "POST", "/api/v1/due-diligence", {
    title: `Dossier ${nom}`,
    commodity: "cocoa",
    supplierId,
    productId,
    netWeightKg: 500,
  });
  check("dossier créé en DRAFT", reussi(dds) && dds.json?.status === "DRAFT", `${dds.status} ${dds.json?.status}`);
  const ddsId: string = dds.json?.id;

  const poly = polygone(-3.123457, 5.123457);
  const audit = await appel(
    admin,
    "POST",
    "/api/v1/audit/parcel",
    `{"geojson":${poly},"commodity":"cocoa","harvest_date":"2025-03-01","operator":{"name":"Op ${nom}","eori":"FR12345678901234"},"parcel_reference":"${nom}","due_diligence_id":"${ddsId}"}`,
  );
  check("analyse de parcelle créée et rattachée au dossier", reussi(audit) && typeof audit.json?.audit_id === "string", `${audit.status}`);
  const auditId: string = audit.json?.audit_id;

  const piece = await envoyerFichier(admin, { title: `Titre ${nom}`, category: "LAND_TENURE", supplierId });
  check("pièce LAND_TENURE déposée", reussi(piece), `${piece.status}`);
  const pieceId: string = piece.json?.id ?? piece.json?.document?.id;
  const valide = await appel(admin, "PATCH", `/api/v1/documents/${pieceId}`, { status: "VALID" });
  check("pièce validée par la conformité (dds:validate)", reussi(valide), `${valide.status}`);

  // FIXTURE : l'analyse est marquée probante pour que la readiness puisse se lire « prête ».
  // Source explicite : ce n'est pas une donnée satellite (B1 BLOCKED_EXTERNAL).
  await db.query(
    "UPDATE parcel_audits SET analysis_probative = true, analysis_source = 'fixture-test-probant' WHERE id = $1",
    [auditId],
  );
  console.log("  ℹ️  fixture : analyse marquée probante (source fixture-test-probant, non satellite)");

  const estDossier = async (statut: string) => {
    const r = await appel(admin, "GET", `/api/v1/due-diligence/${ddsId}`);
    return r.json?.status === statut;
  };

  // ------------------------------------------------------- Cibles réservées refusées
  section("Cibles réservées refusées par PATCH");
  for (const cible of ["EXPORTED", "SUBMITTED", "DECLARED"]) {
    const r = await appel(admin, "PATCH", `/api/v1/due-diligence/${ddsId}`, { status: cible });
    check(`PATCH status=${cible} refusé (409)`, refuse(r, 409), `HTTP ${r.status}`);
  }
  check("le dossier reste DRAFT après les refus", await estDossier("DRAFT"));
  const saut = await appel(admin, "PATCH", `/api/v1/due-diligence/${ddsId}`, { status: "READY_FOR_DECLARATION" });
  check("DRAFT → READY_FOR_DECLARATION refusé (passage par la revue)", refuse(saut, 409), `HTTP ${saut.status}`);

  // ------------------------------------------------------------------ Revue
  section("Revue puis export en UNDER_REVIEW");
  check("DRAFT → IN_ANALYSIS", reussi(await appel(admin, "PATCH", `/api/v1/due-diligence/${ddsId}`, { status: "IN_ANALYSIS" })));
  check("IN_ANALYSIS → UNDER_REVIEW", reussi(await appel(admin, "PATCH", `/api/v1/due-diligence/${ddsId}`, { status: "UNDER_REVIEW" })));

  const CORPS_EXPORT_BASE = {
    audit_id: auditId,
    format: "json",
    operator: { name: `Op ${nom}`, eori: "FR12345678901234", country: "FR" },
    producer: { same_as_operator: true },
    net_weight_kg: 500,
    activity_type: "IMPORT",
    // Depuis l'arbitrage de la fusion #9, le pays d'activité est obligatoire et
    // n'est jamais déduit (422 sinon). Ce harnais, hors CI, l'omettait encore :
    // 10 contrôles échouaient sur une 422 sans rapport avec la machine à états.
    country_of_activity: "FR",
  };
  // Chaque export porte une référence interne distincte (lisible dans le journal).
  let exportN = 0;
  const corpsExport = (): Record<string, unknown> => ({ ...CORPS_EXPORT_BASE, internal_reference: `${nom}-${++exportN}` });
  const exportRevue = await appel(admin, "POST", "/api/v1/export/traces", corpsExport());
  check("export d'un dossier en revue accepté", reussi(exportRevue), `HTTP ${exportRevue.status} ${JSON.stringify(exportRevue.json ?? {}).slice(0, 120)}`);
  check("export en revue ne change pas le statut (UNDER_REVIEW)", await estDossier("UNDER_REVIEW"));

  // ----------------------------------------------------------------- Prêt
  section("Passage à READY_FOR_DECLARATION, puis figement");
  const readiness = await appel(admin, "GET", `/api/v1/due-diligence/${ddsId}`);
  check("readiness calculée avant validation", readiness.json?.readiness?.etat === "READY_FOR_REVIEW", `${readiness.json?.readiness?.etat}`);
  const pret = await appel(admin, "PATCH", `/api/v1/due-diligence/${ddsId}`, { status: "READY_FOR_DECLARATION" });
  check("UNDER_REVIEW → READY_FOR_DECLARATION (readiness complète)", reussi(pret), `HTTP ${pret.status} ${JSON.stringify(pret.json ?? {}).slice(0, 160)}`);

  const modifTitre = await appel(admin, "PATCH", `/api/v1/due-diligence/${ddsId}`, { title: `Renommé ${RUN}` });
  check("dossier prêt : modification du titre refusée (409, figé)", refuse(modifTitre, 409), `HTTP ${modifTitre.status}`);
  const detache = await appel(admin, "DELETE", `/api/v1/due-diligence/${ddsId}/audits/${auditId}`);
  check("dossier prêt : détachement d'analyse refusé (409)", refuse(detache, 409), `HTTP ${detache.status}`);
  const rattache = await appel(admin, "POST", `/api/v1/due-diligence/${ddsId}/audits`, { audit_id: auditId });
  check("dossier prêt : rattachement refusé (409)", refuse(rattache, 409), `HTTP ${rattache.status}`);

  // --------------------------------------------------------------- Export réel
  section("Export d'un dossier prêt : EXPORTED posé par l'export");
  const journalAvant = await db.query(
    "SELECT count(*)::int AS n FROM gf_audit_logs WHERE entity_type = 'DDS' AND entity_id = $1 AND action = 'EXPORT'",
    [ddsId],
  );
  const export1 = await appel(admin, "POST", "/api/v1/export/traces", corpsExport());
  check("export accepté pour un dossier prêt", reussi(export1), `HTTP ${export1.status}`);
  check("le dossier passe à EXPORTED par l'export", await estDossier("EXPORTED"));
  const journalApres = await db.query(
    "SELECT count(*)::int AS n FROM gf_audit_logs WHERE entity_type = 'DDS' AND entity_id = $1 AND action = 'EXPORT'",
    [ddsId],
  );
  check(
    "la transition est tracée au journal (une entrée DDS EXPORT)",
    journalApres.rows[0].n === journalAvant.rows[0].n + 1,
    `${journalAvant.rows[0].n} → ${journalApres.rows[0].n}`,
  );
  const lectureApres = await appel(admin, "GET", `/api/v1/due-diligence/${ddsId}`);
  check(
    "readiness d'un dossier EXPORTED : READY_FOR_DDS (non rétrogradée)",
    lectureApres.json?.readiness?.etat === "READY_FOR_DDS",
    `${lectureApres.json?.readiness?.etat}`,
  );

  const export2 = await appel(admin, "POST", "/api/v1/export/traces", corpsExport());
  check("ré-export d'un dossier EXPORTED accepté", reussi(export2), `HTTP ${export2.status}`);
  check("ré-export : le statut reste EXPORTED", await estDossier("EXPORTED"));
  const journalRe = await db.query(
    "SELECT count(*)::int AS n FROM gf_audit_logs WHERE entity_type = 'DDS' AND entity_id = $1 AND action = 'EXPORT'",
    [ddsId],
  );
  check("ré-export : pas de seconde transition journalisée", journalRe.rows[0].n === journalApres.rows[0].n);

  // ------------------------------------------- Export refusé si la readiness tombe
  section("Export refusé quand la readiness ne tient plus");
  await db.query("UPDATE gf_documents SET expiry_date = '2020-01-01' WHERE id = $1", [pieceId]);
  const expire = await appel(admin, "POST", "/api/v1/export/traces", corpsExport());
  check("export refusé (409) : pièce obligatoire expirée", refuse(expire, 409), `HTTP ${expire.status}`);
  check("refus d'export : le statut EXPORTED est conservé", await estDossier("EXPORTED"));
  await db.query("UPDATE gf_documents SET expiry_date = NULL WHERE id = $1", [pieceId]);
  const retabli = await appel(admin, "POST", "/api/v1/export/traces", corpsExport());
  check("export de nouveau accepté une fois la pièce rétablie", reussi(retabli), `HTTP ${retabli.status}`);

  // --------------------------------------------------------------- Cloisonnement
  section("Cloisonnement inter-organisations");
  check("organisation B ne lit pas le dossier de A (404)", refuse(await appel(adminB, "GET", `/api/v1/due-diligence/${ddsId}`), 404));
  check("organisation B ne modifie pas le dossier de A (404)", refuse(await appel(adminB, "PATCH", `/api/v1/due-diligence/${ddsId}`, { status: "UNDER_REVIEW" }), 404));
  check("organisation B n'exporte pas l'analyse de A (404)", refuse(await appel(adminB, "POST", "/api/v1/export/traces", corpsExport()), 404));
  check("le dossier de A est inchangé après les tentatives de B", await estDossier("EXPORTED"));

  // ---------------------------------------------------------------- Permissions
  section("Permissions");
  check("lecteur ne peut pas changer le statut (403)", refuse(await appel(lecteur, "PATCH", `/api/v1/due-diligence/${ddsId}`, { status: "UNDER_REVIEW" }), 403));
  check("identifiant inexistant : 404", refuse(await appel(admin, "PATCH", `/api/v1/due-diligence/${ALEA}`, { status: "UNDER_REVIEW" }), 404));

  // ------------------------------------------------ Sortie de l'état exporté
  section("Sortie de EXPORTED : nouvelle revue");
  check("EXPORTED → UNDER_REVIEW accepté", reussi(await appel(admin, "PATCH", `/api/v1/due-diligence/${ddsId}`, { status: "UNDER_REVIEW" })));
  check("après sortie, le titre est de nouveau modifiable", reussi(await appel(admin, "PATCH", `/api/v1/due-diligence/${ddsId}`, { title: `Titre révisé ${RUN}` })));
  check("statut UNDER_REVIEW après sortie", await estDossier("UNDER_REVIEW"));

  // --------------------------------------------------------------- Bilan
  section("Bilan");
  check("aucune réponse 5xx pendant le parcours", erreursServeur.length === 0, erreursServeur.join(" ; ") || "aucune");

  await db.end();
  console.log(`\n${passed} contrôles réussis, ${failures.length} échec(s).`);
  if (failures.length > 0) {
    console.log("Échecs :");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("ERREUR :", e instanceof Error ? e.message : e);
  process.exit(1);
});
