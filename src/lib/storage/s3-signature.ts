/**
 * Signature AWS SigV4, pour l'adaptateur de stockage compatible S3.
 *
 * ⚠️ **Signature vérifiée, service jamais joint.** Deux choses distinctes, qu'il
 * ne faut pas confondre.
 *
 *   1. Le **calcul** de la signature a été confronté à l'implémentation de
 *      référence `aws4`, hors du dépôt et sans réseau, sur six cas : GET, PUT
 *      avec corps, DELETE, hôte contenant déjà le compartiment, style chemin
 *      avec port explicite, et une clé piège (espaces, accents, `+`, `&`, `~`).
 *      Les en-têtes `Authorization` coïncident au caractère près. Quatre défauts
 *      ont été trouvés et corrigés à cette occasion : le compartiment absent de
 *      l'URL en style hôte ; `content-length` envoyé sans être signé ; un
 *      encodage des clés qui produisait `%E9` au lieu de `%C3%A9` ; et le chemin
 *      de l'adresse du service purement et simplement perdu, ce qui rendait
 *      Supabase — dont l'adresse se termine par `/storage/v1/s3` —
 *      inutilisable de façon silencieuse.
 *   2. Aucun **aller-retour réel** n'a encore eu lieu. Aussi longtemps que
 *      `stockageS3.valide` reste à `false`, cet adaptateur n'est pas réputé
 *      opérationnel : une signature juste ne dit rien de l'accès au
 *      compartiment, de la région ni des droits de la clé.
 *
 * Le passage à `valide: true` attend `scripts/verifier-stockage-s3.ts`, exécuté
 * sur un compartiment réel.
 *
 * Implémenté ici plutôt que par un SDK : le dépôt n'embarque aucune
 * bibliothèque de stockage, et une dépendance jamais exercée ne ferait
 * qu'élargir la surface d'audit sans rien garantir.
 */

import { createHash, createHmac } from "node:crypto";

function hmac(cle: Buffer | string, donnees: string): Buffer {
  return createHmac("sha256", cle).update(donnees, "utf8").digest();
}

function sha256Hex(donnees: Buffer | string): string {
  return createHash("sha256").update(donnees).digest("hex");
}

/**
 * Encode une chaîne pour une URI SigV4 : les octets UTF-8, jamais les codes de
 * caractères.
 *
 * ⚠️ La version précédente parcourait la chaîne caractère par caractère et
 * convertissait `charCodeAt(0)`. « é » (U+00E9) devenait `%E9`, et tout
 * caractère au-delà de U+00FF — « € » par exemple — produisait `%20AC`,
 * quatre chiffres hexadécimaux pour un seul octet. Le service, lui, recode
 * toujours le chemin en UTF-8 avant de calculer la signature : la signature
 * devenait fausse, et le seul symptôme était un 403 indiscutable. Les clés
 * actuelles étant hexadécimales, le défaut ne se voyait pas — il était
 * prêt à mordre le jour où une clé contiendrait un caractère accentué.
 */
function uriEncode(chaine: string, encoderSlash: boolean): string {
  const octets = Buffer.from(chaine, "utf8");
  let out = "";
  for (const octet of octets) {
    const caractere = String.fromCharCode(octet);
    const sansEncodage =
      (octet >= 0x41 && octet <= 0x5a) ||
      (octet >= 0x61 && octet <= 0x7a) ||
      (octet >= 0x30 && octet <= 0x39) ||
      caractere === "_" ||
      caractere === "-" ||
      caractere === "~" ||
      caractere === ".";
    if (sansEncodage) out += caractere;
    else if (caractere === "/") out += encoderSlash ? "%2F" : "/";
    else out += `%${octet.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

interface Configuration {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathStyle: boolean;
}

function configuration(): Configuration {
  const endpoint = (process.env.S3_ENDPOINT ?? "").replace(/\/+$/, "");
  const bucket = process.env.S3_BUCKET ?? "";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? "";
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Configuration S3 incomplète : S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY sont requis.",
    );
  }
  return {
    endpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    bucket,
    accessKeyId,
    secretAccessKey,
    pathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "false").toLowerCase() === "true",
  };
}

function cleDeSignature(secret: string, date: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

/**
 * Envoie une requête signée. Renvoie le corps, `null` si la ressource est
 * absente, et lève en cas d'erreur HTTP.
 */
export async function signerEtEnvoyer(
  methode: "PUT" | "GET" | "DELETE",
  cle: string,
  corps: Buffer | null,
  typeContenu: string | null,
): Promise<Buffer | null> {
  const cfg = configuration();
  const url = new URL(cfg.endpoint);

  // ⚠️ Deux façons d'adresser un compartiment, et le défaut a son importance.
  //   • style « chemin »    : https://hôte/compartiment/cle
  //   • style « hôte »      : https://compartiment.hôte/cle
  //
  //   Sans ce calcul, le compartiment n'apparaissait **nulle part** dans l'URL
  //   en style hôte : la requête partait vers `https://hôte/cle` et le service
  //   répondait 403 — une signature parfaitement valide pour une adresse qui ne
  //   désigne rien. Le défaut était donc inutilisable tel quel.
  //
  //   Le style hôte est le défaut parce que c'est celui des fournisseurs
  //   courants (AWS, Scaleway, OVH, Cloudflare R2). MinIO et quelques autres
  //   exigent le style chemin : `S3_FORCE_PATH_STYLE=true`.
  //
  //   Si l'hôte contient déjà le compartiment — configuration où l'adresse est
  //   donnée complète — on ne le préfixe pas une seconde fois.
  // ⚠️ Le point-virgule qui manquait : l'adresse du service peut contenir un
  //   chemin. Supabase en est l'exemple — `https://projet.supabase.co/storage/v1/s3`
  //   — et MinIO derrière un mandataire aussi. Ce préfixe faisait partie de la
  //   requête envoyée mais disparaissait de l'URL reconstruite : la requête
  //   partait vers la racine du service, où rien ne répond. Il est maintenant
  //   conservé, et il entre dans la signature puisque la signature porte sur
  //   l'URI envoyée.
  const prefixe = url.pathname.replace(/\/+$/, "");
  const hoteCible =
    cfg.pathStyle || url.hostname.startsWith(`${cfg.bucket}.`)
      ? url.host
      : `${cfg.bucket}.${url.host}`;
  const uri =
    `${prefixe}` +
    `${cfg.pathStyle ? `/${uriEncode(cfg.bucket, false)}` : ""}` +
    `/${uriEncode(cle, false)}`;
  const cible = `${url.protocol}//${hoteCible}${uri}`;

  const maintenant = new Date();
  const dateLongue = maintenant.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateCourte = dateLongue.slice(0, 8);

  const chargeUtile = corps ?? Buffer.alloc(0);
  const chargeHachee = sha256Hex(chargeUtile);

  // ⚠️ `content-length` est **signé**, et seulement quand il y a un corps.
  //   Il ne figure pas parmi les en-têtes que le service exige de signer, et un
  //   en-tête non signé reste légal — mais le signer supprime toute
  //   discussion avec les services compatibles les plus stricts. On l’écarte en
  //   revanche de GET et DELETE : annoncer « 0 octet » sur une requête sans
  //   corps est inutile. Ainsi l’adaptateur produit exactement la signature de
  //   l’implémentation de référence aws4, vérifiée cas par cas.
  const entetes: Record<string, string> = {
    host: hoteCible,
    "x-amz-content-sha256": chargeHachee,
    "x-amz-date": dateLongue,
  };
  if (methode === "PUT") entetes["content-length"] = String(chargeUtile.length);
  if (typeContenu) entetes["content-type"] = typeContenu;

  const clesTriees = Object.keys(entetes).sort();
  const entetesCanoniques = clesTriees.map((k) => `${k}:${String(entetes[k]).trim()}\n`).join("");
  const entetesSignes = clesTriees.join(";");

  const requeteCanonique = [
    methode,
    uri,
    "", // aucune chaîne d'interrogation
    entetesCanoniques,
    entetesSignes,
    chargeHachee,
  ].join("\n");

  const portee = `${dateCourte}/${cfg.region}/s3/aws4_request`;
  const aSigner = ["AWS4-HMAC-SHA256", dateLongue, portee, sha256Hex(requeteCanonique)].join("\n");
  const signature = hmac(cleDeSignature(cfg.secretAccessKey, dateCourte, cfg.region), aSigner).toString("hex");

  const reponse = await fetch(cible, {
    method: methode,
    headers: {
      ...entetes,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${portee}, ` +
        `SignedHeaders=${entetesSignes}, Signature=${signature}`,
    },
    // `Buffer` n'est pas un `BodyInit` accepté tel quel par les types de Node :
    // on passe par une copie explicite, ce qui est aussi plus sûr côté flux.
    body: methode === "PUT" ? new Uint8Array(chargeUtile) : undefined,
    cache: "no-store",
  });

  if (methode === "GET" && reponse.status === 404) return null;
  if (!reponse.ok) {
    const extrait = (await reponse.text().catch(() => "")).slice(0, 300);
    throw new Error(`S3 ${methode} ${reponse.status} — ${extrait}`);
  }
  if (reponse.status === 204) return Buffer.alloc(0);
  return Buffer.from(await reponse.arrayBuffer());
}
