/**
 * Attribue un mot de passe au rôle applicatif — **réservé à la CI**.
 *
 * ⚠️ Pourquoi ce script existe, et pourquoi il est séparé de la migration.
 *
 *   `scripts/sql/post-migrate/010_row_level_security.sql` crée `geoforest_app`
 *   **sans mot de passe et sans capacité de connexion** : c'est une décision de
 *   sécurité assumée, aucun secret ne doit figurer dans un fichier versionné.
 *   Sur les environnements hébergés, l'exploitant pose le mot de passe une
 *   seule fois (`alter role … password …`).
 *
 *   Le banc de bout en bout, lui, doit se connecter **avec le rôle applicatif**
 *   et non avec un superutilisateur : c'est la seule façon de mesurer la
 *   configuration réelle. Sur une base jetable de runner, il faut donc lui
 *   donner un mot de passe — d'où ce script.
 *
 * ⚠️ Les garde-fous, parce qu'un script qui pose un mot de passe est un outil
 *   dangereux entre de mauvaises mains :
 *   • il refuse de s'exécuter si `GF_BASE_JETABLE` n'est pas explicitement
 *     `oui` — sur une base partagée ou de production, il s'arrête ;
 *   • il refuse `NODE_ENV=production` ;
 *   • il exige un mot de passe d'au moins 16 caractères ;
 *   • il ne l'affiche jamais.
 *
 * La première version de cette étape était un `node -e` écrit directement dans
 * le YAML : l'échafaudage de guillemets a échoué au premier passage en CI. Un
 * script versionné est relisible, vérifiable, et échoue avec un message utile.
 *
 * Usage :
 *   GF_BASE_JETABLE=oui GF_MOT_DE_PASSE_APP='…' npx tsx scripts/ci-mot-de-passe-role.ts
 */
import { Client } from "pg";

const LONGUEUR_MINIMALE = 16;

function refuser(raisons: string[]): never {
  console.error("🔴 Refus :");
  for (const r of raisons) console.error(`   · ${r}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const refus: string[] = [];
  const motDePasse = process.env.GF_MOT_DE_PASSE_APP?.trim() ?? "";
  const url = process.env.DATABASE_URL_ADMIN ?? "";

  if (process.env.GF_BASE_JETABLE !== "oui") {
    refus.push(
      "GF_BASE_JETABLE n'est pas « oui » : ce script ne s'exécute que sur une base " +
        "explicitement déclarée jetable. Poser un mot de passe sur une base partagée " +
        "serait une modification d'exploitation déguisée en étape de test.",
    );
  }
  if (process.env.NODE_ENV === "production") {
    refus.push("NODE_ENV=production : jamais sur une base de production.");
  }
  if (!url) {
    refus.push("DATABASE_URL_ADMIN est absent.");
  }
  if (!motDePasse) {
    refus.push("GF_MOT_DE_PASSE_APP est absent.");
  } else if (motDePasse.length < LONGUEUR_MINIMALE) {
    refus.push(
      `GF_MOT_DE_PASSE_APP fait ${motDePasse.length} caractère(s) ; ${LONGUEUR_MINIMALE} au minimum.`,
    );
  }

  if (refus.length > 0) refuser(refus);

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // ⚠️ Mot de passe passé en **paramètre** et non concaténé : `alter role`
    //   n'accepte pas de paramètre lié pour le mot de passe, on passe donc par
    //   `quote_literal` côté serveur. Concaténer la valeur dans la chaîne SQL
    //   exposerait le mot de passe aux journaux de requêtes et aux erreurs.
    await client.query(
      "select set_config('gf.mot_de_passe', $1, false)",
      [motDePasse],
    );
    await client.query(`
      do $$
      begin
        execute format(
          'alter role geoforest_app login password %L',
          current_setting('gf.mot_de_passe')
        );
      end $$;
    `);

    const { rows } = await client.query<{ rolname: string; rolcanlogin: boolean }>(
      "select rolname, rolcanlogin from pg_roles where rolname = 'geoforest_app'",
    );
    const role = rows[0];
    if (!role?.rolcanlogin) {
      console.error("🔴 Le rôle « geoforest_app » n'existe pas ou n'accepte pas de connexion.");
      console.error("   La migration a-t-elle été jouée ? (`npm run db:migrate`)");
      process.exit(1);
    }
    // Le mot de passe n'apparaît nulle part dans la sortie.
    console.log("✅ Rôle « geoforest_app » : connexion autorisée, mot de passe renouvelé (non affiché).");
  } finally {
    await client.end();
  }
}

main().catch((erreur) => {
  console.error("🔴 Échec :", erreur instanceof Error ? erreur.message : erreur);
  process.exit(1);
});
