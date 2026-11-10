/**
 * Pack de preuves — contrôles purs (B-10, chantier 4).
 *
 * Exécution : npm run test:unit   (ou : npx tsx scripts/check-evidence-pack.ts)
 *
 * Verrouille la construction et la vérification d'une archive, sans base ni serveur :
 *   - une archive construite est reconnue cohérente, et reproductible octet pour octet ;
 *   - toute altération d'un fichier, d'une pièce ou du manifeste est détectée ;
 *   - un fichier ajouté, retiré ou non décrit est détecté ;
 *   - un chemin qui sort de l'archive est refusé à la construction et à la lecture.
 */
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import {
  cheminValide,
  construirePack,
  FORMAT_PACK,
  NOM_MANIFESTE,
  NOM_SOMMES,
  sha256Hex,
  verifierPack,
} from "../src/lib/evidence/pack";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  🔴 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(titre: string): void {
  console.log(`\n##### ${titre} #####`);
}

const piece = strToU8("%PDF-1.4 contenu de test\n");
const manifesteAvec = (pieces: unknown[]) =>
  strToU8(JSON.stringify({ format: FORMAT_PACK, pieces, non_verifie: [] }));

/** Un pack complet et cohérent, à la manière de l'assembleur. */
function packValide(): Uint8Array {
  const piecePath = "pieces/doc-1-v1-contrat.pdf";
  const { zip } = construirePack([
    {
      chemin: NOM_MANIFESTE,
      contenu: manifesteAvec([
        { document_id: "doc-1", fichier: piecePath, sha256: sha256Hex(piece), taille: piece.byteLength },
      ]),
    },
    { chemin: "dossier.json", contenu: strToU8("{\"id\":\"d\"}") },
    { chemin: piecePath, contenu: piece },
  ]);
  return zip;
}

/** Réécrit une archive après modification d'une entrée. Sans recalcul des sommes : la sortie doit être refusée. */
function reecrire(zip: Uint8Array, modifier: (e: Record<string, Uint8Array>) => void): Uint8Array {
  const entrees = unzipSync(zip);
  modifier(entrees);
  return zipSync(entrees, { level: 6, mtime: new Date("2000-01-01T00:00:00Z") });
}

async function main(): Promise<void> {
  section("Construction et lecture");
  const zip = packValide();
  const rapport = verifierPack(zip);
  check("archive construite reconnue cohérente", rapport.ok, rapport.anomalies.join(" ; "));
  check("le nombre de fichiers inclut les sommes", rapport.fichiers === 4, `${rapport.fichiers}`);
  check("le manifeste est lu", rapport.manifeste?.format === FORMAT_PACK);
  check("même entrée → même archive (reproductible)", Buffer.from(packValide()).equals(Buffer.from(zip)));
  const sommes = strFromU8(unzipSync(zip)[NOM_SOMMES]);
  check("SHA256SUMS couvre chaque fichier", sommes.split("\n").filter(Boolean).length === 3);
  check("empreinte de la pièce conforme", sommes.includes(`${sha256Hex(piece)}  pieces/doc-1-v1-contrat.pdf`));
  check(
    "SHA-256 conforme à node:crypto",
    sha256Hex(piece) === createHash("sha256").update(piece).digest("hex"),
  );

  section("Altérations détectées");
  const alteree = reecrire(zip, (e) => {
    e["pieces/doc-1-v1-contrat.pdf"] = strToU8("%PDF-1.4 contenu modifié\n");
  });
  const rA = verifierPack(alteree);
  check("pièce modifiée : refusée", !rA.ok);
  check("pièce modifiée : anomalie nommée", rA.anomalies.some((a) => a.includes("condensat différent : pieces/doc-1")));

  const retiree = reecrire(zip, (e) => {
    delete e["pieces/doc-1-v1-contrat.pdf"];
  });
  const rR = verifierPack(retiree);
  check("pièce retirée : refusée", !rR.ok);
  check("pièce retirée : signalée comme listée mais absente", rR.anomalies.some((a) => a.includes("listé mais absent")));

  const ajoutee = reecrire(zip, (e) => {
    e["pieces/intrus.pdf"] = strToU8("ajout");
  });
  const rJ = verifierPack(ajoutee);
  check("fichier ajouté : refusé", !rJ.ok);
  check("fichier ajouté : signalé comme non listé", rJ.anomalies.some((a) => a.includes("non listé")));

  const manifesteAltere = reecrire(zip, (e) => {
    const m = JSON.parse(strFromU8(e[NOM_MANIFESTE]));
    m.pieces[0].sha256 = "0".repeat(64);
    e[NOM_MANIFESTE] = strToU8(JSON.stringify(m));
  });
  const rM = verifierPack(manifesteAltere);
  check("manifeste altéré : refusé", !rM.ok);

  const sansSommes = reecrire(zip, (e) => {
    delete e[NOM_SOMMES];
  });
  check("sans SHA256SUMS : refusé", !verifierPack(sansSommes).ok);

  const sansManifeste = reecrire(zip, (e) => {
    delete e[NOM_MANIFESTE];
  });
  check("sans manifeste : refusé", !verifierPack(sansManifeste).ok);

  const pieceNonDecrite = reecrire(zip, (e) => {
    const m = JSON.parse(strFromU8(e[NOM_MANIFESTE]));
    m.pieces = [];
    e[NOM_MANIFESTE] = strToU8(JSON.stringify(m));
  });
  const rN = verifierPack(pieceNonDecrite);
  check("pièce non décrite par le manifeste : refusée", !rN.ok && rN.anomalies.some((a) => a.includes("non décrit")));

  check("archive illisible : refusée", !verifierPack(strToU8("pas un zip")).ok);

  section("Chemins");
  check("chemin normal accepté", cheminValide("pieces/doc-1-v1-a.pdf"));
  check("remontée refusée", !cheminValide("../evil"));
  check("remontée au milieu refusée", !cheminValide("pieces/../../evil"));
  check("chemin absolu refusé", !cheminValide("/etc/passwd"));
  check("antislash refusé", !cheminValide("pieces\\x"));
  check("segment vide refusé", !cheminValide("pieces//x"));
  let refusConstruction = false;
  try {
    construirePack([{ chemin: "../evade.txt", contenu: strToU8("x") }]);
  } catch {
    refusConstruction = true;
  }
  check("construction : chemin dangereux refusé", refusConstruction);
  let doublon = false;
  try {
    construirePack([
      { chemin: "a.txt", contenu: strToU8("1") },
      { chemin: "a.txt", contenu: strToU8("2") },
    ]);
  } catch {
    doublon = true;
  }
  check("construction : chemin en double refusé", doublon);
  let reserve = false;
  try {
    construirePack([{ chemin: NOM_SOMMES, contenu: strToU8("x") }]);
  } catch {
    reserve = true;
  }
  check("construction : nom réservé refusé", reserve);

  console.log(`\nRésultat : ${passed} contrôle(s) réussi(s), ${failures.length} échec(s).`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((erreur) => {
  console.error("🔴 Erreur inattendue :", erreur);
  process.exit(1);
});
