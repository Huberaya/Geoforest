/**
 * Parcours fournisseur — contrôle HTTP (chantier 6) : invitation, accès limité, dépôt,
 * IDOR et cross-tenant.
 *
 * Exécution (serveur réel, comptes fraîchement réinitialisés) :
 *   npm run seed:auth -- --reset          # MFA des comptes admin : à ré-enrôler
 *   E2E_BASE_URL=http://127.0.0.1:3100 E2E_PASSWORD=… npm run test:fournisseur:http
 *
 * Principe : l'administrateur de l'organisation A invite un producteur, qui active son
 * compte par le lien reçu, puis agit avec son seul compte. Le test couvre :
 *   · l'invitation : permissions, adresse déjà utilisée (réponse générique), réémission ;
 *   · l'activation : jeton faux, mal formé, réutilisé, ancien jeton après réémission,
 *     mot de passe faible, usage unique ;
 *   · l'accès limité : listes refusées, compteurs vides, aucune écriture hors fiche ;
 *   · le dépôt : parcelle et document rattachés à la fiche du compte, jamais à une autre ;
 *   · l'IDOR : ressource d'une autre fiche, d'une autre organisation, identifiant
 *     inexistant : même réponse pour les trois ;
 *   · la révocation : session refusée à la requête suivante, puis réactivation.
 *
 * Verdicts attendus, sans exception : aucune réponse 5xx ; aucune donnée de la victime
 * modifiée (contrôlée par l'administrateur avant et après).
 *
 * Un test qui ne peut pas échouer ne prouve rien. Ce contrôle a déjà détecté, avant
 * correction, deux défauts réels : une réémission d'invitation rejouée à l'identique
 * par l'idempotence, et un jeton d'invitation conservé en clair dans cette mémoire.
 */
import { BASE, PASSWORD, Session, connecter } from "./e2e/client";

const RUN = Date.now().toString(36);
/** Identifiant bien formé qui n'existe dans aucune organisation. */
const ALEA = "00000000-0000-4000-8000-00000000abcd";
/** Cadence : 150 requêtes / 10 s par organisation (src/lib/api/limits.ts). */
const PAUSE_MS = 70;
const pause = (): Promise<void> => new Promise((r) => setTimeout(r, PAUSE_MS));

let passed = 0;
const failures: string[] = [];
const erreursServeur: string[] = [];

function check(nom: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${nom}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${nom}${detail ? ` — ${detail}` : ""}`);
    console.log(`  🔴 ${nom}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(titre: string): void {
  console.log(`\n##### ${titre} #####`);
}

type Reponse = { status: number; json: any };

/** Appel tracé : toute réponse 5xx est une anomalie, quelle que soit l'étape. */
async function appel(s: Session, methode: string, chemin: string, corps?: unknown): Promise<Reponse> {
  await pause();
  const r =
    typeof corps === "string"
      ? await s.request(methode, chemin, undefined, corps)
      : await s.request(methode, chemin, corps);
  if (r.status >= 500) erreursServeur.push(`${methode} ${chemin} → ${r.status}`);
  return r;
}

/** Activation publique (sans session) : même traçage. */
async function publique(corps: unknown): Promise<Reponse> {
  await pause();
  const res = await fetch(`${BASE}/api/v1/auth/invitation/accept`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(corps),
  });
  if (res.status >= 500) erreursServeur.push(`POST /auth/invitation/accept → ${res.status}`);
  const texte = await res.text();
  return { status: res.status, json: texte ? JSON.parse(texte) : null };
}

/** Téléversement multipart (champ `file`) avec le cookie de l'appelant. */
async function televerser(s: Session, documentId: string): Promise<number> {
  await pause();
  const formulaire = new FormData();
  formulaire.append("file", new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), "titre.pdf");
  const res = await fetch(`${BASE}/api/v1/documents/${documentId}/file`, {
    method: "POST",
    headers: { cookie: s.cookieHeader(), accept: "application/json" },
    body: formulaire,
  });
  if (res.status >= 500) erreursServeur.push(`POST /documents/:id/file → ${res.status}`);
  return res.status;
}

/** Corps de parcelle en texte brut : préserve les 6 décimales EUDR (cf. client.postBrut). */
function parcelle(nom: string, supplierId: string | null): string {
  const sid = supplierId === null ? "null" : `"${supplierId}"`;
  return (
    `{"name":"${nom}","countryCode":"CI","commodity":"cocoa","supplierId":${sid},` +
    `"geometry":{"type":"Polygon","coordinates":[[[-5.500000,6.500000],[-5.490000,6.500000],` +
    `[-5.490000,6.510000],[-5.500000,6.510000],[-5.500000,6.500000]]]}}`
  );
}

const detail = (r: Reponse): string | null => r.json?.detail ?? null;

/** Connexion avec un mot de passe donné (le compte fournisseur a le sien, pas le commun). */
async function connecterAvec(email: string, motDePasse: string, label: string): Promise<Session> {
  const s = new Session(label);
  const r = await s.post("/api/v1/auth/login", { email, password: motDePasse });
  if (r.status !== 200 || r.json?.status !== "authenticated") {
    throw new Error(`Connexion impossible pour ${email} (HTTP ${r.status})`);
  }
  return s;
}

const MOT_DE_PASSE_PRODUCTEUR = `Solide-${RUN}-Fournisseur!`;

async function main(): Promise<void> {
  console.log(`base : ${BASE}`);

  // ------------------------------------------------------------ comptes et fixtures
  const adminA = await connecter("admin@geoforest.eu", "admin-A");
  const lecteurA = await connecter("lecteur@geoforest.eu", "lecteur-A");
  const adminB = await connecter("admin@tenant-b.test", "admin-B");

  let rangFiche = 0;
  const fiche = async (s: Session, nom: string) => {
    rangFiche += 1;
    const r = await appel(s, "POST", "/api/v1/suppliers", {
      name: nom,
      commodity: "cocoa",
      country: "CI",
      // EORI distinct par fiche (10 caractères, comme la fiche de l'audit de référence).
      eori: `CI${String(Date.now()).slice(-7)}${rangFiche}`,
    });
    if (r.status >= 300) throw new Error(`fiche ${nom} : HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    return r.json;
  };
  const S1 = await fiche(adminA, `Producteur S1 ${RUN}`);
  const S2 = await fiche(adminA, `Producteur S2 ${RUN}`);
  const T1 = await fiche(adminB, `Producteur T1 ${RUN}`);

  const plotS2 = (await appel(adminA, "POST", "/api/v1/plots", parcelle(`Parcelle S2 ${RUN}`, S2.id))).json;
  const plotT1 = (await appel(adminB, "POST", "/api/v1/plots", parcelle(`Parcelle T1 ${RUN}`, T1.id))).json;
  const docS2 = (
    await appel(adminA, "POST", "/api/v1/documents", {
      title: `Titre S2 ${RUN}`,
      category: "LAND_TENURE",
      supplierId: S2.id,
      plotId: plotS2.id,
    })
  ).json;
  const docT1 = (
    await appel(adminB, "POST", "/api/v1/documents", {
      title: `Titre T1 ${RUN}`,
      category: "LAND_TENURE",
      supplierId: T1.id,
      plotId: plotT1.id,
    })
  ).json;
  if (!plotS2.id || !plotT1.id || !docS2.id || !docT1.id) throw new Error("fixtures non créées");

  const avant = {
    s2: (await appel(adminA, "GET", `/api/v1/suppliers/${S2.id}`)).json,
    plotS2: (await appel(adminA, "GET", `/api/v1/plots/${plotS2.id}`)).json,
    docS2: (await appel(adminA, "GET", `/api/v1/documents/${docS2.id}`)).json,
    plotT1: (await appel(adminB, "GET", `/api/v1/plots/${plotT1.id}`)).json,
    docT1: (await appel(adminB, "GET", `/api/v1/documents/${docT1.id}`)).json,
  };

  // ------------------------------------------------------------ invitation
  section("Invitation : permissions et adresses");
  const emailP = `producteur-${RUN}@test.local`;
  const emailNu = `nouveau-${RUN}@test.local`;
  const invitation = `/api/v1/suppliers/${S1.id}/invitation`;

  const rLecteur = await appel(lecteurA, "POST", invitation, { email: emailP, name: "Producteur" });
  check("lecteur (sans supplier:write) : invitation refusée", rLecteur.status === 403, `HTTP ${rLecteur.status}`);

  const rCroise = await appel(adminB, "POST", invitation, { email: emailP, name: "Producteur" });
  check(
    "admin d'une autre organisation : fiche A invisible",
    rCroise.status === 404 && detail(rCroise) === "Fournisseur introuvable",
    `HTTP ${rCroise.status}`,
  );

  const rInvalide = await appel(adminA, "POST", invitation, { email: "pas-une-adresse", name: "Producteur" });
  check("adresse mal formée : 422", rInvalide.status === 422, `HTTP ${rInvalide.status}`);

  const rInvite = await appel(adminA, "POST", invitation, { email: emailP, name: "Producteur S1" });
  const ficheAvantActivation = (await appel(adminA, "GET", `/api/v1/suppliers/${S1.id}`)).json;
  check("fiche S1 : statut PENDING_INVITE pendant l'invitation", ficheAvantActivation?.status === "PENDING_INVITE", `statut ${ficheAvantActivation?.status}`);
  const lien: string = rInvite.json?.lien_invitation ?? "";
  const jeton = lien.includes("#jeton=") ? lien.split("#jeton=")[1] : "";
  check("invitation : 201, statut invited", rInvite.status === 201 && rInvite.json?.status === "invited", `HTTP ${rInvite.status}`);
  check("lien : jeton de 43 caractères dans le fragment", /^[A-Za-z0-9_-]{43}$/.test(jeton), `longueur ${jeton.length}`);
  const expire = Date.parse(rInvite.json?.expires_at ?? "");
  const dans7j = Math.abs(expire - (Date.now() + 7 * 24 * 3600 * 1000));
  check("expiration : 7 jours (± 2 min)", dans7j < 2 * 60 * 1000, `écart ${Math.round(dans7j / 1000)} s`);

  const rDoublon = await appel(adminA, "POST", invitation, { email: emailP, name: "Producteur S1" });
  check("réémission tant que non activé : 200", rDoublon.status === 200 && rDoublon.json?.status === "invited", `HTTP ${rDoublon.status}`);
  const jetonNeuf: string = (rDoublon.json?.lien_invitation ?? "").split("#jeton=")[1] ?? "";
  check("réémission : nouveau jeton différent", jetonNeuf.length === 43 && jetonNeuf !== jeton);

  // Adresses déjà utilisées : la réponse ne doit pas distinguer le cas (pas d'oracle).
  const rAdminA = await appel(adminA, "POST", invitation, { email: "admin@geoforest.eu", name: "Usurpation" });
  const rAdminB = await appel(adminA, "POST", invitation, { email: "admin@tenant-b.test", name: "Usurpation" });
  check(
    "adresse d'un compte existant (autre organisation) : 409 générique",
    rAdminB.status === 409 && detail(rAdminB) === "Cette adresse ne peut pas recevoir d'invitation.",
    `HTTP ${rAdminB.status}`,
  );
  check(
    "adresse d'un compte existant (même organisation) : même réponse",
    rAdminA.status === rAdminB.status && detail(rAdminA) === detail(rAdminB),
  );

  const rNouveau = await appel(adminA, "POST", invitation, { email: emailNu, name: "Second producteur" });
  check("autre adresse libre : 201", rNouveau.status === 201, `HTTP ${rNouveau.status}`);
  // Ce compte-là est sans rattachement à S1 : on ne le réinvite pas sur S2 non plus.
  const rMauvaiseFiche = await appel(adminA, "POST", `/api/v1/suppliers/${S2.id}/invitation`, { email: emailNu, name: "Second" });
  check("compte déjà lié à S1 : pas de réémission sur S2", rMauvaiseFiche.status === 409, `HTTP ${rMauvaiseFiche.status}`);

  // ------------------------------------------------------------ activation
  section("Activation du compte");
  const connexionAvant = await appel(new Session("anonyme"), "POST", "/api/v1/auth/login", { email: emailP, password: PASSWORD });
  check("compte invited : connexion refusée (401 générique, sans mot de passe)", connexionAvant.status === 401, `HTTP ${connexionAvant.status}`);

  const aBlanc = await publique({ token: "x".repeat(43), password: "Solide-Mot-2026!" });
  check("jeton inconnu : 400 générique", aBlanc.status === 400 && detail(aBlanc) === "Invitation invalide ou expirée.", `HTTP ${aBlanc.status}`);
  const aMalforme = await publique({ token: "trop-court", password: "Solide-Mot-2026!" });
  check("jeton mal formé : 400", aMalforme.status === 400, `HTTP ${aMalforme.status}`);
  const aAncien = await publique({ token: jeton, password: "Solide-Mot-2026!" });
  check("ancien jeton (remplacé par la réémission) : 400", aAncien.status === 400, `HTTP ${aAncien.status}`);
  const aFaible = await publique({ token: jetonNeuf, password: "court" });
  check("mot de passe faible : 422, jeton conservé", aFaible.status === 422, `HTTP ${aFaible.status}`);

  const aActif = await publique({ token: jetonNeuf, password: MOT_DE_PASSE_PRODUCTEUR });
  check("jeton valide + mot de passe fort : 200 active", aActif.status === 200 && aActif.json?.status === "active", `HTTP ${aActif.status}`);
  const aRejoue = await publique({ token: jetonNeuf, password: MOT_DE_PASSE_PRODUCTEUR });
  check("jeton réutilisé : 400 (usage unique)", aRejoue.status === 400, `HTTP ${aRejoue.status}`);

  const fournisseur = await connecterAvec(emailP, MOT_DE_PASSE_PRODUCTEUR, "producteur");
  check("connexion après activation : session ouverte", fournisseur.cookieHeader().length > 0);
  const ficheApres = (await appel(adminA, "GET", `/api/v1/suppliers/${S1.id}`)).json;
  check("fiche S1 : statut ACTIVE après activation", ficheApres?.status === "ACTIVE", `statut ${ficheApres?.status}`);

  // ------------------------------------------------------------ accès limité
  section("Accès limité du compte fournisseur");
  const lectures = [
    ["liste des fiches", "/api/v1/suppliers"],
    ["liste des parcelles", "/api/v1/plots"],
    ["liste des documents", "/api/v1/documents"],
  ] as const;
  for (const [nom, chemin] of lectures) {
    const r = await appel(fournisseur, "GET", chemin);
    check(`${nom} : refusée`, r.status === 403, `HTTP ${r.status}`);
  }
  const compteurs = await appel(fournisseur, "GET", "/api/v1/nav/counts");
  check("compteurs de navigation : vides", compteurs.status === 200 && JSON.stringify(compteurs.json) === '{"counts":{}}', JSON.stringify(compteurs.json).slice(0, 80));

  // Chantier 2 : une déconnexion par simple lien (GET) ne doit pas fermer la session.
  const deconnexionGet = await appel(fournisseur, "GET", "/api/v1/auth/logout");
  check("déconnexion par GET : 405", deconnexionGet.status === 405, `HTTP ${deconnexionGet.status}`);
  const sessionApresGet = await appel(fournisseur, "GET", "/api/v1/nav/counts");
  check("session intacte après un GET de déconnexion", sessionApresGet.status === 200, `HTTP ${sessionApresGet.status}`);

  const invitationParFournisseur = await appel(fournisseur, "POST", invitation, { email: `x-${RUN}@test.local`, name: "Intrus" });
  check("fournisseur : ne peut pas inviter", invitationParFournisseur.status === 403, `HTTP ${invitationParFournisseur.status}`);

  // ------------------------------------------------------------ IDOR : parcelles
  section("IDOR : parcelles");
  const pInexistante = await appel(fournisseur, "PATCH", `/api/v1/plots/${ALEA}`, { name: "x" });
  const pEtrangere = await appel(fournisseur, "PATCH", `/api/v1/plots/${plotS2.id}`, { name: "PIRATE" });
  check(
    "PATCH parcelle d'une autre fiche : 404, identique à l'inexistant",
    pEtrangere.status === 404 && detail(pEtrangere) === detail(pInexistante),
    `HTTP ${pEtrangere.status}`,
  );
  const pVol = await appel(fournisseur, "PATCH", `/api/v1/plots/${plotS2.id}`, { supplierId: S1.id });
  check("PATCH parcelle étrangère vers sa fiche : 404", pVol.status === 404, `HTTP ${pVol.status}`);
  const pDelInexistante = await appel(fournisseur, "DELETE", `/api/v1/plots/${ALEA}`);
  const pDel = await appel(fournisseur, "DELETE", `/api/v1/plots/${plotS2.id}`);
  check("DELETE parcelle étrangère : 404, identique à l'inexistant", pDel.status === 404 && detail(pDel) === detail(pDelInexistante));
  const pTenant = await appel(fournisseur, "PATCH", `/api/v1/plots/${plotT1.id}`, { name: "PIRATE" });
  check("PATCH parcelle d'une autre organisation : 404", pTenant.status === 404, `HTTP ${pTenant.status}`);

  // ------------------------------------------------------------ dépôt
  section("Dépôt : parcelles et documents");
  const monPlot = await appel(fournisseur, "POST", "/api/v1/plots", parcelle(`Mon champ ${RUN}`, null));
  check("création sans fiche : rattachée à la fiche du compte", monPlot.status === 201 && monPlot.json?.supplierId === S1.id, `HTTP ${monPlot.status} ${monPlot.json?.supplierId ?? ""}`);
  const monPlotAutre = await appel(fournisseur, "POST", "/api/v1/plots", parcelle(`Intrus ${RUN}`, S2.id));
  check("création rattachée à une autre fiche : 404", monPlotAutre.status === 404, `HTTP ${monPlotAutre.status}`);
  const monPlotExplicite = await appel(fournisseur, "POST", "/api/v1/plots", parcelle(`Champ S1 ${RUN}`, S1.id));
  check("création explicitement sur sa fiche : 201", monPlotExplicite.status === 201, `HTTP ${monPlotExplicite.status}`);

  const monDoc = await appel(fournisseur, "POST", "/api/v1/documents", {
    title: `Mon titre ${RUN}`,
    category: "LAND_TENURE",
    plotId: monPlot.json?.id,
  });
  check("document sur sa parcelle : 201, rattaché à S1", monDoc.status === 201 && monDoc.json?.supplierId === S1.id, `HTTP ${monDoc.status}`);
  const docIntrus = await appel(fournisseur, "POST", "/api/v1/documents", {
    title: `Intrus ${RUN}`,
    category: "LAND_TENURE",
    supplierId: S2.id,
    plotId: plotS2.id,
  });
  check("document rattaché à une autre fiche ou parcelle : refusé", docIntrus.status >= 400 && docIntrus.status < 500, `HTTP ${docIntrus.status}`);
  const docStatut = await appel(fournisseur, "PATCH", `/api/v1/documents/${monDoc.json?.id}`, { status: "VALID" });
  check("changement de statut par le fournisseur : 403", docStatut.status === 403, `HTTP ${docStatut.status}`);
  const docReaffecte = await appel(fournisseur, "PATCH", `/api/v1/documents/${monDoc.json?.id}`, { plotId: plotS2.id });
  check("réaffectation de son document vers une parcelle étrangère : refusée", docReaffecte.status >= 400 && docReaffecte.status < 500, `HTTP ${docReaffecte.status}`);

  section("IDOR : documents");
  const dInexistant = await appel(fournisseur, "PATCH", `/api/v1/documents/${ALEA}`, { title: "x" });
  const dEtranger = await appel(fournisseur, "PATCH", `/api/v1/documents/${docS2.id}`, { title: "PIRATE" });
  check(
    "PATCH document d'une autre fiche : 404, identique à l'inexistant",
    dEtranger.status === 404 && detail(dEtranger) === detail(dInexistant),
    `HTTP ${dEtranger.status}`,
  );
  const dDel = await appel(fournisseur, "DELETE", `/api/v1/documents/${docS2.id}`);
  check("DELETE document d'une autre fiche : 404", dDel.status === 404, `HTTP ${dDel.status}`);
  const dTenant = await appel(fournisseur, "DELETE", `/api/v1/documents/${docT1.id}`);
  check("DELETE document d'une autre organisation : 404", dTenant.status === 404, `HTTP ${dTenant.status}`);
  const fichierEtranger = await televerser(fournisseur, docS2.id);
  const fichierInexistant = await televerser(fournisseur, ALEA);
  check(
    "téléversement sur un document étranger : 404, identique à l'inexistant",
    fichierEtranger === 404 && fichierInexistant === 404,
    `HTTP ${fichierEtranger} / ${fichierInexistant}`,
  );

  section("Dépôt portail : la fiche ne se choisit pas par le nom");
  const avantS2 = (await appel(adminA, "GET", `/api/v1/suppliers/${S2.id}`)).json;
  const depot = await appel(fournisseur, "POST", "/api/v1/supplier-portal/submissions", {
    companyName: S2.name,
    country: "CI",
    eori: "PIRATE00000",
    contactName: "Pirate",
    phone: null,
    commodity: "cocoa",
    estimatedVolumeKg: null,
    plotName: `Dépôt ${RUN}`,
    plotCoordinates: "6.5, -5.5",
    plotAreaHa: 1,
    documentTitle: "Titre",
    documentExpiry: null,
  });
  check("dépôt au nom d'un autre producteur : 201", depot.status === 201, `HTTP ${depot.status}`);
  check("dépôt : rattaché à S1, pas à S2", depot.json?.supplier_id === S1.id, `supplier_id ${depot.json?.supplier_id ?? "?"}`);
  const apresS2 = (await appel(adminA, "GET", `/api/v1/suppliers/${S2.id}`)).json;
  check("fiche S2 : EORI inchangé après le dépôt", apresS2?.eori === avantS2?.eori, `EORI ${apresS2?.eori}`);

  // ------------------------------------------------------------ intégrité
  section("Intégrité : les données des autres fiches sont intactes");
  const apres = {
    s2: (await appel(adminA, "GET", `/api/v1/suppliers/${S2.id}`)).json,
    plotS2: (await appel(adminA, "GET", `/api/v1/plots/${plotS2.id}`)).json,
    docS2: (await appel(adminA, "GET", `/api/v1/documents/${docS2.id}`)).json,
    plotT1: (await appel(adminB, "GET", `/api/v1/plots/${plotT1.id}`)).json,
    docT1: (await appel(adminB, "GET", `/api/v1/documents/${docT1.id}`)).json,
  };
  check("parcelle S2 : nom et fiche inchangés", apres.plotS2?.name === avant.plotS2?.name && apres.plotS2?.supplierId === S2.id);
  check("document S2 : titre et parcelle inchangés", apres.docS2?.title === avant.docS2?.title && apres.docS2?.plotId === plotS2.id);
  check("parcelle T1 (autre organisation) : inchangée", apres.plotT1?.name === avant.plotT1?.name && apres.plotT1?.supplierId === T1.id);
  check("document T1 (autre organisation) : inchangé", apres.docT1?.title === avant.docT1?.title);
  check("fiche S2 : nom et statut inchangés", apres.s2?.name === avant.s2?.name && apres.s2?.status === avant.s2?.status);

  // ------------------------------------------------------------ révocation
  section("Révocation de l'accès");
  const revocation = await appel(adminA, "DELETE", invitation);
  check("révocation : 200, compte suspendu", revocation.status === 200 && revocation.json?.status === "suspended", `HTTP ${revocation.status}`);
  const sessionRefusee = await appel(fournisseur, "GET", "/api/v1/nav/counts");
  check("session existante : refusée dès la requête suivante", sessionRefusee.status === 401, `HTTP ${sessionRefusee.status}`);
  const apresRevocation = await appel(fournisseur, "POST", "/api/v1/plots", parcelle(`Après révocation ${RUN}`, null));
  check("écriture après révocation : refusée", apresRevocation.status === 401, `HTTP ${apresRevocation.status}`);
  const connexionRevoquee = await appel(new Session("revoque"), "POST", "/api/v1/auth/login", { email: emailP, password: MOT_DE_PASSE_PRODUCTEUR });
  check("connexion après révocation : 403 account_inactive", connexionRevoquee.status === 403, `HTTP ${connexionRevoquee.status}`);
  const revocationParFournisseur = await appel(fournisseur, "DELETE", invitation);
  check("révocation par le fournisseur lui-même : refusée", revocationParFournisseur.status === 401 || revocationParFournisseur.status === 403, `HTTP ${revocationParFournisseur.status}`);

  // ------------------------------------------------------------ bilan
  console.log(`\n${passed} vérification(s) réussie(s), ${failures.length} échec(s).`);
  if (erreursServeur.length > 0) {
    console.log("Réponses 5xx :");
    for (const e of erreursServeur) console.log(`  · ${e}`);
  }
  if (failures.length > 0 || erreursServeur.length > 0) {
    for (const f of failures) console.log(`  ✖ ${f}`);
    process.exit(1);
  }
  console.log("Parcours fournisseur : OK");
}

main().catch((e) => {
  console.error("ERREUR", e);
  process.exit(1);
});
