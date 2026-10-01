/**
 * Vérifie le chantier P1-16 côté import CSV.
 *
 * Pourquoi un banc dédié : `parsePastedText` s'exécute normalement dans le
 * navigateur. Rien ne permet donc de le voir échouer depuis les tests HTTP du
 * produit — un import qui rejette tous les tableurs français ne se manifeste
 * que devant un utilisateur réel, avec un message qui ne dit pas la cause.
 *
 * Exécution :
 *     npx tsx scripts/check-csv-latin.ts
 */
import { parsePastedText, ParseError } from "../src/lib/parsers";
import { validateGeometry } from "../src/lib/eudr/gis-validator";

let reussis = 0;
let echecs = 0;

function verifier(label: string, condition: boolean, detail: string): void {
  if (condition) {
    reussis += 1;
    console.log(`  ✅ ${label} — ${detail}`);
  } else {
    echecs += 1;
    console.log(`  🔴 ${label} — ${detail}`);
  }
}

interface Attendu {
  label: string;
  csv: string;
  /** Nombre de parcelles attendues (0 ⇒ on attend un rejet). */
  parcelles?: number;
  /** Nombre de décimales attendu dans `properties.min_decimals`. */
  decimals?: number;
  /** Valeur attendue pour la première coordonnée [lon, lat]. */
  premier?: [number, number];
  /** Morceau de message attendu en cas de rejet. */
  messageContient?: string;
  /** Surface déclarée attendue (propriété `area_ha`). */
  surface?: number;
}

const CAS: Attendu[] = [
  {
    label: "Excel français : point-virgule + virgule décimale",
    csv: [
      "Latitude;Longitude",
      "5,300000;-5,500000",
      "5,310000;-5,490000",
      "5,310000;-5,500000",
      "5,300000;-5,500000",
    ].join("\n"),
    parcelles: 1,
    decimals: 6,
    premier: [-5.5, 5.3],
  },
  {
    label: "Excel français avec colonnes id et surface",
    csv: [
      "Parcelle;Latitude;Longitude;Surface",
      "P1;5,300000;-5,500000;12,5",
      "P1;5,310000;-5,490000;12,5",
      "P1;5,310000;-5,500000;12,5",
      "P1;5,300000;-5,500000;12,5",
    ].join("\n"),
    parcelles: 1,
    decimals: 6,
    premier: [-5.5, 5.3],
    surface: 12.5,
  },
  {
    label: "Milliers avec espace insécable dans la surface",
    csv: [
      "Parcelle;Latitude;Longitude;Surface",
      "P1;5,300000;-5,500000;1\u00a0234,56",
      "P1;5,310000;-5,490000;1\u00a0234,56",
      "P1;5,310000;-5,500000;1\u00a0234,56",
      "P1;5,300000;-5,500000;1\u00a0234,56",
    ].join("\n"),
    parcelles: 1,
    surface: 1234.56,
  },
  {
    label: "Champs entre guillemets (export Excel strict)",
    csv: [
      '"Latitude";"Longitude"',
      '"5,300000";"-5,500000"',
      '"5,310000";"-5,490000"',
      '"5,310000";"-5,500000"',
      '"5,300000";"-5,500000"',
    ].join("\n"),
    parcelles: 1,
    decimals: 6,
  },
  {
    label: "CSV classique : virgule + point décimal (non régressé)",
    csv: [
      "lat,lon",
      "5.300000,-5.500000",
      "5.310000,-5.490000",
      "5.310000,-5.500000",
      "5.300000,-5.500000",
    ].join("\n"),
    parcelles: 1,
    decimals: 6,
    premier: [-5.5, 5.3],
  },
  {
    label: "Tabulation + point décimal",
    csv: ["lat\tlon", "5.300000\t-5.500000", "5.310000\t-5.490000", "5.310000\t-5.500000", "5.300000\t-5.500000"].join(
      "\n",
    ),
    parcelles: 1,
    decimals: 6,
  },
  {
    label: "Point décimal dans un fichier point-virgule (souplesse)",
    csv: [
      "lat;lon",
      "5.300000;-5.500000",
      "5.310000;-5.490000",
      "5.310000;-5.500000",
      "5.300000;-5.500000",
    ].join("\n"),
    parcelles: 1,
    decimals: 6,
  },
  {
    label: "Colonnes inversées ⇒ rejet explicite, pas de géométrie fausse",
    csv: ["Latitude;Longitude", "95,300000;-5,500000", "95,310000;-5,490000", "95,310000;-5,500000", "95,300000;-5,500000"].join(
      "\n",
    ),
    parcelles: 0,
    messageContient: "hors bornes",
  },
  {
    label: "Texte dans une colonne de coordonnées ⇒ message qui dit la cause",
    csv: ["lat;lon", "5,3;abc", "5,31;-5,49", "5,31;-5,50", "5,3;-5,50"].join("\n"),
    parcelles: 0,
    messageContient: "séparateur décimal",
  },
];

console.log("\n##### Import CSV — formats français et internationaux #####");

for (const cas of CAS) {
  let analyse;
  try {
    analyse = parsePastedText(cas.csv);
  } catch (e) {
    const msg = e instanceof ParseError ? e.message : String(e);
    if (cas.parcelles === 0) {
      const ok = cas.messageContient ? msg.includes(cas.messageContient) : true;
      verifier(cas.label, ok, `rejet attendu — « ${msg} »`);
    } else {
      verifier(cas.label, false, `rejet inattendu — « ${msg} »`);
    }
    continue;
  }

  if (cas.parcelles === 0) {
    verifier(cas.label, false, `devait être rejeté, ${analyse.featureCount} parcelle(s) produite(s)`);
    continue;
  }

  const fc = analyse.geojson as { features: Array<{ properties: Record<string, unknown>; geometry: { coordinates: unknown } }> };
  verifier(cas.label, fc.features.length === cas.parcelles, `${fc.features.length} parcelle(s)`);

  const f = fc.features[0];
  if (!f) {
    verifier(cas.label, false, "aucune parcelle produite — les contrôles suivants sont ignorés");
    continue;
  }
  if (cas.decimals !== undefined) {
    verifier(
      `${cas.label} · précision`,
      f.properties.min_decimals === cas.decimals,
      `min_decimals = ${String(f.properties.min_decimals)} (attendu ${cas.decimals})`,
    );
  }
  if (cas.premier) {
    const coords = f.geometry.coordinates as number[][][];
    const p = coords[0][0];
    verifier(
      `${cas.label} · première coordonnée`,
      Math.abs(p[0] - cas.premier[0]) < 1e-9 && Math.abs(p[1] - cas.premier[1]) < 1e-9,
      `[${p[0]}, ${p[1]}] (attendu [${cas.premier[0]}, ${cas.premier[1]}])`,
    );
  }
  if (cas.surface !== undefined) {
    verifier(
      `${cas.label} · surface déclarée`,
      Math.abs(Number(f.properties.area_ha) - cas.surface) < 1e-6,
      `area_ha = ${String(f.properties.area_ha)} (attendu ${cas.surface})`,
    );
  }
}

// ------------------------------------------------------------------ chaînage
console.log("\n##### Le CSV importé passe-t-il la validation EUDR ? #####");
{
  // Un import qui réussit mais dont la géométrie est ensuite refusée pour
  // précision insuffisante ne sert à rien : le défaut est simplement déplacé.
  const csv = ["Latitude;Longitude", "5,300000;-5,500000", "5,310000;-5,490000", "5,310000;-5,500000", "5,300000;-5,500000"].join(
    "\n",
  );
  const analyse = parsePastedText(csv);
  // Le texte émis tient lieu de corps de requête : c'est exactement ce que le
  // serveur recevra, et ce sur quoi il mesurera la précision.
  const v = validateGeometry(analyse.geojson as never, { rawText: analyse.geojsonText });
  verifier(
    "géométrie issue du CSV acceptée par le validateur",
    v.valid,
    `valid=${v.valid} erreurs=[${v.errors.map((e) => e.code).join(",")}] avert=[${v.warnings.map((w) => w.code).join(",")}]`,
  );
  verifier(
    "précision reconnue à 6 décimales",
    v.min_decimals_found === 6,
    `min_decimals_found = ${String(v.min_decimals_found)}`,
  );
}

// ------------------------------------------- précision transmise au serveur
console.log("\n##### La précision du fichier atteint-elle le serveur intacte ? #####");
{
  // C'est l'objet même de P1-16 côté import : un fichier à 6 décimales doit
  // arriver au serveur avec ses 6 décimales, sinon il est refusé pour un
  // défaut qu'il n'a pas.
  const csv = ["Latitude;Longitude", "5,300000;-5,500000", "5,310000;-5,490000", "5,310000;-5,500000", "5,300000;-5,500000"].join(
    "\n",
  );
  const texte = parsePastedText(csv).geojsonText;
  verifier(
    "les zéros terminaux survivent à la sérialisation",
    texte.includes("-5.500000") && texte.includes("5.300000"),
    texte.slice(0, 120),
  );
  verifier(
    "le texte émis est du JSON valide",
    (() => {
      try {
        JSON.parse(texte);
        return true;
      } catch {
        return false;
      }
    })(),
    `${texte.length} octets`,
  );
}

{
  // Même épreuve sur un fichier GeoJSON : c'est le cas le plus courant, et il
  // était cassé de la même façon.
  const source =
    '{"type":"Polygon","coordinates":[[[-5.500000,5.300000],[-5.490000,5.300000],' +
    "[-5.490000,5.310000],[-5.500000,5.310000],[-5.500000,5.300000]]]}";
  const texte = parsePastedText(source).geojsonText;
  verifier(
    "GeoJSON déposé : le texte d'origine est transmis tel quel",
    texte === source,
    texte === source ? "identique à l'octet près" : `attendu ${source} / reçu ${texte}`,
  );
}

{
  // Un fichier réellement imprécis doit rester refusé : la préservation ne
  // doit pas devenir une indulgence.
  const csv = ["Latitude;Longitude", "5,3;-5,5", "5,31;-5,49", "5,31;-5,50", "5,3;-5,50"].join("\n");
  const analyse = parsePastedText(csv);
  const v = validateGeometry(analyse.geojson as never, { rawText: analyse.geojsonText });
  verifier(
    "un CSV à une décimale reste refusé (pas d'indulgence)",
    !v.valid && v.errors.some((e) => e.code === "INSUFFICIENT_PRECISION"),
    `valid=${v.valid} précision=${String(v.min_decimals_found)} erreurs=[${v.errors.map((e) => e.code).join(",")}]`,
  );
}

console.log(`\n======================================================================`);
console.log(`CONTRÔLES RÉUSSIS : ${reussis}/${reussis + echecs}`);
console.log(`======================================================================\n`);
process.exit(echecs === 0 ? 0 : 1);
