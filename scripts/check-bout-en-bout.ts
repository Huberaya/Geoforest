/**
 * Contrôle de bout en bout — l'application **démarrée**, sur une **vraie base**.
 *
 * ⚠️ Pourquoi ce script existe.
 *
 *   La CI savait compiler (`next build`), migrer (`db:migrate`), et vérifier
 *   des règles métier pures (`check:eudr`, `check:topologie`…). Elle ne savait
 *   pas répondre à la seule question qui compte avant une mise en production :
 *   **l'application démarre-t-elle, et fait-elle ce qu'elle prétend ?**
 *
 *   Un build vert ne prouve rien de tel. Le 04/11/2026, la même base et le
 *   même build ont produit un serveur qui refusait toutes ses requêtes — parce
 *   que le contrôle de rôle au démarrage jugeait la connexion non conforme. Le
 *   défaut était *dans* le produit et *invisible* de la CI. Ce script le rend
 *   visible.
 *
 * Ce qui est prouvé ici, dans cet ordre :
 *
 *   1. **démarrage réel** : `next start` sert une page et les deux sondes ;
 *   2. **santé** : `/api/health` et `/api/ready` répondent 200 et annoncent
 *      une base et un stockage effectivement joignables ;
 *   3. **contrôle de rôle** : la sonde `role_base` est présente et verte — une
 *      RLS contournée par le rôle applicatif est une défaillance silencieuse,
 *      elle est donc mesurée ici ;
 *   4. **authentification** : login mot de passe + MFA TOTP calculé localement,
 *      activation au premier passage, génération des codes de secours ;
 *   5. **parcours métier** : création d'une parcelle géolocalisée, lecture,
 *      et refus d'une géométrie absente ;
 *   6. **isolation multi-tenant** : deux organisations, deux sessions ; la
 *      seconde ne doit **ni lire, ni modifier, ni supprimer** la parcelle de la
 *      première. C'est le contrôle qui justifie la RLS ; il est fait par
 *      l'API, pas par SQL, parce que c'est l'API qu'un client utilise.
 *
 *   7. **parcours DDR** (C10) : fournisseur, parcelle, analyse, dossier de
 *      diligence, refus motivé du passage en « prêt à déclarer », refus
 *      d'export. C'est le parcours pour lequel le produit existe, et il n'était
 *      couvert par **aucun** contrôle de bout en bout.
 *
 * ⚠️ Ce que ce script ne prouve pas :
 *   · il ne remplace pas une revue de code ni un test unitaire ;
 *   · il n'appelle **jamais** Global Forest Watch : aucun accès réseau sortant
 *     n'est requis, et aucune clé n'est lue. Le parcours DDR est donc éprouvé
 *     dans l'état où il se trouve réellement aujourd'hui — sans clé GFW, donc
 *     sans analyse probante. Le chemin « dossier complet → prêt à déclarer »
 *     reste non couvert, et c'est écrit plutôt que contourné ;
 *   · il s'exécute sur une base **jetable** : il écrit, et ne nettoie pas.
 *
 * Usage :
 *   npm run check:e2e            # suppose un serveur sur $GF_E2E_BASE_URL
 *   npm run check:e2e:complet    # démarre le serveur, migre, amorce, teste, arrête
 *
 * Prérequis : DATABASE_URL_ADMIN et DATABASE_URL définis, base migrée.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { setTimeout as attendre } from "node:timers/promises";

/* -------------------------------------------------------------------------- */
/* Petit harnais de test                                                      */
/* -------------------------------------------------------------------------- */

interface Resultat {
  nom: string;
  ok: boolean;
  detail: string;
}

const resultats: Resultat[] = [];

function verifier(nom: string, condition: boolean, detail: string): boolean {
  resultats.push({ nom, ok: condition, detail });
  const marque = condition ? "✅" : "🔴";
  console.log(`${marque} ${nom}`);
  if (!condition) console.log(`   ${detail}`);
  return condition;
}

class Echec extends Error {}

function exiger(nom: string, condition: boolean, detail: string): void {
  if (!verifier(nom, condition, detail)) throw new Echec(`${nom} — ${detail}`);
}

/* -------------------------------------------------------------------------- */
/* Client HTTP conservant ses cookies                                         */
/* -------------------------------------------------------------------------- */

interface Reponse {
  statut: number;
  corps: unknown;
  texte: string;
  entetes: Headers;
}

class Session {
  private cookies = new Map<string, string>();

  constructor(private readonly base: string) {}

  async appel(
    methode: string,
    chemin: string,
    corps?: unknown,
    entetes: Record<string, string> = {},
  ): Promise<Reponse> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...entetes,
    };
    if (this.cookies.size > 0) {
      h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    }

    const reponse = await fetch(`${this.base}${chemin}`, {
      method: methode,
      headers: h,
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });

    // ⚠️ `getSetCookie()` et pas `get("set-cookie")` : ce dernier ne renvoie
    //   que le premier en-tête quand il y en a plusieurs. Le produit en pose
    //   deux au même appel (`gft_access` et `gft_refresh`) ; n'en garder qu'un
    //   ferait échouer toutes les requêtes suivantes en 401 — panne du banc,
    //   pas du produit.
    for (const brut of reponse.headers.getSetCookie()) {
      const [paire] = brut.split(";");
      const egal = paire.indexOf("=");
      if (egal < 0) continue;
      const nom = paire.slice(0, egal).trim();
      const valeur = paire.slice(egal + 1).trim();
      if (valeur === "" || /max-age=0/i.test(brut)) this.cookies.delete(nom);
      else this.cookies.set(nom, valeur);
    }

    const texte = await reponse.text();
    let corpsJson: unknown = null;
    try {
      corpsJson = JSON.parse(texte);
    } catch {
      corpsJson = null;
    }
    return { statut: reponse.status, corps: corpsJson, texte, entetes: reponse.headers };
  }

  get connectee(): boolean {
    return this.cookies.has("gft_access");
  }
}

/* -------------------------------------------------------------------------- */
/* TOTP — recalculé ici, sans importer le produit                            */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ Le code est recalculé à partir du secret, et non lu depuis le produit :
 *   un test qui réutiliserait la fonction de vérification de l'application
 *   validerait une erreur de cette fonction avec elle-même.
 */
function base32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const propre = secret.replace(/=+$/, "").toUpperCase();
  let bits = "";
  for (const caractere of propre) {
    const index = alphabet.indexOf(caractere);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const octets: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) octets.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(octets);
}

function codeTotp(secret: string, decalageFenetres = 0): string {
  const compteur = Math.floor(Date.now() / 1000 / 30) + decalageFenetres;
  const tampon = Buffer.alloc(8);
  tampon.writeBigUInt64BE(BigInt(compteur));
  const hmac = createHmac("sha1", base32(secret)).update(tampon).digest();
  const position = hmac[hmac.length - 1] & 0x0f;
  const valeur =
    ((hmac[position] & 0x7f) << 24) |
    (hmac[position + 1] << 16) |
    (hmac[position + 2] << 8) |
    hmac[position + 3];
  return String(valeur % 1_000_000).padStart(6, "0");
}

/* -------------------------------------------------------------------------- */
/* Aides                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ Lu à l'appel et non au chargement du module : en mode `--complet`, c'est
 *   `main()` qui fixe l'adresse (le port peut venir de `GF_E2E_PORT`). Une
 *   constante figée ici pointerait sur le port par défaut et le banc
 *   interrogerait un serveur qui n'existe pas — erreur commise au premier
 *   essai, et le symptôme (`ECONNREFUSED 3100`) n'a rien à voir avec le
 *   produit testé.
 */
function baseUrl(): string {
  return process.env.GF_E2E_BASE_URL ?? "http://127.0.0.1:3100";
}
const MOT_DE_PASSE = process.env.GF_E2E_MOT_DE_PASSE ?? "MotDePasseDeTestCI123";

const COMPTES = {
  a: "admin@geoforest.eu",
  b: "admin@tenant-b.test",
} as const;

function champ<T = unknown>(corps: unknown, cle: string): T | undefined {
  if (typeof corps !== "object" || corps === null) return undefined;
  return (corps as Record<string, T>)[cle];
}

/** Connecte un compte, en activant la MFA au premier passage. */
async function connecter(email: string): Promise<Session> {
  const session = new Session(baseUrl());

  const connexion = await session.appel("POST", "/api/v1/auth/login", {
    email,
    password: MOT_DE_PASSE,
  });
  exiger(
    `connexion acceptée pour ${email}`,
    connexion.statut === 200,
    `HTTP ${connexion.statut} : ${connexion.texte.slice(0, 200)}`,
  );

  const etape = champ<string>(connexion.corps, "status");

  if (etape === "mfa_setup_required") {
    // Premier passage : le produit révèle le secret *en attente*, à valider
    // par un code. C'est le seul moment où il est lisible, et c'est voulu.
    const setup = champ<{ secret?: string }>(connexion.corps, "setup");
    const secret = setup?.secret ?? "";
    exiger("secret TOTP absent à l'activation", secret.length >= 16, `reçu « ${secret} »`);

    const activation = await session.appel("POST", "/api/v1/auth/mfa", {
      code: codeTotp(secret),
    });
    exiger(
      "activation MFA à la première connexion",
      activation.statut === 200,
      `HTTP ${activation.statut} : ${activation.texte.slice(0, 200)}`,
    );
    const codes = champ<unknown[]>(activation.corps, "recoveryCodes");
    verifier(
      "codes de secours générés",
      Array.isArray(codes) && codes.length >= 8,
      `reçu ${Array.isArray(codes) ? codes.length : "aucun"}`,
    );
  } else if (etape === "mfa_required") {
    exiger(
      `MFA déjà activée pour ${email} : le banc ne connaît pas le secret`,
      false,
      "relancer `npm run seed:auth` sur une base neuve, ou utiliser check:e2e:complet",
    );
  } else {
    exiger("réponse de connexion inattendue", etape === "authenticated", `status=${etape}`);
  }

  verifier(`session utilisable après connexion (${email})`, session.connectee, "cookie gft_access absent");
  return session;
}

/* -------------------------------------------------------------------------- */
/* Contrôles                                                                  */
/* -------------------------------------------------------------------------- */

async function controlerSondes(): Promise<void> {
  const anonyme = new Session(baseUrl());

  const sante = await anonyme.appel("GET", "/api/health");
  exiger("GET /api/health répond 200", sante.statut === 200, `HTTP ${sante.statut}`);

  // ⚠️ Une sonde qui répond « inconnue » ne sert à rien : on ne peut pas
  //   rattacher un incident à la version qui l'a produit. Le 04/11/2026,
  //   `/api/health` renvoyait exactement cela en production, parce que
  //   `npm_package_version` n'existe pas sous `next start`.
  const version = champ<string>(sante.corps, "version");
  verifier(
    "/api/health expose une version identifiée",
    typeof version === "string" && version !== "" && version !== "inconnue",
    `version « ${String(version)} » : un incident ne pourrait être rattaché à aucun déploiement`,
  );

  const composants = champ<Array<{ nom: string; etat: string }>>(sante.corps, "composants") ?? [];
  const parNom = new Map(composants.map((c) => [c.nom, c.etat]));

  exiger(
    "/api/health : base joignable",
    parNom.get("base") === "ok",
    `état « ${parNom.get("base")} »`,
  );
  exiger(
    "/api/health : stockage opérationnel (aller-retour réel)",
    parNom.get("stockage") === "ok",
    `état « ${parNom.get("stockage")} »`,
  );

  // ⚠️ Le contrôle de rôle est la seule mesure continue du cloisonnement.
  //   Son absence serait pire qu'un échec : il ne remonte pas d'alerte.
  const role = parNom.get("role_base");
  verifier(
    "/api/health : contrôle du rôle applicatif présent",
    role !== undefined,
    "composant « role_base » absent de la sonde",
  );
  verifier(
    "/api/health : rôle applicatif conforme (RLS non contournée)",
    role === "ok",
    `état « ${role} » — le rôle de connexion contourne la RLS ou détient des droits de destruction`,
  );

  const pret = await anonyme.appel("GET", "/api/ready");
  exiger("GET /api/ready répond 200", pret.statut === 200, `HTTP ${pret.statut}`);
  exiger("GET /api/ready : ready = true", champ<boolean>(pret.corps, "ready") === true, pret.texte.slice(0, 200));

  // Une sonde ouverte à tous ne doit pas divulguer la topologie interne.
  const chemins = await anonyme.appel("GET", "/api/ready");
  verifier(
    "/api/ready n'expose aucun chemin de système de fichiers",
    !/\/var\/|\/home\/|\/tmp\/|[A-Z]:\\\\/.test(chemins.texte),
    chemins.texte.slice(0, 200),
  );
}

async function controlerAuthentification(): Promise<void> {
  const anonyme = new Session(baseUrl());

  const sansSession = await anonyme.appel("GET", "/api/v1/plots");
  exiger(
    "route métier refusée sans session (401)",
    sansSession.statut === 401,
    `HTTP ${sansSession.statut}`,
  );

  const mauvaisMotDePasse = await anonyme.appel("POST", "/api/v1/auth/login", {
    email: COMPTES.a,
    password: "ce-nest-pas-le-bon-mot-de-passe",
  });
  exiger(
    "mot de passe erroné refusé (401)",
    mauvaisMotDePasse.statut === 401,
    `HTTP ${mauvaisMotDePasse.statut} : ${mauvaisMotDePasse.texte.slice(0, 160)}`,
  );
  verifier(
    "le refus ne révèle pas si le compte existe",
    !/inconnu|introuvable|existe pas|no such user/i.test(mauvaisMotDePasse.texte),
    mauvaisMotDePasse.texte.slice(0, 160),
  );
}

async function controlerParcoursMetier(a: Session): Promise<string | null> {
  const moi = await a.appel("GET", "/api/v1/auth/me");
  exiger("GET /api/v1/auth/me répond 200", moi.statut === 200, `HTTP ${moi.statut}`);
  const utilisateur = champ<{ organizationId?: string }>(moi.corps, "user");
  verifier(
    "la session porte une organisation",
    typeof utilisateur?.organizationId === "string",
    "organizationId absent : la RLS ne peut pas s'appliquer",
  );

  const sansGeometrie = await a.appel("POST", "/api/v1/plots", {
    name: "Parcelle sans géométrie",
    countryCode: "CI",
    commodity: "cocoa",
  });
  exiger(
    "parcelle sans géométrie refusée (422)",
    sansGeometrie.statut === 422,
    `HTTP ${sansGeometrie.statut} : ${sansGeometrie.texte.slice(0, 200)}`,
  );

  const identifiant = `E2E-${Date.now()}`;
  const geometrie = {
    type: "Polygon",
    // Polygone d'environ 12 ha, six décimales, ordre GeoJSON [lon, lat].
    coordinates: [
      [
        [-5.421345, 7.541234],
        [-5.418001, 7.541234],
        [-5.418001, 7.544001],
        [-5.421345, 7.544001],
        [-5.421345, 7.541234],
      ],
    ],
  };

  const creation = await a.appel("POST", "/api/v1/plots", {
    name: "Parcelle de bout en bout",
    reference: identifiant,
    countryCode: "CI",
    commodity: "cocoa",
    geometry: geometrie,
    areaHa: 12.4,
    geometryType: "polygon",
  });
  exiger(
    "création d'une parcelle géolocalisée (201)",
    creation.statut === 201,
    `HTTP ${creation.statut} : ${creation.texte.slice(0, 300)}`,
  );

  const parcelleId = champ<string>(creation.corps, "id") ?? null;
  verifier("la parcelle créée porte un identifiant", Boolean(parcelleId), "id absent de la réponse");

  if (parcelleId) {
    const relecture = await a.appel("GET", `/api/v1/plots/${parcelleId}`);
    exiger(
      "relecture de la parcelle créée (200)",
      relecture.statut === 200,
      `HTTP ${relecture.statut}`,
    );
    const aire = champ<number>(relecture.corps, "areaHa");
    verifier(
      "la surface enregistrée correspond à celle déclarée",
      typeof aire === "number" && Math.abs(aire - 12.4) < 1.5,
      `areaHa=${String(aire)} pour 12.4 déclarés`,
    );
  }

  const liste = await a.appel("GET", "/api/v1/plots");
  exiger("liste des parcelles (200)", liste.statut === 200, `HTTP ${liste.statut}`);
  const lignes = Array.isArray(liste.corps) ? liste.corps : [];
  verifier(
    "la parcelle créée figure dans la liste",
    lignes.some((l) => champ<string>(l, "reference") === identifiant),
    `${lignes.length} ligne(s) reçue(s)`,
  );

  return parcelleId;
}

/**
 * C10 — le parcours pour lequel le produit existe, de la parcelle à l'export.
 *
 * ⚠️ Pourquoi ce contrôle manquait, et ce que son absence laissait passer.
 *
 *   `check-bout-en-bout.ts` s'arrêtait à la création d'une parcelle. Tout ce qui
 *   vient après — fournisseur, analyse rattachée, dossier de diligence,
 *   passage en « prêt à déclarer », export — n'était vérifié par AUCUN contrôle
 *   exécuté. Les contrôles C7 (`check:validateur-ddr`) éprouvent le validateur
 *   sur des objets construits ; ils ne prouvent pas que les routes réelles le
 *   consultent, ni que la base rend ce qu'il faut. C'est exactement la
 *   différence entre « le module fait ce qu'il dit » et « le produit s'en sert ».
 *
 * ⚠️ Le parcours est conduit dans l'état RÉEL du produit : sans clé GFW.
 *
 *   Il n'y a donc pas d'analyse probante possible, et le dossier ne peut pas
 *   atteindre `READY_FOR_DECLARATION`. Ce n'est pas une limite du contrôle :
 *   c'est l'état du produit, et le contrôle l'exige explicitement. Prétendre
 *   tester le chemin « complet » demanderait une clé GFW et un accès réseau que
 *   la CI n'a pas — le simuler serait tester un produit qui n'existe pas.
 */
async function controlerParcoursDdr(a: Session, parcelleId: string | null): Promise<void> {
  console.log("\n— Parcours DDR —");

  /* --- 1. Fournisseur ---------------------------------------------------- */

  const fournisseur = await a.appel("POST", "/api/v1/suppliers", {
    name: `Fournisseur DDR ${Date.now()}`,
    commodity: "cocoa",
    country: "CI",
  });
  exiger(
    "création d'un fournisseur (201)",
    fournisseur.statut === 201,
    `HTTP ${fournisseur.statut} : ${fournisseur.texte.slice(0, 200)}`,
  );
  const fournisseurId = champ<string>(fournisseur.corps, "id") ?? null;
  verifier("le fournisseur créé porte un identifiant", Boolean(fournisseurId), "id absent");

  // ⚠️ Une parcelle sans fournisseur n'est rattachable à aucun dossier : le
  //   validateur la compterait dans `SANS_PARCELLE` sans jamais pouvoir
  //   expliquer pourquoi. On vérifie donc le rattachement AVANT de continuer,
  //   plutôt que de découvrir plus loin un dossier inexplicablement vide.
  if (parcelleId && fournisseurId) {
    const rattachement = await a.appel("PATCH", `/api/v1/plots/${parcelleId}`, {
      supplierId: fournisseurId,
    });
    verifier(
      "la parcelle est rattachée au fournisseur",
      rattachement.statut === 200,
      `HTTP ${rattachement.statut} : ${rattachement.texte.slice(0, 200)}`,
    );
  }

  /* --- 2. Analyse de la parcelle ----------------------------------------- */

  let auditId: string | null = null;
  if (parcelleId) {
    const audit = await a.appel("POST", "/api/v1/audit/parcel", {
      plot_id: parcelleId,
      commodity: "cocoa",
      harvest_date: "2024-06-01",
      geojson: {
        type: "Polygon",
        coordinates: [
          [
            [-5.421345, 7.541234],
            [-5.418001, 7.541234],
            [-5.418001, 7.544001],
            [-5.421345, 7.544001],
            [-5.421345, 7.541234],
          ],
        ],
      },
      operator: { name: "Opérateur de banc", eori: "FR123456789012345" },
      producer: { name: "Producteur de banc", country: "CI" },
    });
    // 201 : l'analyse CRÉE une ligne d'audit. Attendre 200 faisait échouer le
    // contrôle sur un produit correct — une attente inventée n'est pas une
    // vérification.
    exiger(
      "analyse de la parcelle (201)",
      audit.statut === 201,
      `HTTP ${audit.statut} : ${audit.texte.slice(0, 300)}`,
    );
    auditId = champ<string>(audit.corps, "audit_id") ?? null;

    // ⚠️ Le point central de C9, revu ici au niveau de l'API : sans clé GFW,
    //   l'analyse ne peut pas être probante. Le contrôle exige cette
    //   NON-probité. Si un jour elle devient probante sans clé, c'est que le
    //   produit s'est remis à certifier ce qu'il n'a pas observé — et ce
    //   contrôle le dira.
    if (process.env.GFW_API_KEY === undefined) {
      // ⚠️ La probité est portée par l'objet `satellite`, pas à la racine de la
      //   réponse. Lire le mauvais chemin rendrait `undefined`, et un contrôle
      //   `=== false` sur `undefined` échouerait pour une raison qui n'a rien
      //   à voir avec le produit — ou, pire, passerait si l'on écrivait
      //   `!== true`. C'est exactement le genre de vérification qui ne vérifie
      //   rien.
      const satellite = champ<{ is_probative?: boolean; compliant?: boolean | null; source?: string }>(
        audit.corps,
        "satellite",
      );
      const statut = champ<string>(audit.corps, "status");
      verifier(
        "sans clé GFW, l'analyse n'est pas probante et ne conclut pas",
        satellite?.is_probative === false && satellite?.compliant !== true && statut !== "COMPLIANT",
        `is_probative=${String(satellite?.is_probative)} · compliant=${String(satellite?.compliant)} · status=${String(statut)}`,
      );
      verifier(
        "l'analyse non probante est enregistrée comme telle en base",
        statut === "ANALYSIS_UNAVAILABLE" || statut === "SIMULATED_NON_PROBATIVE",
        `status=${String(statut)}`,
      );
    }
  }

  /* --- 3. Dossier de diligence ------------------------------------------- */

  const dossier = await a.appel("POST", "/api/v1/due-diligence", {
    title: "Dossier de bout en bout",
    commodity: "cocoa",
    supplierId: fournisseurId,
  });
  exiger(
    "création d'un dossier de diligence (201)",
    dossier.statut === 201,
    `HTTP ${dossier.statut} : ${dossier.texte.slice(0, 300)}`,
  );
  const dossierId = champ<string>(dossier.corps, "id") ?? null;
  verifier(
    "le dossier naît à l'état DRAFT",
    champ<string>(dossier.corps, "status") === "DRAFT",
    `status=${String(champ<string>(dossier.corps, "status"))}`,
  );
  if (!dossierId) return;

  /* --- 4. Le dossier n'est pas déclarable, et le refus est motivé ---------- */

  // ⚠️ Le dossier est en DRAFT ; la transition autorisée vers « prêt à
  //   déclarer » passe par UNDER_REVIEW. On l'y amène, puis on tente le
  //   passage : c'est CE refus qui prouve que le validateur est réellement
  //   branché. Une route qui accepterait la transition rendrait C7 décoratif.
  const revue = await a.appel("PATCH", `/api/v1/due-diligence/${dossierId}`, {
    status: "IN_ANALYSIS",
  });
  verifier(
    "le dossier peut entrer en analyse",
    revue.statut === 200,
    `HTTP ${revue.statut} : ${revue.texte.slice(0, 200)}`,
  );
  const enRevue = await a.appel("PATCH", `/api/v1/due-diligence/${dossierId}`, {
    status: "UNDER_REVIEW",
  });
  verifier(
    "le dossier peut passer en revue",
    enRevue.statut === 200,
    `HTTP ${enRevue.statut} : ${enRevue.texte.slice(0, 200)}`,
  );

  // Le statut « déclaré » est inatteignable : une déclaration suppose un accusé
  // du système d'information EUDR qu'aucun composant ne sait obtenir.
  const declare = await a.appel("PATCH", `/api/v1/due-diligence/${dossierId}`, {
    status: "DECLARED",
  });
  exiger(
    "le statut « déclaré » est refusé (409)",
    declare.statut === 409,
    `HTTP ${declare.statut} : ${declare.texte.slice(0, 200)}`,
  );

  const pret = await a.appel("PATCH", `/api/v1/due-diligence/${dossierId}`, {
    status: "READY_FOR_DECLARATION",
  });
  exiger(
    "un dossier non étayé ne passe pas en « prêt à déclarer » (409)",
    pret.statut === 409,
    `HTTP ${pret.statut} : ${pret.texte.slice(0, 200)}`,
  );
  const manques = champ<Array<{ code?: string; gravite?: string; action?: string }>>(pret.corps, "manques");
  verifier(
    "le refus énumère les manques, avec ce qu'il faut faire",
    Array.isArray(manques) &&
      manques.length > 0 &&
      manques.every((m) => typeof m.code === "string" && typeof m.action === "string"),
    `${Array.isArray(manques) ? manques.length : "aucun"} manque(s) — un refus qui n'explique pas se contourne au lieu de se corriger`,
  );
  if (Array.isArray(manques)) {
    // ⚠️ Sans clé GFW, le motif qui DOIT apparaître est l'absence d'analyse
    //   probante. Vérifier sa présence évite de se satisfaire d'un refus dû à
    //   un chemin de traverse (dossier sans fournisseur, par exemple).
    verifier(
      "le refus invoque l'absence d'analyse probante",
      manques.some((m) => m.code === "ANALYSE_NON_PROBANTE"),
      `codes=${manques.map((m) => m.code).join(", ")}`,
    );
    verifier(
      "la parcelle est bien rattachée au dossier (pas de sans-parcelle)",
      !manques.some((m) => m.code === "SANS_PARCELLE"),
      `codes=${manques.map((m) => m.code).join(", ")}`,
    );
  }
  const score = champ<number>(pret.corps, "score_calcule");
  verifier(
    "le refus porte le score CALCULÉ par le serveur",
    typeof score === "number" && score >= 0 && score <= 100,
    `score_calcule=${String(score)} — le score n'est plus reçu du client (C7)`,
  );

  /* --- 5. L'export refuse une analyse non probante ------------------------ */

  if (auditId) {
    const exportation = await a.appel("POST", "/api/v1/export/traces", {
      audit_id: auditId,
    });
    // Sans clé GFW il n'y a pas d'analyse probante : l'export doit être refusé,
    // et le dire. C'est le dernier verrou, et il est côté serveur : l'écran
    // n'est pas une barrière.
    exiger(
      "l'export refuse une analyse non probante (409)",
      exportation.statut === 409,
      `HTTP ${exportation.statut} : ${exportation.texte.slice(0, 300)}`,
    );
    const probante = champ<boolean>(exportation.corps, "is_probative");
    verifier(
      "le refus d'export nomme la non-probité",
      probante === false,
      `is_probative=${String(probante)}`,
    );
  }

  /* --- 6. Le dossier reste lisible après ces refus ------------------------ */

  // ⚠️ Un refus de transition ne doit pas endommager le dossier. Si le dossier
  //   n'était plus lisible après un 409, corriger deviendrait impossible —
  //   c'est le piège d'un validateur trop zélé.
  const relu = await a.appel("GET", `/api/v1/due-diligence/${dossierId}`);
  verifier(
    "le dossier reste lisible après un refus de transition",
    relu.statut === 200,
    `HTTP ${relu.statut}`,
  );
}

async function controlerIsolation(a: Session, b: Session, parcelleId: string): Promise<void> {
  console.log("\n— Isolation multi-tenant —");

  const lecture = await b.appel("GET", `/api/v1/plots/${parcelleId}`);
  exiger(
    "B ne peut pas LIRE la parcelle de A (404/403)",
    lecture.statut === 404 || lecture.statut === 403,
    `HTTP ${lecture.statut} — fuite entre organisations`,
  );

  const modification = await b.appel("PATCH", `/api/v1/plots/${parcelleId}`, {
    name: "Détournée par B",
  });
  exiger(
    "B ne peut pas MODIFIER la parcelle de A (404/403)",
    modification.statut === 404 || modification.statut === 403,
    `HTTP ${modification.statut} — écriture inter-tenant possible`,
  );

  const suppression = await b.appel("DELETE", `/api/v1/plots/${parcelleId}`);
  exiger(
    "B ne peut pas SUPPRIMER la parcelle de A (404/403)",
    suppression.statut === 404 || suppression.statut === 403,
    `HTTP ${suppression.statut} — destruction inter-tenant possible`,
  );

  const listeB = await b.appel("GET", "/api/v1/plots");
  const lignesB = Array.isArray(listeB.corps) ? listeB.corps : [];
  exiger(
    "la liste de B n'expose aucune parcelle de A",
    !lignesB.some((l) => champ<string>(l, "id") === parcelleId),
    `la parcelle ${parcelleId} apparaît chez B`,
  );

  // Contrôle final : A doit toujours voir la sienne — une isolation obtenue
  // en cassant tout ne serait pas une isolation, seulement une panne.
  const relectureA = await a.appel("GET", `/api/v1/plots/${parcelleId}`);
  exiger(
    "A voit toujours sa parcelle après les tentatives de B (200)",
    relectureA.statut === 200,
    `HTTP ${relectureA.statut}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Contrôle de la RLS, au niveau de la base                                   */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ Pourquoi ce contrôle existe, et pourquoi il est **indispensable**.
 *
 *   Le 04/11/2026, la RLS a été désactivée sur `gf_plots` (simulation d'une
 *   régression), puis le banc a été rejoué : **35/35, tout au vert**. L'API ne
 *   fuyait pas — les routes filtrent explicitement sur `organization_id`, et
 *   c'est heureux. Mais cela signifie que le banc, seul, **ne détecte pas**
 *   une régression de la RLS.
 *
 *   Or la RLS n'est pas un ornement : c'est le filet qui protège les requêtes
 *   qui *oublieront* ce filtre. Une défense en profondeur dont la seconde
 *   couche tombe sans bruit n'est plus qu'une couche. Ce contrôle mesure donc
 *   la seconde couche directement dans `pg_class`, là où aucune couche
 *   applicative ne peut la masquer.
 *
 *   La migration vérifie déjà cela (`verifierCloisonnement`) et échoue sinon.
 *   Ce contrôle-ci est indépendant d'elle, et s'exécute contre le serveur qui
 *   tourne réellement.
 */
async function controlerRlsEnBase(): Promise<void> {
  const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
  if (!url) {
    verifier(
      "RLS vérifiée en base",
      false,
      "DATABASE_URL_ADMIN absent : le banc ne peut pas mesurer la seconde couche",
    );
    return;
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ relname: string; rls: boolean; force: boolean }>(
      `select c.relname,
              c.relrowsecurity as rls,
              c.relforcerowsecurity as force
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and (c.relname like 'gf\_%' or c.relname = 'parcel_audits')
          -- ⚠️ Exclusion motivée, identique à celle du script de migration :
          --   l'infrastructure d'authentification est interrogée AVANT qu'une
          --   organisation ne soit connue ; aucune politique RLS ne peut donc
          --   s'y appliquer. Leur protection est le retrait de DELETE et le
          --   hachage des jetons, pas la RLS. Les inclure ici ferait échouer
          --   le banc sur une décision assumée — et un contrôle qui crie au
          --   loup sur un cas justifié finit par être désactivé.
          and c.relname not in ($1, $2)
        order by 1`,
      ["gf_sessions", "gf_login_attempts"],
    );

    const sansRls = rows.filter((r) => !r.rls).map((r) => r.relname);
    exiger(
      `RLS activée sur toutes les tables métier (${rows.length} table(s))`,
      rows.length > 0 && sansRls.length === 0,
      `sans RLS : ${sansRls.join(", ") || "aucune table trouvée"}`,
    );

    // `force` : sans lui, le propriétaire de la table échappe aux politiques.
    // C'est exactement le cas de Neondb_owner, relevé le 02/10/2026.
    const sansForce = rows.filter((r) => !r.force).map((r) => r.relname);
    exiger(
      "RLS forcée sur toutes les tables métier (propriétaire inclus)",
      sansForce.length === 0,
      `RLS non forcée sur : ${sansForce.join(", ")}`,
    );
  } finally {
    await client.end();
  }
}

/* -------------------------------------------------------------------------- */
/* Démarrage du serveur (mode « complet »)                                    */
/* -------------------------------------------------------------------------- */

function demarrerServeur(port: number): ChildProcess {
  console.log(`\n— démarrage de « next start » sur le port ${port} —`);
  const enfant = spawn("npx", ["next", "start", "-p", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production" },
  });
  // ⚠️ Les journaux sont conservés : si le serveur meurt au démarrage, c'est
  //   eux qui expliquent pourquoi (contrôle de rôle non conforme, port pris…).
  enfant.stdout?.on("data", (d) => process.stdout.write(`  [next] ${d}`));
  enfant.stderr?.on("data", (d) => process.stderr.write(`  [next] ${d}`));
  return enfant;
}

/**
 * Le port est-il déjà tenu par un autre processus ?
 *
 * ⚠️ Sans ce contrôle, un serveur oublié d'une exécution précédente répond à
 *   la place du nouveau. Le banc teste alors **une autre application**, sur
 *   **une autre base**, et conclut au vert : c'est le pire résultat possible
 *   pour un outil de vérification. Constaté ici même — un `next start` resté
 *   en vie sur le port a fait durer une exécution 5 minutes avant d'échouer
 *   sur un `ECONNREFUSED` sans rapport.
 */
async function portOccupe(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function attendreServeur(base: string, delaiMs = 60_000): Promise<boolean> {
  const debut = Date.now();
  while (Date.now() - debut < delaiMs) {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.status === 200 || r.status === 503) return true;
    } catch {
      /* pas encore prêt */
    }
    await attendre(500);
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Programme principal                                                        */
/* -------------------------------------------------------------------------- */

async function main(): Promise<number> {
  const complet = process.argv.includes("--complet");
  let serveur: ChildProcess | null = null;

  if (complet) {
    const port = Number(process.env.GF_E2E_PORT ?? 3100);
    process.env.GF_E2E_BASE_URL = `http://127.0.0.1:${port}`;

    if (await portOccupe(port)) {
      console.error(`🔴 Le port ${port} est déjà tenu par un autre processus.`);
      console.error("   Le banc refuserait de tester le serveur qu'il vient de démarrer.");
      console.error(`   Arrêter le processus en cause, ou choisir un autre port : GF_E2E_PORT=…`);
      return 1;
    }

    if (!existsSync(".next/BUILD_ID")) {
      console.error("🔴 Aucun build dans .next — lancer `npm run build` d'abord.");
      return 1;
    }

    // ⚠️ Le compte doit être dans l'état « MFA non encore activée » : c'est le
    //   seul état où le produit révèle le secret en attente, donc le seul où
    //   un banc peut calculer un code sans connaître un secret déjà installé.
    //   `--reset` remet la MFA à zéro ; il est réservé au mode « complet »,
    //   qui s'exécute par construction sur une base jetable.
    console.log("— réinitialisation des comptes de démonstration —");
    const amorcage = spawnSync("npx", ["tsx", "scripts/seed-auth.ts", "--reset"], {
      stdio: "inherit",
      env: process.env,
    });
    if (amorcage.status !== 0) {
      console.error("🔴 Amorçage impossible : le banc ne peut pas se connecter sans comptes.");
      return 1;
    }

    serveur = demarrerServeur(port);
    const pret = await attendreServeur(process.env.GF_E2E_BASE_URL);
    if (!pret) {
      console.error("🔴 Le serveur n'a pas répondu dans le délai imparti.");
      console.error("   C'est un échec du contrôle, pas une lenteur à tolérer :");
      console.error("   une application qui ne démarre pas ne peut rien servir.");
      serveur.kill("SIGTERM");
      return 1;
    }
  }

  try {
    await controlerSondes();
    await controlerRlsEnBase();
    await controlerAuthentification();

    console.log("\n— Parcours métier —");
    const a = await connecter(COMPTES.a);
    const b = await connecter(COMPTES.b);
    const parcelleId = await controlerParcoursMetier(a);
    await controlerParcoursDdr(a, parcelleId);
    if (parcelleId) await controlerIsolation(a, b, parcelleId);
    else verifier("isolation multi-tenant", false, "aucune parcelle créée");
  } catch (erreur) {
    if (!(erreur instanceof Echec)) throw erreur;
    console.error(`\n🔴 Contrôle interrompu : ${erreur.message}`);
  } finally {
    if (serveur) {
      serveur.kill("SIGTERM");
      await attendre(1000);
      if (!serveur.killed) serveur.kill("SIGKILL");
    }
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(
    `\n${resultats.length - echecs.length}/${resultats.length} contrôle(s) réussi(s)` +
      (echecs.length === 0 ? "" : ` — ${echecs.length} échec(s)`),
  );
  return echecs.length === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((erreur) => {
    console.error("🔴 Erreur non traitée :", erreur);
    process.exit(1);
  });
