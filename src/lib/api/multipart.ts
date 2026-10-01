/**
 * Lecture d'un corps `multipart/form-data`, **bornée**.
 *
 * ⚠️ P1-02 — pourquoi ne pas appeler `request.formData()`.
 *
 * `formData()` lit tout le corps en mémoire avant de le découper. Or P1-07 a
 * précisément supprimé ce comportement pour le JSON : un client qui annonce
 * 500 Mio les fait absorber au serveur avant même qu'aucune limite ne soit
 * consultée. Rouvrir cette brèche par la porte du téléversement annulerait le
 * chantier précédent.
 *
 * On lit donc ici **en comptant les octets**, et l'on interrompt dès que la
 * limite est franchie — exactement la même discipline que `lireCorpsJson`.
 *
 * ⚠️ Deuxième raison : le type MIME. `formData()` expose `File.type`, qui est
 * la valeur **déclarée par le client**. Le type réel est lu dans les octets par
 * `detecterType` (cf. `src/lib/storage/file-type.ts`). Les deux sont conservés
 * et confrontés.
 */

import { NextResponse } from "next/server";

import { FICHIER_MAX_OCTETS } from "./limits";

export interface ChampMultipart {
  nom: string;
  valeur: string;
}

export interface FichierMultipart {
  nom: string;
  nomFichier: string;
  /** Type annoncé par le client. Jamais une preuve — voir `detecterType`. */
  typeDeclare: string | null;
  contenu: Uint8Array;
}

export interface CorpsMultipart {
  champs: Record<string, string>;
  fichiers: FichierMultipart[];
}

export type LectureMultipart = { ok: true; value: CorpsMultipart } | { ok: false; response: NextResponse };

function refuser(statut: number, detail: string): LectureMultipart {
  return { ok: false, response: NextResponse.json({ detail }, { status: statut }) };
}

function concatener(morceaux: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let position = 0;
  for (const morceau of morceaux) {
    out.set(morceau, position);
    position += morceau.byteLength;
  }
  return out;
}

/** Lit le corps en comptant les octets, puis l'analyse. */
export async function lireCorpsMultipart(
  request: Request,
  limiteOctets: number = FICHIER_MAX_OCTETS,
): Promise<LectureMultipart> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return refuser(415, "Type de contenu attendu : multipart/form-data");
  }

  const annonce = request.headers.get("content-length");
  if (annonce && Number(annonce) > limiteOctets) {
    return refuser(413, "Fichier trop volumineux", );
  }

  if (!request.body) return refuser(400, "Corps de requête absent");

  const reader = request.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limiteOctets) {
        await reader.cancel().catch(() => {});
        return refuser(413, "Fichier trop volumineux");
      }
      morceaux.push(value);
    }
  } catch {
    return refuser(400, "Corps de requête illisible");
  }

  if (total === 0) return refuser(400, "Corps de requête vide");

  const brutes = concatener(morceaux, total);

  // La limite porte sur le corps entier, en-têtes multipart compris : mesurer
  // le fichier seul laisserait passer un bourrage d'en-têtes.
  const boundary = frontiere(contentType);
  if (!boundary) return refuser(400, "En-tête multipart illisible : frontière absente");

  return { ok: true, value: analyser(brutes, boundary) };
}

function frontiere(contentType: string): Uint8Array | null {
  const marque = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const valeur = marque?.[1] ?? marque?.[2];
  if (!valeur) return null;
  return new TextEncoder().encode(`--${valeur.trim()}`);
}

function analyser(contenu: Uint8Array, boundary: Uint8Array): CorpsMultipart {
  const champs: Record<string, string> = {};
  const fichiers: FichierMultipart[] = [];
  const separateur = [...boundary];

  // Découpage sur la frontière, sans convertir tout le corps en texte : un
  // fichier binaire contient des octets qui n'ont pas de sens en UTF-8, et une
  // conversion globale les altérerait.
  const positions: number[] = [];
  for (let i = 0; i <= contenu.length - separateur.length; i += 1) {
    let trouve = true;
    for (let j = 0; j < separateur.length; j += 1) {
      if (contenu[i + j] !== separateur[j]) {
        trouve = false;
        break;
      }
    }
    if (trouve) positions.push(i);
  }

  for (let p = 0; p + 1 < positions.length; p += 1) {
    const debut = positions[p] + separateur.length;
    const fin = positions[p + 1];
    if (fin <= debut) continue;

    const partie = contenu.subarray(debut, fin);
    // Les deux octets qui suivent la frontière sont CRLF ; une partie vide
    // s'arrête là.
    if (partie.length < 4) continue;

    // Fin des en-têtes : première ligne vide (CRLF CRLF).
    let finEntetes = -1;
    for (let i = 0; i + 3 < partie.length; i += 1) {
      if (partie[i] === 0x0d && partie[i + 1] === 0x0a && partie[i + 2] === 0x0d && partie[i + 3] === 0x0a) {
        finEntetes = i;
        break;
      }
    }
    if (finEntetes === -1) continue;

    const entetes = new TextDecoder("utf-8").decode(partie.subarray(0, finEntetes));
    // Le CRLF qui suit la dernière ligne d'en-tête, puis le CRLF final de la
    // partie, sont retirés du contenu.
    let corps = partie.subarray(finEntetes + 4);
    if (corps.length >= 2 && corps[corps.length - 2] === 0x0d && corps[corps.length - 1] === 0x0a) {
      corps = corps.subarray(0, corps.length - 2);
    }

    const disposition = /content-disposition:\s*[^\r\n]*/i.exec(entetes)?.[0] ?? "";
    const nom = /name="([^"]*)"/i.exec(disposition)?.[1] ?? "";
    const nomFichier = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    if (!nom) continue;

    if (nomFichier === null) {
      champs[nom] = new TextDecoder("utf-8").decode(corps);
      continue;
    }

    const typeDeclare = /content-type:\s*([^\r\n]*)/i.exec(entetes)?.[1]?.trim() ?? null;
    fichiers.push({ nom, nomFichier, typeDeclare, contenu: corps });
  }

  return { champs, fichiers };
}
