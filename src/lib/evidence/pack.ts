/**
 * Pack de preuves d'un dossier : construction et vérification hors ligne (B-10, chantier 4).
 *
 * Module pur : aucune base, aucun stockage. Il sert à trois usages, qui doivent
 * rester d'accord entre eux :
 *   · la route qui produit le pack (`/api/v1/due-diligence/[id]/evidence-pack`) ;
 *   · le vérificateur autonome (`scripts/verifier-pack.ts`), qu'un contrôleur peut
 *     exécuter sans accès au produit ;
 *   · le test pur (`scripts/check-evidence-pack.ts`).
 *
 * ⚠️ Ce que le pack prouve, et ce qu'il ne prouve pas.
 *   - Il prouve que les fichiers qu'il contient sont **ceux dont les condensats sont
 *     listés** dans `SHA256SUMS.txt`, et que le manifeste décrit les mêmes pièces.
 *   - Il ne prouve pas que son contenu a été généré à une date donnée par une autorité
 *     tierce : la signature externe et l'horodatage qualifié ne sont pas implémentés.
 *   - Il ne prouve pas la chaîne du journal dans son ensemble : seul l'extrait du
 *     dossier est joint, avec l'ancre de l'organisation. Le contrôle complet reste
 *     `scripts/verifier-chaine.ts`, qui s'exécute côté base.
 */
import { createHash } from "node:crypto";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export const FORMAT_PACK = "geoforest.evidence-pack/1";
export const NOM_MANIFESTE = "manifeste.json";
export const NOM_SOMMES = "SHA256SUMS.txt";
export const NOM_LISEZMOI = "LISEZMOI.txt";
export const PREFIXE_PIECES = "pieces/";

export interface FichierPack {
  /** Chemin relatif dans l'archive, séparateur `/`, sans `..` ni chemin absolu. */
  chemin: string;
  contenu: Uint8Array;
}

export function sha256Hex(octets: Uint8Array): string {
  return createHash("sha256").update(octets).digest("hex");
}

/** Un chemin d'archive doit rester dans l'archive : pas de remontée, pas d'absolu, pas de caractère de contrôle. */
export function cheminValide(chemin: string): boolean {
  if (chemin.length === 0 || chemin.length > 300) return false;
  if (chemin.startsWith("/") || chemin.includes("\\")) return false;
  if (/[\x00-\x1f]/.test(chemin)) return false;
  return chemin.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** Construit l'archive : ajoute `SHA256SUMS.txt`, qui couvre tous les autres fichiers. */
export function construirePack(fichiers: FichierPack[]): { zip: Uint8Array; sommes: string } {
  const vus = new Set<string>();
  for (const f of fichiers) {
    if (!cheminValide(f.chemin)) throw new Error(`chemin de pack refusé : ${JSON.stringify(f.chemin)}`);
    if (f.chemin === NOM_SOMMES) throw new Error(`nom réservé : ${NOM_SOMMES}`);
    if (vus.has(f.chemin)) throw new Error(`chemin de pack en double : ${f.chemin}`);
    vus.add(f.chemin);
  }
  const tries = [...fichiers].sort((a, b) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0));
  const sommes = tries.map((f) => `${sha256Hex(f.contenu)}  ${f.chemin}\n`).join("");
  const entrees: Record<string, Uint8Array> = {};
  for (const f of tries) entrees[f.chemin] = f.contenu;
  entrees[NOM_SOMMES] = strToU8(sommes);
  // Niveau 6 : compact, et sans horodatage fixe pour une archive reproductible.
  const zip = zipSync(entrees, { level: 6, mtime: new Date("2000-01-01T00:00:00Z") });
  return { zip, sommes };
}

export interface RapportVerification {
  ok: boolean;
  anomalies: string[];
  fichiers: number;
  manifeste: Record<string, unknown> | null;
}

interface PieceManifeste {
  document_id: string;
  fichier: string | null;
  sha256: string | null;
  taille: number | null;
}

/**
 * Vérifie une archive reçue. Ne fait confiance à aucune donnée sans la recalculer :
 * chaque fichier doit figurer dans `SHA256SUMS.txt` avec le bon condensat, et chaque
 * pièce du manifeste doit correspondre à un fichier présent.
 */
export function verifierPack(zip: Uint8Array): RapportVerification {
  const anomalies: string[] = [];
  let entrees: Record<string, Uint8Array>;
  try {
    entrees = unzipSync(zip);
  } catch {
    return { ok: false, anomalies: ["archive illisible (ZIP invalide)"], fichiers: 0, manifeste: null };
  }

  const noms = Object.keys(entrees);
  for (const nom of noms) {
    if (!cheminValide(nom)) anomalies.push(`chemin dangereux dans l'archive : ${JSON.stringify(nom)}`);
  }

  const sommesBrut = entrees[NOM_SOMMES];
  if (!sommesBrut) {
    anomalies.push(`${NOM_SOMMES} absent : aucune empreinte de référence`);
  }

  const listes = new Map<string, string>();
  if (sommesBrut) {
    for (const ligne of strFromU8(sommesBrut).split("\n")) {
      if (ligne.trim() === "") continue;
      const m = /^([0-9a-f]{64})  (.+)$/.exec(ligne);
      if (!m) {
        anomalies.push(`ligne de ${NOM_SOMMES} mal formée`);
        continue;
      }
      if (listes.has(m[2])) anomalies.push(`fichier listé deux fois : ${m[2]}`);
      listes.set(m[2], m[1]);
    }
  }

  for (const nom of noms) {
    if (nom === NOM_SOMMES) continue;
    const attendu = listes.get(nom);
    if (attendu === undefined) {
      anomalies.push(`fichier non listé dans ${NOM_SOMMES} : ${nom}`);
      continue;
    }
    const obtenu = sha256Hex(entrees[nom]);
    if (obtenu !== attendu) anomalies.push(`condensat différent : ${nom}`);
  }
  for (const nom of listes.keys()) {
    if (!(nom in entrees)) anomalies.push(`fichier listé mais absent : ${nom}`);
  }

  let manifeste: Record<string, unknown> | null = null;
  const brutManifeste = entrees[NOM_MANIFESTE];
  if (!brutManifeste) {
    anomalies.push(`${NOM_MANIFESTE} absent`);
  } else {
    try {
      manifeste = JSON.parse(strFromU8(brutManifeste)) as Record<string, unknown>;
    } catch {
      anomalies.push(`${NOM_MANIFESTE} n'est pas du JSON valide`);
    }
  }

  if (manifeste) {
    if (manifeste.format !== FORMAT_PACK) anomalies.push(`format inattendu : ${String(manifeste.format)}`);
    const pieces = (Array.isArray(manifeste.pieces) ? manifeste.pieces : []) as PieceManifeste[];
    const fichiersAvecPiece = new Set<string>();
    for (const p of pieces) {
      if (p.fichier === null) continue;
      if (!p.fichier || !(p.fichier in entrees)) {
        anomalies.push(`pièce ${p.document_id} : fichier absent de l'archive`);
        continue;
      }
      fichiersAvecPiece.add(p.fichier);
      if (p.sha256 !== sha256Hex(entrees[p.fichier])) {
        anomalies.push(`pièce ${p.document_id} : condensat du manifeste ≠ contenu`);
      }
      if (p.taille !== null && p.taille !== entrees[p.fichier].byteLength) {
        anomalies.push(`pièce ${p.document_id} : taille du manifeste ≠ contenu`);
      }
    }
    for (const nom of noms) {
      if (nom.startsWith(PREFIXE_PIECES) && !fichiersAvecPiece.has(nom)) {
        anomalies.push(`fichier de pièce non décrit par le manifeste : ${nom}`);
      }
    }
  }

  return { ok: anomalies.length === 0, anomalies, fichiers: noms.length, manifeste };
}
