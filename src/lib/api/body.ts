import { NextResponse } from "next/server";

import { CHAMPS_MAX, CORPS_MAX_OCTETS, PROFONDEUR_MAX } from "./limits";

/**
 * Lecture d'un corps de requête **bornée**.
 *
 * ⚠️ P1-07 — le défaut corrigé.
 *
 * `await request.json()` lit tout le corps en mémoire avant de le valider. Un
 * client envoie 8 Mio, le serveur les absorbe, et il suffit de quelques
 * requêtes concurrentes pour épuiser la mémoire. Le middleware refuse déjà les
 * corps annoncés trop grands, mais un envoi en *chunked* n'annonce rien : la
 * seule protection fiable est de **compter les octets pendant la lecture**.
 *
 * Trois refus distincts, qu'il ne faut pas confondre :
 *   413 — le corps dépasse la limite (avant ou pendant la lecture) ;
 *   400 — le corps n'est pas du JSON lisible ;
 *   422 — le JSON est lisible mais une valeur dépasse une limite métier.
 */

export const CORPS_TROP_VOLUMINEUX = "Corps de requête trop volumineux";

export type LectureCorps =
  | { ok: true; value: unknown; texte: string }
  | { ok: false; response: NextResponse };

function refuser(statut: number, detail: string, complement?: Record<string, unknown>): LectureCorps {
  return {
    ok: false,
    response: NextResponse.json({ detail, ...complement }, { status: statut }),
  };
}

/**
 * Lit le corps en comptant les octets, puis l'analyse.
 * La lecture est interrompue dès que la limite est franchie : les octets déjà
 * reçus sont abandonnés, le reste n'est jamais lu.
 */
export async function lireCorpsJson(
  request: Request,
  limiteOctets: number = CORPS_MAX_OCTETS,
): Promise<LectureCorps> {
  const annonce = request.headers.get("content-length");
  if (annonce && Number(annonce) > limiteOctets) {
    return refuser(413, CORPS_TROP_VOLUMINEUX, {
      limite_octets: limiteOctets,
      annonce_octets: Number(annonce),
    });
  }

  if (!request.body) {
    return refuser(400, "Corps de requête absent");
  }

  const reader = request.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limiteOctets) {
        // On abandonne la lecture : inutile d'absorber le reste du flux.
        await reader.cancel().catch(() => {});
        return refuser(413, CORPS_TROP_VOLUMINEUX, { limite_octets: limiteOctets });
      }
      morceaux.push(value);
    }
  } catch {
    return refuser(400, "Corps de requête illisible");
  }

  if (total === 0) {
    return refuser(400, "Corps de requête vide");
  }

  const texte = new TextDecoder().decode(concatener(morceaux, total));

  let valeur: unknown;
  try {
    valeur = JSON.parse(texte);
  } catch {
    return refuser(400, "Corps JSON invalide");
  }

  const profondeur = profondeurDe(valeur);
  if (profondeur > PROFONDEUR_MAX) {
    return refuser(422, `Structure JSON trop profonde (${profondeur} niveaux, maximum ${PROFONDEUR_MAX})`);
  }

  const depassement = premierChampTropLong(valeur);
  if (depassement) {
    return refuser(422, `Champ « ${depassement.champ} » trop long (${depassement.taille} caractères, maximum ${depassement.limite})`);
  }

  return { ok: true, value: valeur, texte };
}

function concatener(morceaux: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const m of morceaux) {
    out.set(m, offset);
    offset += m.byteLength;
  }
  return out;
}

/**
 * Profondeur d'imbrication, **sans récursion** : une structure hostile est
 * justement celle qui ferait déborder la pile d'un parcours récursif.
 */
export function profondeurDe(valeur: unknown): number {
  let max = 0;
  const pile: Array<{ v: unknown; p: number }> = [{ v: valeur, p: 1 }];

  while (pile.length > 0) {
    const { v, p } = pile.pop()!;
    if (p > max) max = p;
    if (p > PROFONDEUR_MAX + 1) continue; // inutile d'aller plus loin
    if (Array.isArray(v)) {
      for (const item of v) pile.push({ v: item, p: p + 1 });
    } else if (v !== null && typeof v === "object") {
      for (const item of Object.values(v as Record<string, unknown>)) pile.push({ v: item, p: p + 1 });
    }
  }
  return max;
}

/** Premier champ texte dont la longueur dépasse la limite déclarée. */
function premierChampTropLong(valeur: unknown): { champ: string; taille: number; limite: number } | null {
  if (valeur === null || typeof valeur !== "object" || Array.isArray(valeur)) return null;

  for (const [cle, limite] of Object.entries(CHAMPS_MAX)) {
    const brut = (valeur as Record<string, unknown>)[cle];
    if (typeof brut === "string" && brut.length > limite) {
      return { champ: cle, taille: brut.length, limite };
    }
  }
  return null;
}
