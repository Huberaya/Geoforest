/**
 * Vérification de l'adaptateur de stockage S3 — P1-02, mise en service.
 *
 * ⚠️ Pourquoi ce script existe.
 *
 * L'adaptateur S3 est livré **non validé** : la signature SigV4 est écrite,
 * relue, et jamais exécutée contre un service réel. Or une signature fausse ne
 * se signale pas : le service répond 403, et rien ne distingue « clé erronée »,
 * « région erronée » et « signature mal calculée ». Croire un tel code
 * opérationnel parce qu'il compile serait exactement l'erreur que cet audit
 * s'emploie à ne pas commettre.
 *
 * Ce script exerce donc **tout** le chemin : écriture, relecture à l'identique,
 * absence, taille, URL signée, suppression. Il ne déclare rien qu'il n'ait
 * mesuré, et sort en erreur au premier échec.
 *
 * Usage :
 *   S3_ENDPOINT=… S3_BUCKET=… S3_REGION=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… \
 *     npx tsx scripts/verifier-stockage-s3.ts
 *
 * Les valeurs peuvent aussi venir de `.env.local`, chargé uniquement si
 * `S3_BUCKET` n'est pas déjà fourni — un contrôle qui porte sur une
 * configuration de production n'a rien à devoir au poste local.
 */
import { config } from "dotenv";

if (!process.env.S3_BUCKET) config({ path: ".env.local" });

import { randomUUID } from "node:crypto";

import { condensat, stockageCourant, stockageS3, tailleDe } from "../src/lib/storage/index";
import { creerUrlSignee, verifierUrlSignee } from "../src/lib/storage/url-signee";

const CLES_REQUISES = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

interface Ligne {
  ok: boolean;
  nom: string;
  detail: string;
}

const lignes: Ligne[] = [];

function noter(ok: boolean, nom: string, detail: string): void {
  lignes.push({ ok, nom, detail });
  console.log(`  ${ok ? "OK   " : "ECHEC"} ${nom.padEnd(46)} ${detail}`);
}

async function verifier(): Promise<string | null> {
  const stockage = stockageS3;
  const organisation = randomUUID();
  const contenu = new TextEncoder().encode(
    `GeoForest Trace — vérification du ${new Date().toISOString()}\n`,
  );
  const attendu = condensat(contenu);

  let objet: { cle: string; sha256: string; taille: number } | null = null;

  try {
    // --- 2. écriture --------------------------------------------------------
    try {
      objet = await stockage.ecrire(organisation, contenu, "txt");
      noter(true, "PUT : écriture de l'objet de test", `clé ${objet.cle.slice(0, 28)}…`);
    } catch (erreur) {
      noter(false, "PUT : écriture de l'objet de test", message(erreur));
    }

    if (objet) {
      // --- 3. relecture ------------------------------------------------------
      const relu = await stockage.lire(objet.cle);
      const condensatRelu = relu ? condensat(relu) : "";
      noter(
        condensatRelu === attendu,
        "GET : contenu relu à l'identique",
        condensatRelu === attendu
          ? `${relu?.length} octets, condensat conforme`
          : `attendu ${attendu}, reçu ${condensatRelu || "rien"}`,
      );

      // --- 4. objet absent -----------------------------------------------------
      const absent = await stockage.lire(`${organisation}/ff/${"0".repeat(64)}.txt`);
      noter(
        absent === null,
        "GET : objet absent rend null",
        absent === null ? "null" : `${absent?.length} octets — inattendu`,
      );

      // --- 5. taille -------------------------------------------------------------
      //   `tailleDe` est réservé à l'adaptateur disque : il n'y a pas de HEAD
      //   dans la signature. La taille se constate à la relecture (point 3).
      //   On le mesure plutôt que de le supposer.
      const taille = await tailleDe(objet.cle);
      noter(
        taille === null,
        "taille : null, sans HEAD (attendu)",
        taille === null ? "conforme à l'adaptateur" : `${taille} octets — inattendu`,
      );

      // --- 6. URL signée ----------------------------------------------------------
      const signee = creerUrlSignee("https://app.exemple", randomUUID(), 1, organisation, 60);
      const params = new URL(signee.url).searchParams;
      const verif = verifierUrlSignee({
        documentId: extraireDocumentId(signee.url),
        versionAttendue: 1,
        organisationId: organisation,
        expiration: params.get("exp"),
        version: params.get("v"),
        signature: params.get("sig"),
      });
      noter(
        verif.valide,
        "URL signée : acceptée pour son organisation",
        verif.valide ? "valide" : verif.raison,
      );

      const autre = verifierUrlSignee({
        documentId: extraireDocumentId(signee.url),
        versionAttendue: 1,
        organisationId: randomUUID(),
        expiration: params.get("exp"),
        version: params.get("v"),
        signature: params.get("sig"),
      });
      noter(
        !autre.valide,
        "URL signée : refusée pour une autre organisation",
        autre.valide ? "ACCEPTÉE — fuite inter-organisations" : autre.raison,
      );
    }
  } finally {
    // --- 7. nettoyage ---------------------------------------------------------------
    if (objet) {
      try {
        await stockage.supprimer(objet.cle);
        const apres = await stockage.lire(objet.cle);
        noter(
          apres === null,
          "DELETE : l'objet de test n'existe plus",
          apres === null ? "confirmé" : "encore présent",
        );
      } catch (erreur) {
        noter(false, "DELETE : suppression de l'objet de test", message(erreur));
      }
    }
  }
  return null;
}

function extraireDocumentId(urlSignee: string): string {
  const motif = /\/api\/v1\/documents\/([^/?]+)\/download/;
  const trouve = motif.exec(urlSignee);
  return trouve ? decodeURIComponent(trouve[1]) : "";
}

function message(erreur: unknown): string {
  const texte = erreur instanceof Error ? erreur.message : String(erreur);
  return texte.slice(0, 200);
}

async function main(): Promise<void> {
  console.log("Vérification du stockage S3 — GeoForest Trace");

  // --- 1. configuration ------------------------------------------------------
  const manquantes = CLES_REQUISES.filter((k) => !process.env[k]);
  if (manquantes.length > 0) {
    console.error(
      `🔴 Variables manquantes : ${manquantes.join(", ")}\n` +
        "   Aucune ligne n'est écrite tant que la configuration est incomplète.",
    );
    process.exit(1);
  }

  const url = new URL(process.env.S3_ENDPOINT ?? "");
  console.log(`  fournisseur : ${url.host}`);
  console.log(`  compartiment: ${process.env.S3_BUCKET}`);
  console.log(`  région      : ${process.env.S3_REGION ?? "us-east-1"}`);
  console.log(
    `  adressage   : ${
      (process.env.S3_FORCE_PATH_STYLE ?? "false").toLowerCase() === "true" ? "chemin" : "hôte"
    }`,
  );
  console.log("");

  await verifier();

  const echecs = lignes.filter((l) => !l.ok);
  console.log(`\n${lignes.length - echecs.length}/${lignes.length} vérifications conformes`);

  if (echecs.length > 0) {
    console.log(
      `\n🔴 Adaptateur non validé. Ne pas passer \`stockageS3.valide\` à true :\n` +
        "   cette marque signifie « éprouvé sur une instance réelle », et elle ne\n" +
        `   s'accorde qu'après une exécution intégralement conforme. Adaptateur monté : ${stockageCourant().nom}.`,
    );
    process.exit(1);
  }
  console.log(
    "\n✅ Adaptateur S3 opérationnel. La marque `valide` de `stockageS3` peut\n" +
      "   être passée à true — et seulement maintenant.",
  );
}

main().catch((erreur: unknown) => {
  console.error("🔴 Vérification interrompue :", message(erreur));
  process.exit(1);
});
