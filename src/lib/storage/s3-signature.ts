/**
 * Signature AWS SigV4, pour l'adaptateur de stockage compatible S3.
 *
 * ⚠️ **Code non validé.** Aucun service S3, R2 ni MinIO n'a été joint depuis
 * cet environnement : ces fonctions n'ont jamais été exécutées. Elles sont
 * écrites pour que la mise en service de `stockageS3` se réduise à renseigner
 * les variables d'environnement, mais elles devront être éprouvées sur un
 * compartiment réel — un échec d'authentification SigV4 étant silencieux par
 * nature (réponse 403), rien ici ne permet de détecter une signature fausse
 * autrement qu'en l'exerçant.
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

function uriEncode(chaine: string, encoderSlash: boolean): string {
  let out = "";
  for (const caractere of chaine) {
    const code = caractere.charCodeAt(0);
    const alphanum =
      (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39);
    if (alphanum || caractere === "_" || caractere === "-" || caractere === "~" || caractere === ".") {
      out += caractere;
    } else if (caractere === "/") {
      out += encoderSlash ? "%2F" : "/";
    } else {
      out += `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
    }
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
  const hote = new URL(cfg.endpoint).host;
  const chemin = cfg.pathStyle ? `/${cfg.bucket}/${cle}` : `/${cle}`;
  const uri = cfg.pathStyle ? `/${cfg.bucket}/${uriEncode(cle, false)}` : `/${uriEncode(cle, false)}`;
  void chemin;

  const maintenant = new Date();
  const dateLongue = maintenant.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateCourte = dateLongue.slice(0, 8);

  const chargeUtile = corps ?? Buffer.alloc(0);
  const chargeHachee = sha256Hex(chargeUtile);

  const entetes: Record<string, string> = {
    host: hote,
    "x-amz-content-sha256": chargeHachee,
    "x-amz-date": dateLongue,
  };
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

  const reponse = await fetch(`${cfg.endpoint}${uri}`, {
    method: methode,
    headers: {
      ...entetes,
      "content-length": String(chargeUtile.length),
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
