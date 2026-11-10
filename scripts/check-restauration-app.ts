/**
 * Application restaurée : contrôle de service après restauration (B-2, chantier 5).
 *
 * Interroge une instance de GeoForest branchée sur une base RESTAURÉE, avec le compte
 * lecteur (sans MFA), et compare à la base d'origine, en lecture seule :
 *   - le nombre de dossiers et de pièces visibles ;
 *   - le téléchargement de chaque pièce par URL signée : les octets servis doivent avoir
 *     le condensat enregistré en base d'origine.
 *
 * Exécution :
 *   E2E_BASE_URL=http://127.0.0.1:3101 E2E_PASSWORD=… \
 *   REFERENCE_DATABASE_URL=<URL administrateur de la base d'origine, lecture seule> \
 *     npx tsx --conditions=react-server scripts/check-restauration-app.ts
 *
 * ⚠️ Ne modifie rien : aucune écriture côté application, aucune écriture sur la base de
 *   référence (seules des lectures y sont faites).
 */
import { createHash } from "node:crypto";
import { Client } from "pg";

import { BASE, PASSWORD, connecter } from "./e2e/client";

let reussis = 0;
const echecs: string[] = [];

function check(nom: string, condition: boolean, detail = ""): void {
  if (condition) {
    reussis += 1;
    console.log(`  ✅ ${nom}${detail ? ` — ${detail}` : ""}`);
  } else {
    echecs.push(`${nom}${detail ? ` — ${detail}` : ""}`);
    console.log(`  🔴 ${nom}${detail ? ` — ${detail}` : ""}`);
  }
}

const sha256 = (octets: Uint8Array): string => createHash("sha256").update(octets).digest("hex");

async function main(): Promise<void> {
  if (!PASSWORD) throw new Error("E2E_PASSWORD absent (mot de passe des comptes de test, non affiché).");
  const urlReference = process.env.REFERENCE_DATABASE_URL;
  if (!urlReference) throw new Error("REFERENCE_DATABASE_URL absent.");

  const reference = new Client({ connectionString: urlReference });
  await reference.connect();
  console.log(`Instance restaurée : ${BASE}`);

  // Référence : dossiers et pièces de l'organisation de test, lus sur la base d'origine.
  // Organisation de test A : celle du compte lecteur. Les autres organisations ne sont pas comparées.
  const { rows: orgs } = await reference.query("select id::text from gf_organizations where name like 'GeoForest Agrobusiness SAS%'");
  if (orgs.length !== 1) throw new Error("organisation de test introuvable sur la base de référence");
  const orgId = (orgs[0] as { id: string }).id;
  const { rows: refDossiers } = await reference.query(
    "select count(*)::int as n from gf_due_diligence_statements where deleted_at is null and organization_id = $1",
    [orgId],
  );
  const { rows: refPieces } = await reference.query(
    "select id::text, sha256, file_name from gf_documents where storage_key is not null and deleted_at is null and organization_id = $1 order by id",
    [orgId],
  );
  const nDossiers = (refDossiers[0] as { n: number }).n;
  await reference.end();

  console.log("\n##### Connexion (lecteur, sans MFA) #####");
  const lecteur = await connecter("lecteur@geoforest.eu", "lecteur-restaure");
  check("connexion sur la base restaurée", true);

  console.log("\n##### Dossiers #####");
  const dossiers = await lecteur.request("GET", "/api/v1/due-diligence", undefined, undefined, {});
  const listeDossiers = Array.isArray(dossiers.json) ? dossiers.json : (dossiers.json?.items ?? []);
  check("liste des dossiers accessible", dossiers.status === 200, `HTTP ${dossiers.status}`);
  check("nombre de dossiers identique à la base d'origine", listeDossiers.length === nDossiers, `${listeDossiers.length} / ${nDossiers}`);

  console.log("\n##### Pièces : octets servis = condensat d'origine #####");
  let identiques = 0;
  for (const piece of refPieces as Array<{ id: string; sha256: string | null; file_name: string }>) {
    const lien = await lecteur.request("GET", `/api/v1/documents/${piece.id}/url`, undefined, undefined, {});
    const url: string | undefined = lien.json?.url ?? lien.json?.signed_url ?? lien.json?.signedUrl;
    if (lien.status !== 200 || !url) {
      check(`pièce ${piece.id} : URL signée obtenue`, false, `HTTP ${lien.status}, clés : ${Object.keys(lien.json ?? {}).join(",")}`);
      continue;
    }
    const absolue = url.startsWith("http") ? url : `${BASE}${url}`;
    const res = await fetch(absolue, { headers: { cookie: lecteur.cookieHeader() }, redirect: "manual" });
    const octets = new Uint8Array(await res.arrayBuffer());
    const ok = res.status === 200 && sha256(octets) === piece.sha256;
    if (ok) identiques += 1;
    check(`pièce ${piece.id} : octets identiques`, ok, `HTTP ${res.status}`);
  }
  check("toutes les pièces servies à l'identique", identiques === refPieces.length, `${identiques}/${refPieces.length}`);

  console.log(`\nRésultat : ${reussis} contrôle(s) réussi(s), ${echecs.length} échec(s).`);
  if (echecs.length > 0) {
    for (const e of echecs) console.log(`  - ${e}`);
    process.exit(1);
  }
}

main().catch((erreur) => {
  console.error(`🔴 Erreur : ${(erreur as Error).name}: ${(erreur as Error).message.replace(/postgres(ql)?:\/\/\S+/g, "<url masquée>")}`);
  process.exit(1);
});
