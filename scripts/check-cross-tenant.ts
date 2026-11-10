/**
 * Cloisonnement inter-organisations — contrôle HTTP exhaustif (B-8, chantier 2).
 *
 * Exécution (serveur réel, comptes fraîchement réinitialisés) :
 *   npm run seed:auth -- --reset          # MFA à ré-enrôler : le secret n'est pas stocké
 *   E2E_BASE_URL=http://127.0.0.1:3100 E2E_PASSWORD=… npm run test:cross-tenant
 *
 * Principe : deux organisations (A = geoforest-agro, B = demo-tenant-b) créent
 * chacune leurs ressources **par l'API**. Un attaquant d'une organisation tente,
 * par chaque route à identifiant, par chaque liste, par chaque lien de création
 * et par chaque artifice de transmission d'identifiant (corps, requête, en-tête),
 * d'atteindre une ressource de l'autre organisation. Le test est exécuté dans les
 * deux sens et depuis plusieurs rôles.
 *
 * Verdicts attendus, sans exception :
 *   · lecture / modification / suppression d'une ressource étrangère : refus,
 *     **même réponse qu'un identifiant inexistant** (pas d'oracle d'existence) ;
 *   · création qui référence une ressource étrangère : refus, ou création sans
 *     aucun lien vers la ressource étrangère ;
 *   · listes : aucune ressource étrangère, ni identifiant, ni nom ;
 *   · intégrité : les données de la victime sont identiques avant et après ;
 *   · aucune réponse 5xx à aucune étape.
 *
 * Un test qui ne peut pas échouer ne prouve rien : la sensibilité a été vérifiée
 * par mutation (cf. docs/CROSS_TENANT_TEST_REPORT.md).
 */
import { BASE, PASSWORD, Session, connecter } from "./e2e/client";

const RUN = Date.now().toString(36);
/** Identifiant bien formé qui n'existe dans aucune organisation. */
const ALEA = "00000000-0000-4000-8000-00000000abcd";
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

/**
 * Cadence du client de test. Le limiteur de débit applique 150 requêtes par
 * 10 s et par organisation (src/lib/api/limits.ts) : une campagne sans pause
 * l'épuise, puis le parcours suivant reçoit des 429. Le client respecte donc la
 * limite comme un client réel. Un 429 reste un ÉCHEC : il n'est pas un refus valide.
 */
const PAUSE_MS = 70;
const pause = (): Promise<void> => new Promise((r) => setTimeout(r, PAUSE_MS));

/** Appel HTTP tracé : toute réponse 5xx est une anomalie, quelle que soit l'étape. */
async function appel(s: Session, methode: string, chemin: string, corps?: unknown): Promise<Reponse> {
  await pause();
  // Une chaîne est un corps JSON déjà écrit (texte source conservé : décimales, zéros finaux).
  const r =
    typeof corps === "string"
      ? await s.request(methode, chemin, undefined, corps)
      : await s.request(methode, chemin, corps);
  if (r.status >= 500) erreursServeur.push(`${methode} ${chemin} → ${r.status}`);
  return r;
}

/** Envoi multipart (téléversement) avec le cookie de session de l'appelant. */
async function envoyerFormulaire(
  s: Session,
  methode: string,
  chemin: string,
  formulaire: FormData,
  entetes: Record<string, string> = {},
): Promise<Reponse> {
  await pause();
  const res = await fetch(`${BASE}${chemin}`, {
    method: methode,
    headers: { accept: "application/json", cookie: s.cookieHeader(), ...entetes },
    body: formulaire,
    redirect: "manual",
  });
  if (res.status >= 500) erreursServeur.push(`${methode} ${chemin} → ${res.status}`);
  const texte = await res.text();
  await pause();
  let json: any = null;
  try {
    json = texte ? JSON.parse(texte) : null;
  } catch {
    json = { brut: texte.slice(0, 200) };
  }
  return { status: res.status, json };
}

const refuse = (r: Reponse): boolean => [400, 401, 403, 404, 409, 422].includes(r.status);
const reussi = (r: Reponse): boolean => r.status >= 200 && r.status < 300;

/** Polygone de 1 km² en texte brut, 6 décimales sans zéro terminal (exigence EUDR). */
function polygone(lon: number, lat: number): string {
  const f = (v: number): string => v.toFixed(6);
  const l1 = lon + 0.01;
  const a1 = lat + 0.01;
  return `{"type":"Polygon","coordinates":[[[${f(lon)},${f(lat)}],[${f(l1)},${f(lat)}],[${f(l1)},${f(a1)}],[${f(lon)},${f(a1)}],[${f(lon)},${f(lat)}]]]}`;
}

interface Fixtures {
  nom: string;
  orgId: string;
  supplierId: string;
  supplierNom: string;
  productId: string;
  plotId: string;
  plotNom: string;
  polygoneTexte: string;
  ddsId: string;
  ddsTitre: string;
  auditId: string;
  docId: string;
  docTitre: string;
  shipmentId: string;
  shipmentRef: string;
  riskId: string;
  riskTitre: string;
  /** Tous les identifiants et noms propres à l'organisation : marqueurs de fuite. */
  marqueurs: string[];
}

async function creer(s: Session, chemin: string, corps: unknown, quoi: string): Promise<any> {
  const r = await appel(s, "POST", chemin, corps);
  if (!reussi(r)) throw new Error(`Fixture impossible (${quoi}) : HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.json;
}

async function creerFixtures(s: Session, orgId: string, tag: string, lon: number, lat: number): Promise<Fixtures> {
  const nom = `XT-${tag}-${RUN}`;
  const supplier = await creer(s, "/api/v1/suppliers", { name: `Fournisseur ${nom}`, commodity: "cocoa", country: "CI" }, "fournisseur");
  const product = await creer(s, "/api/v1/products", { name: `Produit ${nom}`, commodity: "cocoa", countryOfOrigin: "CI", annualVolumeKg: 1000 }, "produit");
  const poly = polygone(lon, lat);
  const plot = await creer(
    s,
    "/api/v1/plots",
    { name: `Parcelle ${nom}`, countryCode: "CI", commodity: "cocoa", supplierId: supplier.id, geometry_text: poly },
    "parcelle",
  );
  const dds = await creer(
    s,
    "/api/v1/due-diligence",
    { title: `DDS ${nom}`, commodity: "cocoa", supplierId: supplier.id, productId: product.id, netWeightKg: 500 },
    "dossier",
  );
  const audit = await creer(
    s,
    "/api/v1/audit/parcel",
    `{"geojson":${poly},"commodity":"cocoa","harvest_date":"2025-03-01","operator":{"name":"Op ${nom}","eori":"FR12345678901234"},"parcel_reference":"${nom}","plot_id":"${plot.id}","due_diligence_id":"${dds.id}"}`,
    "analyse",
  );
  const form = new FormData();
  form.set("title", `Pièce ${nom}`);
  form.set("category", "LAND_TENURE");
  form.set("file", new Blob([`%PDF-1.4 ${nom}`], { type: "application/pdf" }), `piece-${tag.toLowerCase()}.pdf`);
  const up = await envoyerFormulaire(s, "POST", "/api/v1/documents", form);
  if (!reussi(up)) throw new Error(`Fixture impossible (document) : HTTP ${up.status} ${JSON.stringify(up.json).slice(0, 200)}`);
  const shipmentRef = `XT${tag}${RUN}`.toUpperCase();
  const shipment = await creer(
    s,
    "/api/v1/shipments",
    { reference: shipmentRef, harvestDate: "2025-03-01", supplierId: supplier.id, productId: product.id, netWeightKg: 500 },
    "expédition",
  );
  const riskTitre = `Risque ${nom}`;
  const risk = await creer(s, "/api/v1/risks", { title: riskTitre, severity: "HIGH", diligenceId: dds.id }, "risque");

  const docId = up.json?.id ?? up.json?.document?.id;
  if (!docId) throw new Error(`Fixture document sans identifiant : ${JSON.stringify(up.json).slice(0, 200)}`);
  return {
    nom,
    orgId,
    supplierId: supplier.id,
    supplierNom: supplier.name,
    productId: product.id,
    plotId: plot.id,
    plotNom: plot.name,
    polygoneTexte: poly,
    ddsId: dds.id,
    ddsTitre: dds.title,
    auditId: audit.audit_id,
    docId,
    docTitre: `Pièce ${nom}`,
    shipmentId: shipment.id,
    shipmentRef,
    riskId: risk.id ?? risk.task?.id,
    riskTitre,
    marqueurs: [
      orgId,
      supplier.id,
      supplier.name,
      product.id,
      plot.id,
      plot.name,
      dds.id,
      dds.title,
      audit.audit_id,
      docId,
      `Pièce ${nom}`,
      shipment.id,
      shipmentRef,
      risk.id ?? risk.task?.id,
      riskTitre,
    ].filter((m): m is string => typeof m === "string" && m.length > 0),
  };
}

/** Marqueur présent dans une réponse ? (recherche dans toute la structure JSON). */
function fuite(corps: unknown, marqueurs: string[]): string | null {
  const texte = JSON.stringify(corps ?? null);
  return marqueurs.find((m) => texte.includes(m)) ?? null;
}

/** Instantané des données de la victime : toute modification est détectée. */
async function instantane(v: Session, f: Fixtures): Promise<string> {
  const parts = await Promise.all([
    v.get(`/api/v1/plots/${f.plotId}`),
    v.get(`/api/v1/suppliers/${f.supplierId}`),
    v.get(`/api/v1/due-diligence/${f.ddsId}`),
    v.get(`/api/v1/documents/${f.docId}`),
    v.get(`/api/v1/audits/${f.auditId}`),
    v.get("/api/v1/shipments"),
    v.get("/api/v1/risks"),
    v.get(`/api/v1/documents/${f.docId}/versions`),
  ]);
  return JSON.stringify(parts.map((p) => ({ s: p.status, j: p.json })));
}

const LISTES = [
  "/api/v1/plots",
  "/api/v1/suppliers",
  "/api/v1/products",
  "/api/v1/shipments",
  "/api/v1/documents",
  "/api/v1/due-diligence",
  "/api/v1/audits",
  "/api/v1/analyses",
  "/api/v1/declarations",
  "/api/v1/risks",
  "/api/v1/alerts",
  "/api/v1/audit-logs",
  "/api/v1/reports",
  "/api/v1/dashboard/summary",
  "/api/v1/nav/counts",
  "/api/v1/settings",
];

/** Routes à identifiant, testées pour chaque ressource victime. */
function routesVictime(v: Fixtures): { nom: string; methode: string; chemin: string; corps?: unknown }[] {
  return [
    { nom: "GET plot", methode: "GET", chemin: `/api/v1/plots/${v.plotId}` },
    { nom: "PATCH plot", methode: "PATCH", chemin: `/api/v1/plots/${v.plotId}`, corps: { name: "PIRATE" } },
    { nom: "DELETE plot", methode: "DELETE", chemin: `/api/v1/plots/${v.plotId}` },
    { nom: "GET supplier", methode: "GET", chemin: `/api/v1/suppliers/${v.supplierId}` },
    { nom: "GET document", methode: "GET", chemin: `/api/v1/documents/${v.docId}` },
    { nom: "PATCH document", methode: "PATCH", chemin: `/api/v1/documents/${v.docId}`, corps: { title: "PIRATE" } },
    { nom: "DELETE document", methode: "DELETE", chemin: `/api/v1/documents/${v.docId}` },
    { nom: "GET document/download", methode: "GET", chemin: `/api/v1/documents/${v.docId}/download` },
    { nom: "GET document/url", methode: "GET", chemin: `/api/v1/documents/${v.docId}/url` },
    { nom: "GET document/versions", methode: "GET", chemin: `/api/v1/documents/${v.docId}/versions` },
    { nom: "GET dds", methode: "GET", chemin: `/api/v1/due-diligence/${v.ddsId}` },
    { nom: "GET dds/readiness", methode: "GET", chemin: `/api/v1/due-diligence/${v.ddsId}/readiness` },
    { nom: "PATCH dds", methode: "PATCH", chemin: `/api/v1/due-diligence/${v.ddsId}`, corps: { status: "IN_ANALYSIS" } },
    { nom: "DELETE lien analyse", methode: "DELETE", chemin: `/api/v1/due-diligence/${v.ddsId}/audits/${v.auditId}` },
    { nom: "GET audit", methode: "GET", chemin: `/api/v1/audits/${v.auditId}` },
    { nom: "GET tracabilite PLOT", methode: "GET", chemin: `/api/v1/tracabilite/PLOT/${v.plotId}` },
    { nom: "GET tracabilite SUPPLIER", methode: "GET", chemin: `/api/v1/tracabilite/SUPPLIER/${v.supplierId}` },
    { nom: "GET tracabilite DOCUMENT", methode: "GET", chemin: `/api/v1/tracabilite/DOCUMENT/${v.docId}` },
    { nom: "GET tracabilite DDS", methode: "GET", chemin: `/api/v1/tracabilite/DDS/${v.ddsId}` },
    { nom: "GET tracabilite SHIPMENT", methode: "GET", chemin: `/api/v1/tracabilite/SHIPMENT/${v.shipmentId}` },
    { nom: "GET tracabilite PRODUCT", methode: "GET", chemin: `/api/v1/tracabilite/PRODUCT/${v.productId}` },
    { nom: "GET tracabilite TASK", methode: "GET", chemin: `/api/v1/tracabilite/TASK/${v.riskId}` },
    { nom: "PATCH risque", methode: "PATCH", chemin: "/api/v1/risks", corps: { id: v.riskId, status: "DONE" } },
    { nom: "export TRACES", methode: "POST", chemin: "/api/v1/export/traces", corps: { audit_id: v.auditId } },
  ];
}

async function attaquer(a: Session, attaquant: Fixtures, s: Session, victime: Fixtures): Promise<void> {
  const marqueurs = victime.marqueurs;
  const avant = await instantane(s, victime);

  // 1. Routes à identifiant : refus, et aucune donnée de la victime dans la réponse.
  for (const r of routesVictime(victime)) {
    const rep = await appel(a, r.methode, r.chemin, r.corps);
    // Identifiants que l'attaquant a lui-même écrits dans l'URL : leur écho
    // (ex. `entite.id` de la traçabilité) n'est pas une fuite. Seules les
    // données propres à la victime comptent.
    const echos = marqueurs.filter((m) => r.chemin.includes(m));
    const marqueursFuite = marqueurs.filter((m) => !echos.includes(m));
    if (r.methode === "GET" && echos.length > 0) {
      // Lecture : refus, OU réponse strictement identique à celle d'un identifiant
      // inexistant (pas d'oracle d'existence, même corps après neutralisation de l'identifiant).
      const cible = echos[0];
      const inexistant = await appel(a, "GET", r.chemin.split(cible).join(ALEA));
      const normaliser = (x: unknown): string => JSON.stringify(x ?? null).split(cible).join("<ID>").split(ALEA).join("<ID>");
      const indiscernable = rep.status === inexistant.status && normaliser(rep.json) === normaliser(inexistant.json);
      check(
        `${r.nom} : refus ou réponse indiscernable d'un identifiant inexistant`,
        refuse(rep) || indiscernable,
        `HTTP ${rep.status} (inexistant : ${inexistant.status})`,
      );
    } else {
      check(`${r.nom} : refusé pour l'autre organisation`, refuse(rep), `HTTP ${rep.status}`);
    }
    const f = fuite(rep.json, marqueursFuite);
    check(`${r.nom} : aucune donnée étrangère dans la réponse`, f === null, f ? `marqueur ${f.slice(0, 8)}…` : "");
  }

  // 2. Identifiant inexistant : même réponse que pour une ressource étrangère (pas d'oracle).
  const sansRessource = await appel(a, "GET", `/api/v1/plots/${ALEA}`);
  const etrangere = await appel(a, "GET", `/api/v1/plots/${victime.plotId}`);
  check(
    "identifiant étranger indiscernable d'un identifiant inexistant (statut)",
    sansRessource.status === etrangere.status,
    `${etrangere.status} / ${sansRessource.status}`,
  );
  check(
    "identifiant étranger indiscernable d'un identifiant inexistant (corps)",
    JSON.stringify(sansRessource.json) === JSON.stringify(etrangere.json),
  );

  // 3. Identifiant mal formé : jamais une erreur serveur, jamais un succès.
  const mal = await appel(a, "GET", "/api/v1/plots/pas-un-uuid");
  check("identifiant mal formé : refus sans 5xx", refuse(mal), `HTTP ${mal.status}`);

  // 4. Création qui référence une ressource étrangère : refus ou création sans lien.
  const creations: { nom: string; chemin: string; corps: unknown }[] = [
    {
      nom: "plot → fournisseur étranger",
      chemin: "/api/v1/plots",
      corps: { name: `Intrus ${RUN}`, countryCode: "CI", commodity: "cocoa", supplierId: victime.supplierId, geometry_text: polygone(-6.123457, 7.123457) },
    },
    {
      nom: "expédition → fournisseur/produit étrangers",
      chemin: "/api/v1/shipments",
      corps: { reference: `INTRUS${RUN}`.toUpperCase(), harvestDate: "2025-03-01", supplierId: victime.supplierId, productId: victime.productId, netWeightKg: 10 },
    },
    {
      nom: "dossier → fournisseur/produit étrangers",
      chemin: "/api/v1/due-diligence",
      corps: { title: `Intrus ${RUN}`, commodity: "cocoa", supplierId: victime.supplierId, productId: victime.productId, netWeightKg: 1 },
    },
    {
      nom: "risque → dossier étranger",
      chemin: "/api/v1/risks",
      corps: { title: `Intrus ${RUN}`, severity: "LOW", diligenceId: victime.ddsId },
    },
    {
      nom: "analyse → parcelle et dossier étrangers",
      chemin: "/api/v1/audit/parcel",
      corps: `{"geojson":${polygone(-6.223457, 7.223457)},"commodity":"cocoa","harvest_date":"2025-03-01","operator":{"name":"Intrus","eori":"FR12345678901234"},"parcel_reference":"INTRUS-${RUN}","plot_id":"${victime.plotId}","due_diligence_id":"${victime.ddsId}"}`,
    },
    {
      nom: "rattachement d'une analyse étrangère à mon dossier",
      chemin: `/api/v1/due-diligence/${attaquant.ddsId}/audits`,
      corps: { audit_id: victime.auditId },
    },
    {
      nom: "rattachement d'une de mes analyses au dossier étranger",
      chemin: `/api/v1/due-diligence/${victime.ddsId}/audits`,
      corps: { audit_id: attaquant.auditId },
    },
  ];
  for (const c of creations) {
    const rep = await appel(a, "POST", c.chemin, c.corps);
    const f = fuite(rep.json, marqueurs);
    // Refus, ou création acceptée sans aucun lien vers la victime.
    const ok = refuse(rep) || (reussi(rep) && f === null);
    check(`${c.nom} : refus ou absence de lien étranger`, ok, `HTTP ${rep.status}${f ? " (lien étranger présent)" : ""}`);
  }

  // 5. Création avec une organisation forgée dans le corps : ignorée.
  const forge = await appel(a, "POST", "/api/v1/suppliers", {
    name: `Forgé ${RUN}`,
    commodity: "cocoa",
    country: "CI",
    organizationId: victime.orgId,
    organization_id: victime.orgId,
  });
  check("corps : organisation forgée ignorée à la création", fuite(forge.json, [victime.orgId]) === null, `HTTP ${forge.status}`);
  if (reussi(forge)) {
    const listeVictime = await s.get("/api/v1/suppliers");
    check(
      "corps : fournisseur forgé absent de la liste de la victime",
      !JSON.stringify(listeVictime.json).includes(forge.json?.id ?? "__absent__"),
    );
  }

  // 6. Paramètres de requête et en-têtes forgés : la portée reste celle de la session.
  const base = await a.get("/api/v1/plots");
  const forgee = await appel(a, "GET", `/api/v1/plots?organizationId=${victime.orgId}&organization_id=${victime.orgId}&tenant=${victime.orgId}`);
  check("requête : organisation forgée dans l'URL ignorée", fuite(forgee.json, marqueurs) === null && forgee.status === base.status);
  const reponseEntete = await fetch(`${BASE}/api/v1/plots`, {
    headers: { accept: "application/json", cookie: a.cookieHeader(), "x-organization-id": victime.orgId, "x-tenant-id": victime.orgId },
  });
  const corpsEntete = await reponseEntete.json().catch(() => null);
  check("en-tête forgé : liste sans donnée étrangère", fuite(corpsEntete, marqueurs) === null && reponseEntete.status === base.status, `HTTP ${reponseEntete.status}`);

  // 7. Listes : jamais de donnée étrangère, jamais d'erreur serveur.
  for (const liste of LISTES) {
    const rep = await appel(a, "GET", liste);
    const f = fuite(rep.json, marqueurs);
    check(`liste ${liste} : aucune donnée étrangère`, f === null && rep.status !== 500, `HTTP ${rep.status}${f ? " (fuite)" : ""}`);
  }

  // 8. Intégrité : rien n'a changé côté victime.
  const apres = await instantane(s, victime);
  check("intégrité : données de la victime inchangées après les attaques", avant === apres);
}

async function main(): Promise<void> {
  if (!PASSWORD) {
    console.error("E2E_PASSWORD requis (mot de passe commun des comptes de démonstration).");
    process.exit(2);
  }
  console.log(`Cible : ${BASE}`);

  section("Authentification et fixtures");
  const adminA = await connecter("admin@geoforest.eu", "admin-A");
  const lecteurA = await connecter("lecteur@geoforest.eu", "lecteur-A");
  const adminB = await connecter("admin@tenant-b.test", "admin-B");
  const orgA = (await adminA.get("/api/v1/auth/me")).json?.user?.organizationId as string;
  const orgB = (await adminB.get("/api/v1/auth/me")).json?.user?.organizationId as string;
  check("deux organisations distinctes", !!orgA && !!orgB && orgA !== orgB);

  const fxA = await creerFixtures(adminA, orgA, "A", -3.523457, 5.523457);
  const fxB = await creerFixtures(adminB, orgB, "B", -4.123457, 6.123457);
  check("fixtures créées dans les deux organisations", !!fxA.plotId && !!fxB.plotId && !!fxA.docId && !!fxB.docId);

  section("Anonyme : aucune ressource sans session");
  const anonyme = new Session("anonyme");
  for (const chemin of [...LISTES, `/api/v1/plots/${fxB.plotId}`, `/api/v1/due-diligence/${fxB.ddsId}`, `/api/v1/documents/${fxB.docId}`]) {
    const rep = await appel(anonyme, "GET", chemin);
    check(`anonyme ${chemin} : refusé`, rep.status === 401 || rep.status === 403, `HTTP ${rep.status}`);
  }
  const forge = await fetch(`${BASE}/api/v1/plots/${fxB.plotId}`, { headers: { cookie: "gft_access=forge.signature.invalide" } });
  check("jeton forgé : refusé", forge.status === 401, `HTTP ${forge.status}`);

  section("Propriétaire : chaque organisation voit ses propres ressources");
  const listeA = await adminA.get("/api/v1/plots");
  check("A voit sa parcelle", listeA.status === 200 && JSON.stringify(listeA.json).includes(fxA.plotId));
  const listeB = await adminB.get("/api/v1/plots");
  check("B voit sa parcelle", listeB.status === 200 && JSON.stringify(listeB.json).includes(fxB.plotId));
  const propreB = await adminB.get(`/api/v1/plots/${fxB.plotId}`);
  check("B lit sa parcelle", propreB.status === 200, `HTTP ${propreB.status}`);

  section("Admin A → ressources de B");
  await attaquer(adminA, fxA, adminB, fxB);

  section("Admin B → ressources de A");
  await attaquer(adminB, fxB, adminA, fxA);

  section("Lecteur A (rôle restreint) → ressources de B");
  await attaquer(lecteurA, fxA, adminB, fxB);

  section("Transverse : erreurs serveur");
  check("aucune réponse 5xx pendant toute la campagne", erreursServeur.length === 0, erreursServeur.slice(0, 5).join(" | "));

  console.log(`\n${passed} contrôles réussis, ${failures.length} échec(s)`);
  if (failures.length > 0) {
    console.log("Échecs :");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Campagne interrompue :", e instanceof Error ? e.message : e);
  process.exit(1);
});
