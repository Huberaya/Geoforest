/**
 * Empreinte d'une base et de son stockage de pièces (B-2, chantier 5).
 *
 * Sert à deux moments, avec le même calcul :
 *   1. avant sauvegarde : `--json avant.json` ;
 *   2. après restauration : `--comparer avant.json`.
 * Toute différence (nombre de lignes, ancre de la chaîne du journal, pièce manquante
 * ou altérée, fichier de stockage ajouté ou modifié) fait échouer la comparaison.
 *
 * Usage :
 *   npx tsx scripts/empreinte-sauvegarde.ts [--url <postgres://…>] [--stockage <dossier>]
 *                                           [--json <sortie.json>] [--comparer <reference.json>]
 *
 * Par défaut : --url = DATABASE_URL_ADMIN (ou DATABASE_URL), --stockage = GF_STORAGE_DIR
 * ou var/storage. Ne sort jamais l'URL ni de mot de passe.
 *
 * Code de sortie : 0 si l'empreinte est cohérente (et identique à la référence si --comparer),
 * 1 sinon, 2 si l'appel est mal formé.
 *
 * ⚠️ Lecture en administrateur de base : le contrôle porte sur toutes les lignes, y compris
 *   celles que la politique RLS masque aux locataires. Il ne doit pas être exécuté avec
 *   un compte applicatif.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local" });

interface Options {
  url: string;
  stockage: string;
  json: string | null;
  comparer: string | null;
}

interface Empreinte {
  tables: Record<string, number>;
  chaine: Record<string, { sequence: number; hash: string | null }>;
  pieces: { total: number; ok: number; manquantes: string[]; alterees: string[] };
  stockage: { fichiers: number; octets: number; empreinte: string };
}

function lireOptions(argv: string[]): Options | null {
  const valeur = (nom: string): string | null => {
    const i = argv.indexOf(nom);
    if (i === -1) return null;
    const v = argv[i + 1];
    return v && !v.startsWith("--") ? v : null;
  };
  const url = valeur("--url") ?? process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL ?? null;
  if (!url) {
    console.error("🔴 URL de base absente : --url, DATABASE_URL_ADMIN ou DATABASE_URL.");
    return null;
  }
  const stockage = resolve(valeur("--stockage") ?? process.env.GF_STORAGE_DIR ?? join(process.cwd(), "var", "storage"));
  return { url, stockage, json: valeur("--json"), comparer: valeur("--comparer") };
}

/** Parcourt le stockage : chemin relatif, condensat, et une empreinte globale de l'arborescence. */
function empreinteStockage(racine: string): { resume: Empreinte["stockage"]; fichiersParChemin: Map<string, string> } {
  const fichiersParChemin = new Map<string, string>();
  let octets = 0;
  const parcourir = (dossier: string): void => {
    for (const nom of readdirSync(dossier)) {
      const chemin = join(dossier, nom);
      const etat = statSync(chemin);
      if (etat.isDirectory()) {
        parcourir(chemin);
      } else if (etat.isFile()) {
        const contenu = readFileSync(chemin);
        octets += contenu.byteLength;
        fichiersParChemin.set(relative(racine, chemin).split("\\").join("/"), createHash("sha256").update(contenu).digest("hex"));
      }
    }
  };
  if (existsSync(racine)) parcourir(racine);
  const lignes = [...fichiersParChemin.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([c, h]) => `${h}  ${c}\n`);
  const empreinte = createHash("sha256").update(lignes.join("")).digest("hex");
  return { resume: { fichiers: fichiersParChemin.size, octets, empreinte }, fichiersParChemin };
}

async function calculer(client: Client, stockage: string): Promise<Empreinte> {
  const { rows: tablesRows } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1",
  );
  const tables: Record<string, number> = {};
  for (const { table_name } of tablesRows as Array<{ table_name: string }>) {
    const { rows } = await client.query(`select count(*)::int as n from "${table_name.replace(/"/g, '""')}"`);
    tables[table_name] = (rows[0] as { n: number }).n;
  }

  // Ancre de chaque organisation : dernier rang et dernier condensat.
  const { rows: chaineRows } = await client.query(
    "select distinct on (organization_id) organization_id::text as org, sequence::int as seq, hash from gf_audit_logs where organization_id is not null order by organization_id, sequence desc",
  );
  const chaine: Empreinte["chaine"] = {};
  for (const r of chaineRows as Array<{ org: string; seq: number; hash: string | null }>) {
    chaine[r.org] = { sequence: r.seq, hash: r.hash };
  }

  // Pièces : chaque condensat déposé doit correspondre à un fichier présent et identique.
  const stock = empreinteStockage(stockage);
  const manquantes: string[] = [];
  const alterees: string[] = [];
  let total = 0;
  let ok = 0;
  const verifier = (id: string, cle: string | null, sha: string | null): void => {
    if (!cle || !sha) return;
    total += 1;
    const obtenu = stock.fichiersParChemin.get(cle);
    if (obtenu === undefined) manquantes.push(id);
    else if (obtenu !== sha) alterees.push(id);
    else ok += 1;
  };
  const { rows: docs } = await client.query("select id::text, storage_key, sha256 from gf_documents where storage_key is not null");
  for (const d of docs as Array<{ id: string; storage_key: string; sha256: string | null }>) verifier(d.id, d.storage_key, d.sha256);
  const { rows: versions } = await client.query(
    "select id::text, storage_key, sha256 from gf_document_versions where storage_key is not null",
  );
  for (const v of versions as Array<{ id: string; storage_key: string; sha256: string | null }>) verifier(`version:${v.id}`, v.storage_key, v.sha256);

  return { tables, chaine, pieces: { total, ok, manquantes, alterees }, stockage: stock.resume };
}

function comparer(reference: Empreinte, obtenu: Empreinte): string[] {
  const ecarts: string[] = [];
  const toutes = new Set([...Object.keys(reference.tables), ...Object.keys(obtenu.tables)]);
  for (const t of toutes) {
    if (reference.tables[t] !== obtenu.tables[t]) ecarts.push(`table ${t} : ${reference.tables[t]} → ${obtenu.tables[t]} lignes`);
  }
  const orgs = new Set([...Object.keys(reference.chaine), ...Object.keys(obtenu.chaine)]);
  for (const o of orgs) {
    const a = reference.chaine[o];
    const b = obtenu.chaine[o];
    if (JSON.stringify(a) !== JSON.stringify(b)) ecarts.push(`ancre du journal (organisation ${o}) : ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
  if (reference.pieces.total !== obtenu.pieces.total) ecarts.push(`pièces à contrôler : ${reference.pieces.total} → ${obtenu.pieces.total}`);
  if (obtenu.pieces.manquantes.length) ecarts.push(`pièces absentes du stockage : ${obtenu.pieces.manquantes.join(", ")}`);
  if (obtenu.pieces.alterees.length) ecarts.push(`pièces dont le contenu diffère : ${obtenu.pieces.alterees.join(", ")}`);
  if (reference.stockage.fichiers !== obtenu.stockage.fichiers) ecarts.push(`fichiers de stockage : ${reference.stockage.fichiers} → ${obtenu.stockage.fichiers}`);
  if (reference.stockage.empreinte !== obtenu.stockage.empreinte) ecarts.push("arborescence de stockage différente (empreinte globale)");
  return ecarts;
}

async function main(): Promise<void> {
  const options = lireOptions(process.argv.slice(2));
  if (!options) process.exit(2);

  const client = new Client({ connectionString: options.url });
  await client.connect();
  let empreinte: Empreinte;
  try {
    empreinte = await calculer(client, options.stockage);
  } finally {
    await client.end();
  }

  const piecesOk = empreinte.pieces.manquantes.length === 0 && empreinte.pieces.alterees.length === 0;
  console.log(`Tables : ${Object.keys(empreinte.tables).length}, lignes : ${Object.values(empreinte.tables).reduce((a, b) => a + b, 0)}`);
  console.log(`Chaîne du journal : ${Object.keys(empreinte.chaine).length} organisation(s) ancrée(s)`);
  console.log(`Pièces : ${empreinte.pieces.ok}/${empreinte.pieces.total} conformes au stockage`);
  console.log(`Stockage : ${empreinte.stockage.fichiers} fichier(s), ${empreinte.stockage.octets} octet(s), empreinte ${empreinte.stockage.empreinte.slice(0, 16)}…`);
  if (!piecesOk) {
    console.log(`🔴 Pièces : ${empreinte.pieces.manquantes.length} manquante(s), ${empreinte.pieces.alterees.length} altérée(s).`);
  }

  if (options.json) writeFileSync(options.json, `${JSON.stringify(empreinte, null, 2)}\n`);

  let ecarts: string[] = [];
  if (options.comparer) {
    const reference = JSON.parse(readFileSync(options.comparer, "utf8")) as Empreinte;
    ecarts = comparer(reference, empreinte);
    if (ecarts.length === 0) console.log("✅ Empreinte identique à la référence.");
    else {
      console.log(`🔴 ${ecarts.length} écart(s) avec la référence :`);
      for (const e of ecarts) console.log(`   · ${e}`);
    }
  }
  process.exit(piecesOk && ecarts.length === 0 ? 0 : 1);
}

main().catch((erreur) => {
  // Le message ne doit pas contenir l'URL : on n'affiche que le type d'erreur.
  console.error(`🔴 Empreinte impossible : ${(erreur as Error).name}: ${(erreur as Error).message.replace(/postgres(ql)?:\/\/\S+/g, "<url masquée>")}`);
  process.exit(1);
});
