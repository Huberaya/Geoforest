/**
 * Lot A — contrôle HTTP réel de l'export TRACES : identité de l'opérateur.
 *
 * Exécution (serveur démarré, comptes de démonstration réinitialisés) :
 *   E2E_BASE_URL=http://127.0.0.1:3000 E2E_PASSWORD=… DATABASE_URL_ADMIN=… \
 *     npx tsx --conditions=react-server scripts/check-export-identite-http.ts
 *
 * ⚠️ Pourquoi ce script existe.
 *
 *   `resoudreIdentiteExport()` est une fonction pure, testée dans
 *   `check-identite-operateur.ts` (7 cas). Cela ne prouve **pas** que la route
 *   répond 422 : entre la fonction et la réponse HTTP, il y a le garde
 *   d'authentification, la lecture du corps, les contrôles préalables, la
 *   sérialisation et le statut. Un test unitaire ne peut pas établir qu'un
 *   client reçoit réellement le code `OPERATOR_IDENTITY_MISSING`.
 *
 *   Ce contrôle passe donc par HTTP, sur la route réelle, avec un serveur
 *   Next.js et une base PostgreSQL migrée — ceux de la CI, sur branche
 *   éphémère. Il vérifie :
 *     · 422 + `OPERATOR_IDENTITY_MISSING` pour une identité absente ;
 *     · la sentinelle héritée ne peut plus être **écrite** (contrainte 025) ;
 *     · les formats JSON **et** XML (le second aurait pu être un contournement) ;
 *     · qu'une identité fournie au moment de l'export produit bien un 200 ;
 *     · l'ordre des refus : géométrie invalide (409) → identité (422) →
 *       valeur probante (409) → déforestation établie (409) ;
 *     · qu'aucun refus 422 ne laisse de trace d'export (pas d'effet de bord).
 *
 * ⚠️ Fixture déclarée. L'analyse satellite n'est pas disponible dans cet
 *   environnement : le script marque l'audit `analysis_probative` avec la
 *   source `fixture-test-probant` (jamais une source satellite), exactement
 *   comme `check-dds-etats-http.ts`. Ce contrôle porte sur l'identité de
 *   l'opérateur, pas sur la donnée satellite.
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

const PAUSE_MS = 70;
const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS));

interface ReponseBrute {
  status: number;
  texte: string;
  typeContenu: string;
  json: any;
}

/**
 * Appel HTTP brut : le format XML ne se lit pas en JSON, et le statut doit être
 * observé tel qu'un client le reçoit.
 */
async function poster(s: Session, chemin: string, corps: unknown): Promise<ReponseBrute> {
  await pause();
  const res = await fetch(`${BASE}${chemin}`, {
    method: "POST",
    headers: {
      accept: "application/json, application/xml",
      "content-type": "application/json",
      cookie: s.cookieHeader(),
      // Idempotence : chaque requête porte sa clé, aucune ne peut être rejouée
      // à la place d'une autre.
      "idempotency-key": `exp-ident-${RUN}-${randomUUID()}`,
    },
    body: JSON.stringify(corps),
    redirect: "manual",
  });
  const texte = await res.text();
  let json: any = null;
  try {
    json = texte ? JSON.parse(texte) : null;
  } catch {
    json = null;
  }
  if (res.status >= 500) erreursServeur.push(`POST ${chemin} → ${res.status}`);
  return { status: res.status, texte, typeContenu: res.headers.get("content-type") ?? "", json };
}

/** Polygone de ~1,2 ha (Éthiopie), même géométrie que la suite principale. */
function polygone(lon: number, lat: number): string {
  const f = (v: number): string => v.toFixed(6);
  const l1 = lon + 0.01;
  const a1 = lat + 0.01;
  return `{"type":"Polygon","coordinates":[[[${f(lon)},${f(lat)}],[${f(l1)},${f(lat)}],[${f(l1)},${f(a1)}],[${f(lon)},${f(a1)}],[${f(lon)},${f(lat)}]]]}`;
}

async function main(): Promise<void> {
  if (!PASSWORD) {
    throw new Error("E2E_PASSWORD absent : renseignez le mot de passe des comptes de test (sans l'afficher).");
  }
  if (!process.env.DATABASE_URL_ADMIN) {
    throw new Error("DATABASE_URL_ADMIN absent (fixture et vérification de l'état en base).");
  }

  const db = new Client({ connectionString: process.env.DATABASE_URL_ADMIN });
  await db.connect();

  const admin = await connecter("admin@geoforest.eu", "admin-A");

  /** Crée un audit sans opérateur, par HTTP — c'est déjà le lot A en action. */
  async function creerAudit(reference: string): Promise<string> {
    const r = await poster(admin, "/api/v1/audit/parcel", {
      geojson: JSON.parse(polygone(-3.123457, 5.123457)),
      commodity: "cocoa",
      harvest_date: "2025-03-01",
      parcel_reference: reference,
    });
    if (r.status !== 201 || typeof r.json?.audit_id !== "string") {
      throw new Error(`Création d'audit impossible (HTTP ${r.status}) : ${r.texte.slice(0, 200)}`);
    }
    return r.json.audit_id as string;
  }

  /** Fixture d'analyse probante, source explicitement non satellite. */
  async function rendreProbant(id: string, statut = "COMPLIANT"): Promise<void> {
    await db.query(
      "UPDATE parcel_audits SET analysis_probative = true, analysis_source = 'fixture-test-probant', " +
        "status = $2, compliant = true WHERE id = $1",
      [id, statut],
    );
  }

  async function identiteEnBase(id: string): Promise<{ name: string | null; eori: string | null; pays: string | null; brouillon: string | null }> {
    const { rows } = await db.query(
      "SELECT operator_name, operator_eori, operator_country, draft_reference FROM parcel_audits WHERE id = $1",
      [id],
    );
    const r = rows[0];
    return { name: r.operator_name, eori: r.operator_eori, pays: r.operator_country, brouillon: r.draft_reference };
  }

  const producteur = { name: `Coopérative ${RUN}`, country: "CI" };

  // ================================================================ Fixtures
  section("0. Création sans opérateur — lot A par HTTP");

  const auditAbsent = await creerAudit(`EXP-IDENT-ABSENT-${RUN}`);
  const etatCree = await identiteEnBase(auditAbsent);
  check("audit créé sans opérateur : 201 accepté", true, auditAbsent.slice(0, 8));
  check(
    "aucune identité fabriquée en base (name/eori/pays NULL)",
    etatCree.name === null && etatCree.eori === null && etatCree.pays === null,
    JSON.stringify(etatCree),
  );
  await rendreProbant(auditAbsent);

  // ================================================== 1. Identité absente
  section("1. Identité absente : refus HTTP 422 (JSON et XML)");

  const absentJson = await poster(admin, "/api/v1/export/traces", {
    audit_id: auditAbsent,
    format: "json",
  });
  check("format JSON → HTTP 422", absentJson.status === 422, `HTTP ${absentJson.status}`);
  check(
    "format JSON → code `OPERATOR_IDENTITY_MISSING`",
    absentJson.json?.code === "OPERATOR_IDENTITY_MISSING",
    JSON.stringify(absentJson.json ?? {}).slice(0, 160),
  );
  check(
    "format JSON → état `missing`",
    absentJson.json?.operator_identity === "missing",
    String(absentJson.json?.operator_identity),
  );
  check(
    "format JSON → le message ne fabrique aucune identité de remplacement",
    typeof absentJson.json?.detail === "string" &&
      !absentJson.json.detail.includes("XX0000000000000") &&
      absentJson.json.detail.includes("Aucune identité de remplacement"),
  );

  const absentXml = await poster(admin, "/api/v1/export/traces", {
    audit_id: auditAbsent,
    format: "xml",
  });
  check("format XML → HTTP 422 (second format, même règle)", absentXml.status === 422, `HTTP ${absentXml.status}`);
  check(
    "format XML → code `OPERATOR_IDENTITY_MISSING`",
    absentXml.json?.code === "OPERATOR_IDENTITY_MISSING",
    String(absentXml.json?.code),
  );

  const etatApres422 = await identiteEnBase(auditAbsent);
  check(
    "un refus 422 n'écrit aucun brouillon (aucun effet de bord)",
    etatApres422.brouillon === null,
    String(etatApres422.brouillon),
  );

  // ================================================ 2. Sentinelle héritée
  section("2. Sentinelle héritée : stockage refusé, aucun faux EORI à l'export");

  // ⚠️ La migration 025 pose une contrainte : la sentinelle
  //   `XX0000000000000` ne peut plus être écrite. Une base migrée ne peut donc
  //   plus fabriquer de dossier « faussement complet » ; l'état
  //   `legacy_placeholder` reste géré par le code pour les bases non migrées.
  const auditHerite = await creerAudit(`EXP-IDENT-HERITE-${RUN}`);
  await rendreProbant(auditHerite);
  let refusConstraint = "";
  try {
    await db.query(
      "UPDATE parcel_audits SET operator_name = $2, operator_eori = $3, operator_country = $4 WHERE id = $1",
      [auditHerite, "Opérateur non renseigné", "XX0000000000000", "XX"],
    );
  } catch (erreur) {
    const e = erreur as { code?: string; constraint?: string };
    refusConstraint = `${e.code ?? "?"}:${e.constraint ?? "?"}`;
  }
  check(
    "écrire la sentinelle est refusé par la contrainte (23514)",
    refusConstraint.startsWith("23514"),
    refusConstraint || "aucune erreur — la sentinelle a été acceptée",
  );

  const heriteJson = await poster(admin, "/api/v1/export/traces", {
    audit_id: auditHerite,
    format: "json",
  });
  check("format JSON → HTTP 422", heriteJson.status === 422, `HTTP ${heriteJson.status}`);
  check(
    "format JSON → code `OPERATOR_IDENTITY_MISSING`",
    heriteJson.json?.code === "OPERATOR_IDENTITY_MISSING",
    String(heriteJson.json?.code),
  );
  check(
    "format JSON → état `missing` : aucun faux EORI n'est présenté",
    heriteJson.json?.operator_identity === "missing",
    String(heriteJson.json?.operator_identity),
  );

  const heriteXml = await poster(admin, "/api/v1/export/traces", {
    audit_id: auditHerite,
    format: "xml",
  });
  check("format XML → HTTP 422", heriteXml.status === 422, `HTTP ${heriteXml.status}`);

  const etatHerite = await identiteEnBase(auditHerite);
  check(
    "l'audit reste sans identité (aucune valeur écrite)",
    etatHerite.name === null && etatHerite.eori === null && etatHerite.pays === null,
    JSON.stringify({ name: etatHerite.name, eori: etatHerite.eori, pays: etatHerite.pays }),
  );

  // ============================================ 3. Identité fournie à l'export
  section("3. Identité fournie au moment de l'export : 200 sans réécrire le dossier");

  const fourniJson = await poster(admin, "/api/v1/export/traces", {
    audit_id: auditAbsent,
    format: "json",
    operator: { name: "Café Import SAS", eori: "FR12345678901234" },
    producer: producteur,
  });
  check("identité absente + identité fournie (JSON) → HTTP 200", fourniJson.status === 200, `HTTP ${fourniJson.status}`);
  check(
    "la déclaration porte l'EORI fourni",
    fourniJson.texte.includes("FR12345678901234"),
    `type ${fourniJson.typeContenu}`,
  );
  check(
    "le pays n'est pas inventé : préfixe EORI retenu (FR)",
    fourniJson.json?.operator?.country === "FR",
    String(fourniJson.json?.operator?.country),
  );
  const etatApresExport = await identiteEnBase(auditAbsent);
  check(
    "l'export ne réécrit pas l'audit (identité toujours NULL en base)",
    etatApresExport.name === null && etatApresExport.eori === null,
    JSON.stringify({ name: etatApresExport.name, eori: etatApresExport.eori }),
  );

  const fourniXml = await poster(admin, "/api/v1/export/traces", {
    audit_id: auditHerite,
    format: "xml",
    operator: { name: "Café Import SAS", eori: "DE12345678901234" },
    producer: producteur,
  });
  check("dossier hérité + identité fournie (XML) → HTTP 200", fourniXml.status === 200, `HTTP ${fourniXml.status}`);
  check(
    "la déclaration XML porte l'EORI fourni",
    fourniXml.texte.includes("DE12345678901234"),
    `type ${fourniXml.typeContenu}`,
  );
  const etatHeriteApres = await identiteEnBase(auditHerite);
  check(
    "le dossier hérité reste inchangé après l'export",
    etatHeriteApres.eori === "XX0000000000000",
    String(etatHeriteApres.eori),
  );

  // ================================================ 4. Identité stockée valide
  section("4. Identité stockée valide : 200 sans rien fournir");

  const auditValide = await creerAudit(`EXP-IDENT-VALIDE-${RUN}`);
  await rendreProbant(auditValide);
  await db.query(
    "UPDATE parcel_audits SET operator_name = $2, operator_eori = $3 WHERE id = $1",
    [auditValide, "Café Import SAS", "FR12345678901234"],
  );

  const etatValide = await identiteEnBase(auditValide);
  const valideJson = await poster(admin, "/api/v1/export/traces", {
    audit_id: auditValide,
    format: "json",
    producer: producteur,
  });
  check("identité stockée valide → HTTP 200", valideJson.status === 200, `HTTP ${valideJson.status}`);
  // Structure TRACES : l'EORI est porté par `operator.reference_number.identifier`.
  check(
    "identité du dossier retenue",
    valideJson.json?.operator?.reference_number?.identifier === "FR12345678901234",
    String(valideJson.json?.operator?.reference_number?.identifier),
  );
  check(
    "nom du dossier retenu",
    valideJson.json?.operator?.name === "Café Import SAS",
    String(valideJson.json?.operator?.name),
  );
  check(
    "pays non déclaré en base → déduit de l'EORI, jamais 'FR' par défaut",
    valideJson.json?.operator?.country === "FR" && etatValide.pays === null,
    `déclaration=${String(valideJson.json?.operator?.country)} / base=${String(etatValide.pays)}`,
  );

  // ============================================== 5. Ordre des refus
  section("5. Ordre des refus : identité, puis valeur probante et déforestation");

  // ⚠️ La géométrie invalide reste traitée **avant** l'identité : elle décrit
  //   le dossier lui-même, pas la déclaration. En revanche, l'identité précède
  //   la valeur probante et la déforestation : un dossier sans opérateur réel
  //   doit le dire, même si son analyse est simulée — sinon le motif « analyse
  //   non probante » masquerait le défaut d'identité et laisserait croire
  //   qu'il suffit de configurer GFW pour exporter.
  const auditNonProbant = await creerAudit(`EXP-IDENT-409-PROBANT-${RUN}`);
  const nonProbant = await poster(admin, "/api/v1/export/traces", {
    audit_id: auditNonProbant,
    format: "json",
    producer: producteur,
  });
  check(
    "identité absente + analyse non probante → 422 d'identité (ordre délibéré)",
    nonProbant.status === 422 && nonProbant.json?.code === "OPERATOR_IDENTITY_MISSING",
    `HTTP ${nonProbant.status} code=${String(nonProbant.json?.code)}`,
  );

  const nonProbantAvecIdentite = await poster(admin, "/api/v1/export/traces", {
    audit_id: auditNonProbant,
    format: "json",
    operator: { name: "Café Import SAS", eori: "FR12345678901234" },
    producer: producteur,
  });
  check(
    "identité fournie + analyse non probante → 409",
    nonProbantAvecIdentite.status === 409,
    `HTTP ${nonProbantAvecIdentite.status}`,
  );
  check(
    "le 409 ne porte pas le code d'identité",
    nonProbantAvecIdentite.json?.code !== "OPERATOR_IDENTITY_MISSING",
    String(nonProbantAvecIdentite.json?.code),
  );

  const auditNonConforme = await creerAudit(`EXP-IDENT-409-DEFOR-${RUN}`);
  await rendreProbant(auditNonConforme);
  await db.query(
    "UPDATE parcel_audits SET status = 'NON_COMPLIANT', compliant = false, loss_year = 2022 WHERE id = $1",
    [auditNonConforme],
  );
  const nonConforme = await poster(admin, "/api/v1/export/traces", {
    audit_id: auditNonConforme,
    format: "json",
    operator: { name: "Café Import SAS", eori: "FR12345678901234" },
    producer: producteur,
  });
  check(
    "déforestation établie + identité fournie → 409 bloqué",
    nonConforme.status === 409 && nonConforme.json?.blocked === true,
    `HTTP ${nonConforme.status} blocked=${String(nonConforme.json?.blocked)}`,
  );

  const auditGeometrie = await creerAudit(`EXP-IDENT-409-GEOM-${RUN}`);
  await rendreProbant(auditGeometrie);
  await db.query("UPDATE parcel_audits SET status = 'INVALID_GEOMETRY' WHERE id = $1", [auditGeometrie]);
  const geometrie = await poster(admin, "/api/v1/export/traces", {
    audit_id: auditGeometrie,
    format: "json",
    producer: producteur,
  });
  check(
    "identité absente + géométrie invalide → 409 (la géométrie passe avant)",
    geometrie.status === 409,
    `HTTP ${geometrie.status}`,
  );

  // ======================================================== 6. Organisation B
  section("6. Cloisonnement : l'identité ne franchit pas le tenant");

  const adminB = await connecter("admin@tenant-b.test", "admin-B");
  const etranger = await poster(adminB, "/api/v1/export/traces", {
    audit_id: auditAbsent,
    format: "json",
    operator: { name: "Café Import SAS", eori: "FR12345678901234" },
    producer: producteur,
  });
  check(
    "une organisation étrangère obtient 404, jamais un 422 ou un export",
    etranger.status === 404,
    `HTTP ${etranger.status}`,
  );

  // Nettoyage des fixtures du run (aucune donnée de démonstration conservée).
  await db.query(
    "DELETE FROM parcel_audits WHERE id = ANY($1::uuid[])",
    [[auditAbsent, auditHerite, auditValide, auditNonProbant, auditNonConforme, auditGeometrie]],
  );

  await db.end();

  // ============================================================== Synthèse
  section("Synthèse");
  check("aucune réponse 5xx", erreursServeur.length === 0, erreursServeur.join(", ") || "aucune");
  console.log(`\n${passed} contrôle(s) passé(s), ${failures.length} échec(s).`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`  🔴 ${f}`);
    process.exit(1);
  }
}

main().catch((erreur) => {
  console.error("🔴 Contrôle HTTP interrompu :", erreur instanceof Error ? erreur.message : erreur);
  process.exit(1);
});
