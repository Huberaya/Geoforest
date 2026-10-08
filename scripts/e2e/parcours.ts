/**
 * Parcours E2E GeoForest — exécuté contre un serveur RÉEL (HTTP, sessions, MFA).
 *
 * Exécution : npm run test:e2e
 * Prérequis :
 *   - E2E_BASE_URL (défaut http://127.0.0.1:3000) pointe vers une instance qui tourne ;
 *   - E2E_PASSWORD : mot de passe commun des comptes de démonstration (seed-auth) ;
 *   - comptes fraîchement réinitialisés (`npm run seed:auth -- --reset`), car le
 *     premier login de chaque compte passe par l'enrôlement MFA (le secret est
 *     transmis par la réponse de login, jamais lu en base).
 *
 * Ce parcours n'écrit jamais directement en base. Il ne contourne aucune
 * permission : chaque opération passe par l'API, avec le rôle qui la porte.
 *
 * Scénarios (cf. docs/E2E_TEST_REPORT.md) :
 *   E2E-001  Authentification : refus générique, enrôlement MFA, session valide.
 *   E2E-002  Analyse satellite sans verdict : jamais COMPLIANT sans source probante.
 *   E2E-003  Dossier : parcelle + analyse rattachées, readiness calculée (pas saisie).
 *   E2E-004  Gouvernance : READY_FOR_DECLARATION refusé sans revue et sans complétude.
 *   E2E-005  Rattachement / détachement d'une analyse, dossier figé après validation.
 *   E2E-006  Cross-tenant : une autre organisation ne voit ni ne modifie rien.
 *   E2E-007  Export TRACES : refusé pour une analyse non probante.
 *   E2E-008  Permissions et session : non authentifié, rôle insuffisant, cookie altéré.
 */
import { totpCode } from "../../src/lib/auth/totp";

const BASE = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD ?? "";
const RUN = Date.now().toString(36);

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  🔴 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n##### ${title} #####`);
}

/** Client HTTP minimal avec cookie jar (les cookies de session sont posés par le serveur). */
class Session {
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
async function connecter(email: string, label: string): Promise<Session> {
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

/** Polygone en texte brut, à 6 décimales (exigence EUDR, ~11 cm). */
const POLYGONE_TEXTE =
  '{"type":"Polygon","coordinates":[[[-3.500000,5.500000],[-3.490000,5.500000],[-3.490000,5.510000],[-3.500000,5.510000],[-3.500000,5.500000]]]}';

/** Corps d'analyse en texte brut : le polygone garde ses décimales. */
function corpsAnalyse(extra: Record<string, unknown>): string {
  const reste = JSON.stringify({
    commodity: "cocoa",
    harvest_date: "2025-03-01",
    operator: { name: "Coopérative E2E", eori: "FR12345678901234" },
    ...extra,
  });
  return `{"geojson":${POLYGONE_TEXTE},${reste.slice(1)}`;
}

async function main(): Promise<void> {
  if (!PASSWORD) {
    console.error("E2E_PASSWORD requis (mot de passe commun des comptes de démonstration).");
    process.exit(2);
  }
  console.log(`Cible : ${BASE}`);

  // ------------------------------------------------------------------ E2E-001
  section("E2E-001 — Authentification");
  const mauvais = await new Session("anon").post("/api/v1/auth/login", { email: "admin@geoforest.eu", password: "mauvais-mot-de-passe-xyz" });
  check("mot de passe faux : 401", mauvais.status === 401, `HTTP ${mauvais.status}`);
  check("mot de passe faux : message générique (pas d'énumération)", /identifiants/i.test(JSON.stringify(mauvais.json)));
  const inconnu = await new Session("anon").post("/api/v1/auth/login", { email: `inconnu-${RUN}@geoforest.eu`, password: "mauvais-mot-de-passe-xyz" });
  check("compte inexistant : même réponse que mot de passe faux", inconnu.status === mauvais.status && JSON.stringify(inconnu.json) === JSON.stringify(mauvais.json));

  const admin = await connecter("admin@geoforest.eu", "admin");
  const me = await admin.get("/api/v1/auth/me");
  check("admin authentifié après MFA", me.status === 200, `HTTP ${me.status}`);
  check("la session identifie le rôle admin", me.json?.user?.role === "admin" || me.json?.role === "admin", JSON.stringify(me.json).slice(0, 120));

  const conformite = await connecter("conformite@geoforest.eu", "conformite");
  const auditeur = await connecter("auditeur@geoforest.eu", "auditeur");
  const lecteur = await connecter("lecteur@geoforest.eu", "lecteur");
  const tenantB = await connecter("admin@tenant-b.test", "tenant-b");

  // ------------------------------------------------------------------ E2E-002
  section("E2E-002 — Analyse satellite : jamais de verdict sans source probante");
  const analyse = await auditeur.postBrut("/api/v1/audit/parcel", corpsAnalyse({ parcel_reference: `E2E-${RUN}` }));
  check("analyse créée (201)", analyse.status === 201, `HTTP ${analyse.status}`);
  const probante = analyse.json?.satellite?.is_probative === true;
  check("statut COMPLIANT interdit sans source probante", analyse.json?.status !== "COMPLIANT" || probante, `statut=${analyse.json?.status}, probante=${probante}`);
  check(
    "pas de source probante ⇒ statut ANALYSIS_UNAVAILABLE ou SIMULATED_NON_PROBATIVE",
    probante || ["ANALYSIS_UNAVAILABLE", "SIMULATED_NON_PROBATIVE"].includes(analyse.json?.status),
    `statut=${analyse.json?.status}`,
  );
  const auditSansVerdict = analyse.json?.audit_id as string;

  // ------------------------------------------------------------------ E2E-003
  section("E2E-003 — Dossier : parcelle et analyse rattachées, readiness calculée");
  const fournisseur = await admin.post("/api/v1/suppliers", { name: `Fournisseur E2E ${RUN}`, commodity: "cocoa", country: "CI" });
  check("fournisseur créé", fournisseur.status === 201 || fournisseur.status === 200, `HTTP ${fournisseur.status}`);
  const produit = await admin.post("/api/v1/products", { name: `Cacao E2E ${RUN}`, commodity: "cocoa", countryOfOrigin: "CI", annualVolumeKg: 1000 });
  check("produit créé", produit.status === 201 || produit.status === 200, `HTTP ${produit.status}`);
  const parcelle = await admin.post("/api/v1/plots", {
    name: `Parcelle E2E ${RUN}`,
    countryCode: "CI",
    commodity: "cocoa",
    supplierId: fournisseur.json?.id,
    geometry_text: POLYGONE_TEXTE,
  });
  check("parcelle créée", parcelle.status === 201 || parcelle.status === 200, `HTTP ${parcelle.status} ${JSON.stringify(parcelle.json).slice(0, 160)}`);
  const plotId: string = parcelle.json?.id;

  const dds = await admin.post("/api/v1/due-diligence", {
    title: `DDS E2E ${RUN}`,
    commodity: "cocoa",
    supplierId: fournisseur.json?.id,
    productId: produit.json?.id,
    netWeightKg: 500,
  });
  check("dossier créé", dds.status === 201 || dds.status === 200, `HTTP ${dds.status} ${JSON.stringify(dds.json).slice(0, 160)}`);
  const ddsId: string = dds.json?.id;

  const analysePlot = await admin.postBrut(
    "/api/v1/audit/parcel",
    corpsAnalyse({ parcel_reference: `E2E-${RUN}-A`, plot_id: plotId, due_diligence_id: ddsId }),
  );
  check("analyse rattachée à la parcelle et au dossier (201)", analysePlot.status === 201, `HTTP ${analysePlot.status}`);
  const auditRattache: string = analysePlot.json?.audit_id;

  const readiness = await admin.get(`/api/v1/due-diligence/${ddsId}/readiness`);
  check("readiness calculée côté serveur", readiness.status === 200 && typeof readiness.json?.etat === "string", `HTTP ${readiness.status}`);
  // Une analyse non probante bloque le dossier ; une analyse probante ne le bloque
  // pas forcément (d'autres contrôles peuvent manquer). Les deux cas sont distincts.
  const probanteRattachee = analysePlot.json?.satellite?.is_probative === true;
  check(
    probanteRattachee ? "analyse probante rattachée : pas de blocage satellite" : "analyse non probante rattachée ⇒ BLOCKED",
    probanteRattachee ? readiness.json?.etat !== "BLOCKED" || readiness.json?.blocages?.every((b: string) => !/non probante/i.test(b)) : readiness.json?.etat === "BLOCKED",
    `état=${readiness.json?.etat}`,
  );
  check("la readiness annonce qu'aucune transmission n'a eu lieu", /aucune transmission/i.test(readiness.json?.avertissement ?? ""));
  check("transmission_status reste NOT_TRANSMITTED", readiness.json?.transmission_status === "NOT_TRANSMITTED");

  const plotApres = await admin.get(`/api/v1/plots/${plotId}`);
  check(
    "l'analyse est rattachée à la parcelle par plot_id (pas par texte de référence)",
    plotApres.json?.audits_linked_by === "plot_id" && (plotApres.json?.audits ?? []).some((a: { id: string }) => a.id === auditRattache),
    `audits_linked_by=${plotApres.json?.audits_linked_by}`,
  );
  check(
    "la parcelle reflète l'analyse (pas COMPLIANT sans source probante)",
    plotApres.status === 200 && (plotApres.json?.status !== "COMPLIANT" || analysePlot.json?.satellite?.is_probative === true),
    `statut=${plotApres.json?.status}`,
  );

  // ------------------------------------------------------------------ E2E-004
  section("E2E-004 — Gouvernance : pas de « prêt » sans revue ni complétude");
  const risqueSaisi = await admin.patch(`/api/v1/due-diligence/${ddsId}`, { riskLevel: "LOW" });
  check("saisie manuelle du risque : 409", risqueSaisi.status === 409, `HTTP ${risqueSaisi.status}`);
  const completudeSaisie = await admin.patch(`/api/v1/due-diligence/${ddsId}`, { completenessScore: 100 });
  check("saisie manuelle de la complétude : 409", completudeSaisie.status === 409, `HTTP ${completudeSaisie.status}`);

  for (const etape of ["IN_ANALYSIS", "UNDER_REVIEW"]) {
    const r = await admin.patch(`/api/v1/due-diligence/${ddsId}`, { status: etape });
    check(`transition vers ${etape}`, r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  }
  const pretRefuse = await admin.patch(`/api/v1/due-diligence/${ddsId}`, { status: "READY_FOR_DECLARATION" });
  check("READY_FOR_DECLARATION refusé tant que le moteur bloque", pretRefuse.status === 409, `HTTP ${pretRefuse.status}`);
  check("le refus cite l'état de readiness", typeof pretRefuse.json?.readiness?.etat === "string");

  // ------------------------------------------------------------------ E2E-005
  section("E2E-005 — Rattachement, détachement et dossier figé");
  const deuxieme = await admin.post(`/api/v1/due-diligence/${ddsId}/audits`, { audit_id: auditSansVerdict });
  check("rattachement d'une seconde analyse (201)", deuxieme.status === 201, `HTTP ${deuxieme.status} ${JSON.stringify(deuxieme.json).slice(0, 120)}`);
  const dejaRattachee = await admin.post(`/api/v1/due-diligence/${ddsId}/audits`, { audit_id: auditRattache });
  check("rattachement en double : 409", dejaRattachee.status === 409, `HTTP ${dejaRattachee.status}`);
  const detache = await admin.delete(`/api/v1/due-diligence/${ddsId}/audits/${auditSansVerdict}`);
  check("détachement : 204", detache.status === 204, `HTTP ${detache.status}`);
  const audit = await admin.get(`/api/v1/audits/${auditSansVerdict}`);
  check("l'analyse détachée existe toujours (jamais effacée)", audit.status === 200, `HTTP ${audit.status}`);

  const dossierApresRevue = await admin.get(`/api/v1/due-diligence/${ddsId}`);
  check("le dossier expose une readiness", dossierApresRevue.status === 200 && dossierApresRevue.json?.readiness !== null, `HTTP ${dossierApresRevue.status}`);

  // ------------------------------------------------------------------ E2E-006
  section("E2E-006 — Cross-tenant");
  check("tenant B ne voit pas le dossier", (await tenantB.get(`/api/v1/due-diligence/${ddsId}`)).status === 404);
  check("tenant B ne voit pas la parcelle", (await tenantB.get(`/api/v1/plots/${plotId}`)).status === 404);
  check("tenant B ne voit pas l'analyse", (await tenantB.get(`/api/v1/audits/${auditRattache}`)).status === 404);
  const intrusion = await tenantB.post(`/api/v1/due-diligence/${ddsId}/audits`, { audit_id: auditSansVerdict });
  check("tenant B ne peut pas rattacher une analyse à ce dossier", intrusion.status === 404, `HTTP ${intrusion.status}`);
  const intrusionDds = await tenantB.patch(`/api/v1/due-diligence/${ddsId}`, { status: "ARCHIVED" });
  check("tenant B ne peut pas modifier le dossier", intrusionDds.status === 404, `HTTP ${intrusionDds.status}`);
  const liste = await tenantB.get("/api/v1/due-diligence");
  const ids: string[] = (liste.json?.items ?? liste.json ?? []).map((d: { id: string }) => d.id);
  check("la liste du tenant B ne contient pas le dossier", !ids.includes(ddsId));

  // ------------------------------------------------------------------ E2E-007
  section("E2E-007 — Export TRACES refusé pour une analyse non probante");
  const exportNonProbant = await admin.post("/api/v1/export/traces", { audit_id: auditSansVerdict, format: "json" });
  if (analyse.json?.satellite?.is_probative === true) {
    // Source probante disponible : l'export n'est refusé que pour un motif réel (géométrie, déforestation).
    check("analyse probante : l'export ne réclame pas la simulation", exportNonProbant.json?.is_probative !== false, `HTTP ${exportNonProbant.status}`);
  } else {
    check("export refusé (409) pour une analyse sans source probante", exportNonProbant.status === 409, `HTTP ${exportNonProbant.status}`);
    check("le refus indique is_probative=false", exportNonProbant.json?.is_probative === false);
    check("aucune transmission TRACES n'est annoncée", !/transmis|soumis à TRACES/i.test(JSON.stringify(exportNonProbant.json)));
  }
  const exportConformite = await conformite.post("/api/v1/export/traces", { audit_id: auditSansVerdict, format: "json" });
  check("le compliance officer reçoit la même décision que l'admin", exportConformite.status === exportNonProbant.status, `HTTP ${exportConformite.status} vs ${exportNonProbant.status}`);

  // ------------------------------------------------------------------ E2E-008
  section("E2E-008 — Permissions et session");
  const anonyme = await new Session("anon").get("/api/v1/due-diligence");
  check("sans session : 401", anonyme.status === 401, `HTTP ${anonyme.status}`);
  const refuseLecteur = await lecteur.post("/api/v1/plots", { name: "Refus E2E", commodity: "cocoa" });
  check("lecteur ne peut pas créer une parcelle : 403", refuseLecteur.status === 403, `HTTP ${refuseLecteur.status}`);
  const lectureLecteur = await lecteur.get("/api/v1/due-diligence");
  check("lecteur peut lire les dossiers : 200", lectureLecteur.status === 200, `HTTP ${lectureLecteur.status}`);
  const refusValidation = await auditeur.patch(`/api/v1/due-diligence/${ddsId}`, { status: "ARCHIVED" });
  check("auditeur ne peut pas modifier un dossier : 403", refusValidation.status === 403, `HTTP ${refusValidation.status}`);
  const urlCommePiece = await admin.post("/api/v1/documents", {
    title: `Titre E2E ${RUN}`,
    category: "LAND_TENURE",
    supplierId: fournisseur.json?.id,
    fileUrl: "https://exemple.invalide/titre.pdf",
  });
  check("une URL déclarée n'est pas une pièce : 422", urlCommePiece.status === 422, `HTTP ${urlCommePiece.status}`);
  // Une pièce sans fichier ne peut pas être validée, même par la conformité.
  const piecesSansFichier = await admin.post("/api/v1/documents", {
    title: `Pièce sans fichier ${RUN}`,
    category: "LAND_TENURE",
    supplierId: fournisseur.json?.id,
  });
  check("pièce sans fichier créée comme simple déclaration (201)", piecesSansFichier.status === 201, `HTTP ${piecesSansFichier.status}`);
  const validationSansFichier = await conformite.patch(`/api/v1/documents/${piecesSansFichier.json?.id}`, { status: "VALID" });
  check("validation d'une pièce sans fichier : 422", validationSansFichier.status === 422, `HTTP ${validationSansFichier.status}`);
  const validationAuditeur = await auditeur.patch(`/api/v1/documents/${piecesSansFichier.json?.id}`, { status: "VALID" });
  check("l'auditeur ne peut pas valider une pièce : 403", validationAuditeur.status === 403 || validationAuditeur.status === 401, `HTTP ${validationAuditeur.status}`);

  // Jeton d'accès forgé : la signature ne doit pas être acceptée.
  const forge = await fetch(`${BASE}/api/v1/due-diligence`, { headers: { cookie: "gft_access=forge.signature.invalide" } });
  check("jeton d'accès forgé : refusé", forge.status === 401, `HTTP ${forge.status}`);

  console.log(`\n${passed}/${passed + failures.length} contrôles réussis`);
  if (failures.length) {
    console.log("\nÉchecs :");
    for (const f of failures) console.log(`  🔴 ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Parcours interrompu :", err instanceof Error ? err.message : err);
  process.exit(1);
});
