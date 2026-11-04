/**
 * Cohérence de la version entre `package.json` et le code.
 *
 * ⚠️ Deux endroits déclarent la version : `package.json` (pour npm, pour
 *   l'humain) et `src/lib/version.ts` (pour la sonde `/api/health`, la seule
 *   que la production lise réellement). Elles peuvent diverger silencieusement
 *   — et c'est précisément le défaut d'origine : la sonde annonçait
 *   « inconnue » sans que rien ne le signale.
 *
 * Ce contrôle ne peut pas vérifier que la version *déployée* est la bonne : il
 * ne voit que le dépôt. Il vérifie au moins que le dépôt est cohérent avec
 * lui-même, ce qui est la seule chose qu'un contrôle de CI puisse affirmer.
 *
 * Usage : npm run check:version
 */
import { readFileSync } from "node:fs";

import { VERSION_APPLICATION } from "../src/lib/version";

interface Controle {
  nom: string;
  ok: boolean;
  detail: string;
}

const controles: Controle[] = [];

function verifier(nom: string, ok: boolean, detail: string): void {
  controles.push({ nom, ok, detail });
  console.log(`${ok ? "✅" : "🔴"} ${nom}`);
  if (!ok) console.log(`   ${detail}`);
}

const paquet = JSON.parse(readFileSync("package.json", "utf-8")) as {
  version?: string;
  engines?: { node?: string };
};

verifier(
  "package.json déclare une version",
  typeof paquet.version === "string" && paquet.version.length > 0,
  "champ « version » absent : npm refuserait de publier, et rien n'identifie le déploiement",
);

verifier(
  "src/lib/version.ts est aligné sur package.json",
  paquet.version === VERSION_APPLICATION,
  `package.json « ${paquet.version} » ≠ src/lib/version.ts « ${VERSION_APPLICATION} »`,
);

// Format SemVer de base : x.y.z, éventuellement suffixé. Une version
// fantaisiste (« inconnue », « latest ») rendrait la sonde inexploitable.
verifier(
  "la version est au format SemVer",
  /^\d+\.\d+\.\d+/.test(VERSION_APPLICATION),
  `« ${VERSION_APPLICATION} » n'est pas une version exploitable`,
);

verifier(
  "package.json déclare la version de Node attendue",
  typeof paquet.engines?.node === "string",
  "champ engines.node absent : rien n'empêche un déploiement sur un Node incompatible",
);

// ⚠️ `.nvmrc` et `engines` doivent s'accorder : le premier est lu par les
//   développeurs (`nvm use`), le second par npm. Un désaccord donne un poste
//   de travail sur une version que la CI ne teste pas.
let nvmrc = "";
try {
  nvmrc = readFileSync(".nvmrc", "utf-8").trim();
} catch {
  /* absent : signalé ci-dessous */
}
verifier(
  ".nvmrc existe et s'accorde avec engines.node",
  nvmrc !== "" && (paquet.engines?.node ?? "").includes(nvmrc),
  `.nvmrc « ${nvmrc || "absent"} » vs engines.node « ${paquet.engines?.node ?? "absent"} »`,
);

const echecs = controles.filter((c) => !c.ok);
console.log(`\n${controles.length - echecs.length}/${controles.length} contrôle(s) réussi(s)`);
process.exit(echecs.length === 0 ? 0 : 1);
