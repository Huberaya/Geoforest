import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { totpCode } from "../../src/lib/auth/totp";
import {
  DOC_A,
  DOC_B,
  DDS_A,
  DDS_B,
  PLOT_B,
  SUPPLIER_A,
  SUPPLIER_B,
} from "../helpers/migrations";
import {
  connecter,
  connecterAvecMfa,
  demarrerBanc,
  EMAIL_A,
  EMAIL_ADMIN_A,
  EMAIL_ADMIN_B,
  EMAIL_ADMIN_LOCK,
  EMAIL_B,
  EMAIL_REFRESH,
  EMAIL_SUSPENDU,
  MOT_DE_PASSE,
  type Banc,
  type ClientHttp,
} from "./harness";

/**
 * Isolation inter-tenant par les **vraies routes HTTP**.
 *
 * Le serveur tourne sur PostgreSQL (PGlite) et Next.js. Comme la connexion
 * PGlite est un superutilisateur, la RLS y est contournée : ces tests portent
 * donc sur le filtrage applicatif. La RLS est prouvée séparément, sous le rôle
 * `geoforest_app`, dans `tests/sql/isolation.test.ts`.
 */
let banc: Banc;
let viewerA: ClientHttp;
let viewerB: ClientHttp;
let adminA: ClientHttp;
let adminB: ClientHttp;
let fournisseurCree: { id: string; name: string };

before(async () => {
  banc = await demarrerBanc();
  viewerA = banc.clientHttp();
  viewerB = banc.clientHttp();
  adminA = banc.clientHttp();
  adminB = banc.clientHttp();
});

after(async () => {
  await banc?.arreter();
});

test("sans session, les données et le profil sont refusés en 401", async () => {
  const anonyme = banc.clientHttp();

  for (const chemin of ["/api/v1/suppliers", "/api/v1/auth/me"]) {
    const { statut, corps } = await anonyme.json<{ error?: { code?: string } }>(chemin);
    assert.equal(statut, 401, chemin);
    assert.equal(corps.error?.code, "unauthenticated", chemin);
  }

  // La route de changement de mot de passe n'accepte que POST : c'est le
  // garde d'authentification qui doit refuser, avant toute lecture de corps.
  const motDePasse = await anonyme.json<{ error?: { code?: string } }>("/api/v1/auth/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentPassword: "x", newPassword: "y" }),
  });
  assert.equal(motDePasse.statut, 401);
  assert.equal(motDePasse.corps.error?.code, "unauthenticated");
});

test("un jeton d'accès fabriqué est refusé", async () => {
  const faux = banc.clientHttp();
  faux.poserCookie("gft_access", "eyJhbGciOiJIUzI1NiJ9.faux.signature");
  const { statut } = await faux.json("/api/v1/suppliers");
  assert.equal(statut, 401);
});

test("le profil renvoie l'organisation de la session, jamais celle du client", async () => {
  await connecter(viewerA, EMAIL_A);
  const { statut, corps } = await viewerA.json<{
    user: { email: string; organizationId: string };
  }>("/api/v1/auth/me");
  assert.equal(statut, 200);
  assert.equal(corps.user.email, EMAIL_A);
  assert.equal(corps.user.organizationId, "11111111-1111-4111-8111-111111111111");
});

test("chaque lecture ne rend que les lignes de son organisation", async () => {
  const fournisseurs = await viewerA.json<{ name: string }[]>("/api/v1/suppliers");
  assert.equal(fournisseurs.statut, 200);
  assert.deepEqual(fournisseurs.corps.map((s) => s.name), ["Fournisseur A"]);

  const parcelles = await viewerA.json<{ name: string }[]>("/api/v1/plots");
  assert.equal(parcelles.statut, 200);
  assert.deepEqual(parcelles.corps.map((p) => p.name), ["Parcelle A"]);

  const documents = await viewerA.json<{ title: string }[]>("/api/v1/documents");
  assert.equal(documents.statut, 200);
  assert.deepEqual(documents.corps.map((d) => d.title), ["Document A"]);

  const dossiers = await viewerA.json<{ title: string }[]>("/api/v1/due-diligence");
  assert.equal(dossiers.statut, 200);
  assert.deepEqual(dossiers.corps.map((d) => d.title), ["Dossier A"]);

  await connecter(viewerB, EMAIL_B);
  const fournisseursB = await viewerB.json<{ name: string }[]>("/api/v1/suppliers");
  assert.deepEqual(fournisseursB.corps.map((s) => s.name), ["Fournisseur B"]);
});

test("un identifiant d'un autre tenant répond 404, pas 403 ni 200", async () => {
  for (const chemin of [
    `/api/v1/suppliers/${SUPPLIER_B}`,
    `/api/v1/plots/${PLOT_B}`,
    `/api/v1/documents/${DOC_B}/url`,
    `/api/v1/due-diligence/${DDS_B}`,
  ]) {
    const { statut } = await viewerA.json(chemin);
    assert.equal(statut, 404, chemin);
  }
});

test("un lecteur ne peut pas écrire, même en appelant l'API directement", async () => {
  const { statut, corps } = await viewerA.json<{ error?: { code?: string } }>(
    "/api/v1/suppliers",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Écriture interdite", commodity: "coffee" }),
    },
  );
  assert.equal(statut, 403);
  assert.equal(corps.error?.code, "forbidden");
});

test("un administrateur avec MFA crée un fournisseur visible de son seul tenant", async () => {
  await connecterAvecMfa(adminA, EMAIL_ADMIN_A);

  const creation = await adminA.json<{ id: string; name: string }>("/api/v1/suppliers", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "test-http-create-a-0001",
    },
    body: JSON.stringify({
      name: "Fournisseur Test A",
      commodity: "coffee",
      country: "FR",
    }),
  });
  assert.equal(creation.statut, 201);
  assert.equal(creation.corps.name, "Fournisseur Test A");
  fournisseurCree = creation.corps;

  const listeA = await adminA.json<{ id: string }[]>("/api/v1/suppliers");
  assert.ok(listeA.corps.some((s) => s.id === fournisseurCree.id));

  const listeB = await viewerB.json<{ id: string }[]>("/api/v1/suppliers");
  assert.ok(!listeB.corps.some((s) => s.id === fournisseurCree.id));
});

test("les écritures croisées sont refusées et ne modifient rien", async () => {
  const patch = await adminA.json(`/api/v1/plots/${PLOT_B}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "test-http-patch-b-0001",
    },
    body: JSON.stringify({ name: "Parcelle détournée" }),
  });
  assert.equal(patch.statut, 404);

  const suppression = await adminA.json(`/api/v1/plots/${PLOT_B}`, {
    method: "DELETE",
    headers: { "idempotency-key": "test-http-delete-b-0001" },
  });
  assert.equal(suppression.statut, 404);

  const parcelleB = await viewerB.json<{ name: string }>(`/api/v1/plots/${PLOT_B}`);
  assert.equal(parcelleB.statut, 200);
  assert.equal(parcelleB.corps.name, "Parcelle B");
});

test("les corps invalides sont refusés par des statuts distincts", async () => {
  const malforme = await adminA.json("/api/v1/suppliers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ ceci n'est pas du JSON",
  });
  assert.equal(malforme.statut, 400);

  const incomplet = await adminA.json("/api/v1/suppliers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commodity: "coffee" }),
  });
  assert.equal(incomplet.statut, 422);

  const tropGros = await adminA.json("/api/v1/suppliers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "a".repeat(1_100_000), commodity: "coffee" }),
  });
  assert.equal(tropGros.statut, 413);
});

test("un compte suspendu ne peut pas ouvrir de session", async () => {
  const suspendu = banc.clientHttp();
  const { statut, corps } = await suspendu.json<{ error?: { code?: string } }>(
    "/api/v1/auth/login",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL_SUSPENDU, password: MOT_DE_PASSE }),
    },
  );
  assert.equal(statut, 403);
  assert.equal(corps.error?.code, "account_inactive");
});

test("les codes MFA faux finissent par verrouiller le compte", async () => {
  const verrou = banc.clientHttp();
  const secret = await connecterAvecMfa(verrou, EMAIL_ADMIN_LOCK);

  // Le ticket MFA a été consommé et le cookie effacé : on redemande un ticket
  // par une connexion mot de passe, sans réinitialiser le compteur d'échecs.
  const nouvelle = await verrou.json<{ status?: string }>("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL_ADMIN_LOCK, password: MOT_DE_PASSE }),
  });
  assert.equal(nouvelle.corps.status, "mfa_required");

  const codeValide = totpCode(secret, Math.floor(Date.now() / 1000 / 30));
  const codeFaux = codeValide === "000000" ? "000001" : "000000";

  for (let i = 0; i < 5; i += 1) {
    const tentative = await verrou.json("/api/v1/auth/mfa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: codeFaux }),
    });
    assert.equal(tentative.statut, 401, `tentative ${i + 1}`);
  }

  const bloque = await verrou.json<{ error?: { code?: string } }>("/api/v1/auth/mfa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: codeValide }),
  });
  assert.equal(bloque.statut, 423);
  assert.equal(bloque.corps.error?.code, "account_locked");
});

test("la rotation du refresh révoque la famille en cas de rejeu", async () => {
  const session = banc.clientHttp();
  await connecter(session, EMAIL_REFRESH);

  const ancien = session.cookie("gft_refresh");
  assert.ok(ancien);

  const premier = await session.json("/api/v1/auth/refresh", { method: "POST" });
  assert.equal(premier.statut, 200);

  const nouveau = session.cookie("gft_refresh");
  assert.ok(nouveau && nouveau !== ancien);

  // Rejeu du jeton déjà consommé : détection de vol.
  session.poserCookie("gft_refresh", ancien!);
  const rejeu = await session.json("/api/v1/auth/refresh", { method: "POST" });
  assert.equal(rejeu.statut, 401);

  // La famille entière est fermée : le jeton fraîchement émis ne sert plus.
  session.poserCookie("gft_refresh", nouveau!);
  const apres = await session.json("/api/v1/auth/refresh", { method: "POST" });
  assert.equal(apres.statut, 401);
});

test("le journal d'audit est cloisonné et rattache l'action à son auteur", async () => {
  await connecterAvecMfa(adminB, EMAIL_ADMIN_B);

  const journauxA = await adminA.json<
    { entityId: string; action: string; userEmail: string; acteurRole: string }[]
  >("/api/v1/audit-logs?limit=100");
  assert.equal(journauxA.statut, 200);
  const creation = journauxA.corps.find(
    (l) => l.entityId === fournisseurCree.id && l.action === "CREATE",
  );
  assert.ok(creation, "la création doit être journalisée");
  assert.equal(creation.userEmail, EMAIL_ADMIN_A);
  assert.equal(creation.acteurRole, "admin");

  const journauxB = await adminB.json<{ entityId: string }[]>("/api/v1/audit-logs?limit=100");
  assert.equal(journauxB.statut, 200);
  assert.ok(
    !journauxB.corps.some((l) => l.entityId === fournisseurCree.id),
    "le journal d'un tenant ne doit pas exposer l'action d'un autre",
  );
});



// --------------------------------------------------------------- lectures

/**
 * Toutes les routes de lecture, appelées par un administrateur du tenant A.
 * Aucune réponse ne doit contenir l'identifiant, le nom ou la référence d'une
 * entité du tenant B — y compris dans un champ imbriqué ou un export.
 */
const ROUTES_LECTURE = [
  "/api/v1/alerts",
  "/api/v1/analyses",
  "/api/v1/audit-logs",
  "/api/v1/audits",
  "/api/v1/dashboard/summary",
  "/api/v1/declarations",
  "/api/v1/documents",
  "/api/v1/due-diligence",
  "/api/v1/nav/counts",
  "/api/v1/plots",
  "/api/v1/products",
  "/api/v1/reports",
  "/api/v1/risks",
  "/api/v1/settings",
  "/api/v1/shipments",
  "/api/v1/suppliers",
];

const SENTINELLES_B = [
  "22222222-2222-4222-8222-222222222222",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb",
  "bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb",
  "bbbbbbbb-7777-4777-8777-bbbbbbbbbbbb",
  "bbbbbbbb-8888-4888-8888-bbbbbbbbbbbb",
  "Fournisseur B",
  "Parcelle B",
  "Document B",
  "Dossier B",
  "Opérateur B",
  "tenant-b",
];

test("aucune route de lecture ne rend une donnée du tenant voisin", async () => {
  if (!adminA.cookie("gft_access")) await connecterAvecMfa(adminA, EMAIL_ADMIN_A);

  for (const chemin of ROUTES_LECTURE) {
    const response = await adminA.fetch(chemin);
    const texte = await response.text();
    // Un 403 est un refus légitime ; on n'exige pas 200 de chaque route, on
    // exige qu'aucune réponse, quelle qu'elle soit, ne transporte B.
    assert.notEqual(response.status, 500, `${chemin} : ${texte.slice(0, 200)}`);
    for (const sentinelle of SENTINELLES_B) {
      assert.ok(!texte.includes(sentinelle), `${chemin} expose « ${sentinelle} »`);
    }
  }
});

test("un identifiant de B est introuvable sur chaque route unitaire", async () => {
  if (!adminA.cookie("gft_access")) await connecterAvecMfa(adminA, EMAIL_ADMIN_A);

  const routes = [
    `/api/v1/audits/bbbbbbbb-8888-4888-8888-bbbbbbbbbbbb`,
    `/api/v1/documents/${DOC_B}`,
    `/api/v1/documents/${DOC_B}/versions`,
    `/api/v1/documents/${DOC_B}/url`,
    `/api/v1/due-diligence/${DDS_B}`,
    `/api/v1/plots/bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb`,
    `/api/v1/suppliers/${SUPPLIER_B}`,
  ];

  for (const chemin of routes) {
    const response = await adminA.fetch(chemin);
    const texte = await response.text();
    assert.equal(response.status, 404, `${chemin} → ${response.status} : ${texte.slice(0, 160)}`);
    for (const sentinelle of SENTINELLES_B) {
      assert.ok(!texte.includes(sentinelle), `${chemin} expose « ${sentinelle} »`);
    }
  }

  // La reconstitution d'historique répond 200 même pour une entité inconnue :
  // c'est volontaire (elle ne doit pas révéler si l'entité existe ailleurs),
  // mais la réponse doit être vide de toute donnée du tenant voisin — et
  // identique à celle d'un identifiant qui n'existe nulle part.
  const historiqueB = await adminA.fetch(`/api/v1/tracabilite/SUPPLIER/${SUPPLIER_B}`);
  const texteB = await historiqueB.text();
  assert.equal(historiqueB.status, 200);
  for (const sentinelle of SENTINELLES_B.filter((s) => s !== SUPPLIER_B)) {
    assert.ok(!texteB.includes(sentinelle), `tracabilite expose « ${sentinelle} »`);
  }
  const corpsB = JSON.parse(texteB) as { evenements: number; chronologie: unknown[] };
  assert.equal(corpsB.evenements, 0);

  const historiqueInconnu = await adminA.fetch(
    "/api/v1/tracabilite/SUPPLIER/99999999-9999-4999-8999-999999999999",
  );
  const corpsInconnu = (await historiqueInconnu.json()) as {
    evenements: number;
    chronologie: unknown[];
    versions: unknown[];
    analyses: unknown[];
    integrite: unknown;
  };
  assert.equal(corpsInconnu.evenements, 0);
  assert.deepEqual(corpsInconnu.chronologie, []);
  assert.deepEqual(corpsInconnu.versions, []);
  assert.deepEqual(corpsInconnu.analyses, []);
});

test("les paramètres et en-têtes d'organisation du client sont ignorés", async () => {
  if (!adminA.cookie("gft_access")) await connecterAvecMfa(adminA, EMAIL_ADMIN_A);

  const parRequete = await adminA.json<{ name: string }[]>(
    `/api/v1/suppliers?organizationId=${"22222222-2222-4222-8222-222222222222"}` +
      `&org=org-b&tenant=22222222-2222-4222-8222-222222222222`,
  );
  assert.equal(parRequete.statut, 200);
  assert.deepEqual(
    parRequete.corps.map((s) => s.name).sort(),
    ["Fournisseur A", "Fournisseur Test A"],
  );

  const parEntete = await adminA.json<{ name: string }[]>("/api/v1/suppliers", {
    headers: {
      "x-organization-id": "22222222-2222-4222-8222-222222222222",
      "x-tenant-id": "22222222-2222-4222-8222-222222222222",
    },
  });
  assert.equal(parEntete.statut, 200);
  assert.ok(!parEntete.corps.some((s) => s.name === "Fournisseur B"));
});

// ------------------------------------------------------- références croisées

test("les créations refusent une référence au tenant voisin", async () => {
  if (!adminA.cookie("gft_access")) await connecterAvecMfa(adminA, EMAIL_ADMIN_A);

  const cas: Array<{ chemin: string; corps: Record<string, unknown>; attendu: number }> = [
    {
      chemin: "/api/v1/plots",
      corps: {
        name: "Parcelle rattachée à B",
        commodity: "coffee",
        geometry: { type: "Point", coordinates: [1, 2] },
        supplierId: SUPPLIER_B,
      },
      attendu: 404,
    },
    {
      chemin: "/api/v1/documents",
      corps: { title: "Document rattaché à B", category: "LAND_TENURE", supplierId: SUPPLIER_B },
      attendu: 404,
    },
    {
      chemin: "/api/v1/due-diligence",
      corps: { title: "Dossier rattaché à B", commodity: "coffee", supplierId: SUPPLIER_B },
      attendu: 404,
    },
    {
      chemin: "/api/v1/shipments",
      corps: { reference: "LOT-CROISE-1", harvestDate: "2026-01-01", supplierId: SUPPLIER_B },
      attendu: 404,
    },
    {
      chemin: "/api/v1/risks",
      corps: { title: "Tâche rattachée à B", severity: "LOW", diligenceId: DDS_B },
      attendu: 404,
    },
  ];

  const ecarts: string[] = [];
  for (const { chemin, corps, attendu } of cas) {
    const response = await adminA.json(chemin, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corps),
    });
    const texte = JSON.stringify(response.corps);
    if (response.statut !== attendu) {
      ecarts.push(`${chemin} → ${response.statut} (attendu ${attendu}) : ${texte.slice(0, 200)}`);
    }
    if (/duplicate key|violates foreign key|insert into/i.test(texte)) {
      ecarts.push(`${chemin} expose un détail PostgreSQL : ${texte.slice(0, 200)}`);
    }
  }
  assert.deepEqual(ecarts, []);

  // Rien n'a été créé : les listes du tenant B restent inchangées.
  await connecter(viewerB, EMAIL_B);
  const parcellesB = await viewerB.json<{ name: string }[]>("/api/v1/plots");
  assert.deepEqual(parcellesB.corps.map((p) => p.name), ["Parcelle B"]);
  const dossiersB = await viewerB.json<{ title: string }[]>("/api/v1/due-diligence");
  assert.deepEqual(dossiersB.corps.map((d) => d.title), ["Dossier B"]);
});

test("un identifiant malformé est une erreur client, jamais un 500", async () => {
  if (!adminA.cookie("gft_access")) await connecterAvecMfa(adminA, EMAIL_ADMIN_A);

  const parcelle = await adminA.json<{ detail?: string }>("/api/v1/plots/pas-un-uuid");
  assert.equal(parcelle.statut, 404);

  const document = await adminA.json<{ detail?: string }>("/api/v1/documents/%00");
  assert.ok([400, 404].includes(document.statut), `document → ${document.statut}`);

  const tracabilite = await adminA.json<{ detail?: string }>(
    "/api/v1/tracabilite/PLOT/pas-un-uuid",
  );
  assert.equal(tracabilite.statut, 400);

  const typeInconnu = await adminA.json<{ detail?: string }>(
    "/api/v1/tracabilite/INCONNU/aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa",
  );
  assert.equal(typeInconnu.statut, 404);
});

test("une permission absente est refusée par le serveur, pas par l'écran", async () => {
  const { statut: lectureJournal, corps } = await viewerA.json<{ error?: { code?: string } }>(
    "/api/v1/audit-logs",
  );
  assert.equal(lectureJournal, 403);
  assert.equal(corps.error?.code, "forbidden");

  const reglages = await viewerA.json<{ error?: { code?: string } }>("/api/v1/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ country: "BE" }),
  });
  assert.equal(reglages.statut, 403);

  // La permission est vérifiée avant la validation du corps : un corps vide ne
  // doit pas produire 422 et révéler que la route existe pour cet utilisateur.
  const vide = await viewerA.json("/api/v1/due-diligence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(vide.statut, 403);
});

// ------------------------------------------------------------ URL signées

test("une URL signée pour A ne sert pas une pièce de B", async () => {
  if (!adminA.cookie("gft_access")) await connecterAvecMfa(adminA, EMAIL_ADMIN_A);

  // Une version réelle pour DOC_A, avec une clé de stockage factice : la
  // vérification de signature doit refuser avant tout accès au support.
  await banc.client.exec(`
    insert into gf_document_versions
      (document_id, organization_id, version, storage_key, file_name, sha256, size_bytes,
       mime_detected, uploaded_by)
    values
      ('${DOC_A}', '11111111-1111-4111-8111-111111111111', 1, 'org-a/doc-a.pdf',
       'a.pdf', repeat('a', 64), 10, 'application/pdf', '${EMAIL_ADMIN_A}')
    on conflict do nothing;
    update gf_documents set storage_key = 'org-a/doc-a.pdf', version = 1 where id = '${DOC_A}';
  `);

  const url = await adminA.json<{ url: string }>(`/api/v1/documents/${DOC_A}/url`);
  assert.equal(url.statut, 200, JSON.stringify(url.corps).slice(0, 200));
  const signee = new URL(url.corps.url);
  const requete = signee.searchParams;

  const versB = await adminA.fetch(
    `/api/v1/documents/${DOC_B}/download?v=${requete.get("v")}&exp=${requete.get("exp")}&sig=${requete.get("sig")}`,
  );
  assert.equal(versB.status, 403, "la signature de A appliquée à B doit être refusée");

  // La même URL, présentée par une session de B, est refusée par l'organisation
  // inscrite dans la signature.
  await connecter(viewerB, EMAIL_B);
  const depuisB = await viewerB.fetch(
    `/api/v1/documents/${DOC_A}/download?v=${requete.get("v")}&exp=${requete.get("exp")}&sig=${requete.get("sig")}`,
  );
  assert.equal(depuisB.status, 403);

  // Et sans signature, jamais de fichier.
  const sansSignature = await adminA.fetch(`/api/v1/documents/${DOC_A}/download`);
  assert.equal(sansSignature.status, 403);
});

test("le filtre d'action du journal s'applique avant la limite", async () => {
  if (!adminA.cookie("gft_access")) await connecterAvecMfa(adminA, EMAIL_ADMIN_A);

  // Les dernières actions de l'organisation sont des CREATE. Avec un filtre
  // appliqué APRÈS `limit(1)`, la réponse serait vide ; avec le filtre en SQL,
  // elle contient la dernière connexion réussie.
  const { statut, corps } = await adminA.json<{ action: string }[]>(
    "/api/v1/audit-logs?action=LOGIN_SUCCESS&limit=1",
  );
  assert.equal(statut, 200);
  assert.equal(corps.length, 1);
  assert.equal(corps[0].action, "LOGIN_SUCCESS");
});

test("une pièce absente du support ne divulgue pas sa clé de stockage", async () => {
  if (!adminA.cookie("gft_access")) await connecterAvecMfa(adminA, EMAIL_ADMIN_A);

  const url = await adminA.json<{ url: string }>(`/api/v1/documents/${DOC_A}/url`);
  assert.equal(url.statut, 200);

  const telechargement = await adminA.fetch(new URL(url.corps.url).pathname + new URL(url.corps.url).search);
  const texte = await telechargement.text();

  // Le support de test est vide : la pièce est déclarée mais introuvable.
  assert.equal(telechargement.status, 500, texte.slice(0, 200));
  assert.ok(!texte.includes("storageKey"), "la clé de stockage ne doit pas être rendue");
  assert.ok(!texte.includes("org-a/doc-a.pdf"), "le chemin interne ne doit pas être rendu");
  assert.ok(!texte.includes("/tmp/"), "le répertoire de stockage ne doit pas être rendu");
});

// ⚠️ Ce test ferme définitivement le socket PGlite : il doit rester le dernier.
test("une base injoignable répond 503 sans divulguer l'infrastructure", async () => {
  await banc.arreterBaseDeDonnees();

  const response = await adminA.fetch("/api/v1/suppliers");
  const texte = await response.text();

  assert.equal(response.status, 503, texte.slice(0, 300));
  assert.ok(!texte.includes("55491"), "le port de la base ne doit pas sortir");
  assert.ok(!texte.includes("ECONNREFUSED"), "le code réseau ne doit pas sortir");
  assert.ok(!texte.includes("127.0.0.1"), "l'hôte de la base ne doit pas sortir");
  assert.ok(!texte.includes('"cause"'), "la cause technique ne doit pas sortir");
});
