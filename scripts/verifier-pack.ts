/**
 * Vérification hors ligne d'un pack de preuves (B-10, chantier 4).
 *
 * Ne se connecte à aucune base et n'appelle aucun service : il relit l'archive reçue et
 * recalcule tous les condensats. Un contrôleur peut l'exécuter sur une copie.
 *
 * Usage :
 *   npx tsx scripts/verifier-pack.ts <archive.zip>
 *
 * Code de sortie : 0 si aucune anomalie, 1 sinon (ou si le fichier est illisible).
 *
 * ⚠️ Une archive « OK » prouve la cohérence interne (condensats, manifeste, fichiers
 *   décrits). Elle ne prouve pas la date de production, ni la chaîne du journal dans sa
 *   totalité : voir `docs/EVIDENCE_ENGINE_SPEC.md` §7.
 */
import { readFileSync } from "node:fs";

import { verifierPack } from "../src/lib/evidence/pack";

function main(): void {
  const chemin = process.argv[2];
  if (!chemin) {
    console.error("Usage : npx tsx scripts/verifier-pack.ts <archive.zip>");
    process.exit(1);
  }

  let octets: Uint8Array;
  try {
    octets = readFileSync(chemin);
  } catch (erreur) {
    console.error(`🔴 Lecture impossible : ${(erreur as Error).message}`);
    process.exit(1);
  }

  const rapport = verifierPack(octets);
  const manifeste = rapport.manifeste as Record<string, any> | null;

  if (rapport.ok) {
    console.log(`✅ Pack cohérent : ${rapport.fichiers} fichier(s) vérifié(s).`);
  } else {
    console.log(`🔴 Pack non cohérent : ${rapport.anomalies.length} anomalie(s).`);
    for (const a of rapport.anomalies) console.log(`   · ${a}`);
  }
  if (manifeste) {
    console.log(`   dossier        : ${manifeste.dossier?.reference ?? "?"} (statut ${manifeste.dossier?.statut ?? "?"})`);
    console.log(`   readiness      : ${manifeste.readiness?.etat ?? "?"}`);
    console.log(`   pièces         : ${(manifeste.pieces ?? []).length}`);
    console.log(`   généré le      : ${manifeste.genere_le ?? "?"}`);
    for (const n of manifeste.non_verifie ?? []) console.log(`   ⚠ non vérifié : ${n}`);
  }
  process.exit(rapport.ok ? 0 : 1);
}

main();
