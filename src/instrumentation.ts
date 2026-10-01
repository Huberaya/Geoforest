/**
 * Contrôle au démarrage — P1-10b.
 *
 * ⚠️ Pourquoi un refus de démarrer, et pas une simple alerte.
 *
 * Une application connectée avec un rôle qui contourne la RLS **fonctionne** :
 * les pages s'affichent, les API répondent 200, les tests passent. Rien ne
 * signale qu'elle lit et écrit dans toutes les organisations. Une alerte dans
 * un journal que personne ne relit ne pèserait pas lourd face à un service qui
 * a l'air sain.
 *
 * Le refus est donc franc : en production, une configuration non conforme
 * empêche le serveur de démarrer. Un incident visible immédiatement, au
 * déploiement, vaut mieux qu'une fuite de données découverte six mois plus
 * tard.
 *
 * Deux contrôles, parce qu'ils ne protègent pas la même chose :
 *   1. l'état du rôle applicatif (`verifierRoleApplication`) ;
 *   2. la séparation des deux connexions (`comparerConnexions`) — le produit
 *      ouvre une seconde connexion, privilégiée, pour l'authentification et le
 *      journal d'audit. Si elle se confond avec la première, les routes métier
 *      perdent le cloisonnement sans que rien ne le signale.
 *
 * Trois issues sont prévues, parce qu'un blocage sans issue est un blocage
 * qu'on contourne en le désactivant :
 *   • corriger `DATABASE_URL` (rôle applicatif) et déclarer
 *     `DATABASE_URL_ADMIN` séparément ;
 *   • `GF_CONTROLE_ROLE=off` pour redémarrer en urgence — l'avertissement est
 *     alors écrit à chaque démarrage, et `/api/health` continue de le signaler ;
 *   • en développement uniquement, le contrôle avertit sans arrêter : le poste
 *     local se connecte en superutilisateur, ce qui est sans conséquence sur
 *     des données de démonstration.
 */
import { comparerConnexions, verifierRoleApplication } from "./db/controle-role";

export async function register(): Promise<void> {
  // `register()` est appelé pour chaque exécution (Node.js et Edge). Le
  // contrôle interroge PostgreSQL avec `pg` : il n'a de sens que côté Node.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.GF_CONTROLE_ROLE === "off") {
    console.warn(
      "⚠️ GF_CONTROLE_ROLE=off : le contrôle du rôle de base est désactivé.\n" +
        "   Le cloisonnement multi-tenant n'est plus vérifié au démarrage. Cette\n" +
        "   variable existe pour redémarrer un service en incident, pas pour\n" +
        "   masquer une configuration non conforme.",
    );
    return;
  }

  const production = process.env.NODE_ENV === "production";
  const constats: string[] = [];
  const lignes: string[] = [];

  // --- 1. état du rôle applicatif ----------------------------------------
  try {
    const etat = await verifierRoleApplication();
    lignes.push(
      `  rôle connecté             : ${etat.role}`,
      `  superutilisateur          : ${etat.superutilisateur ? "OUI" : "non"}`,
      `  attribut BYPASSRLS        : ${etat.contourneRls ? "OUI" : "non"}`,
      `  tables hors cloisonnement : ${etat.tablesSansCloisonnement.length}`,
      `  droits de destruction     : ${etat.droitsDestruction.length}`,
    );
    constats.push(...etat.messages);
  } catch (erreur) {
    const detail = erreur instanceof Error ? erreur.message : String(erreur);
    const message = `le contrôle du rôle de base n'a pas pu être exécuté : ${detail}`;
    constats.push(message);
    lignes.push(`  ${message}`);
  }

  // --- 2. séparation des deux connexions ---------------------------------
  const separation = comparerConnexions();
  lignes.push(
    `  rôle applicatif           : ${separation.roleApplicatif ?? "indéterminé"}`,
    `  rôle d'administration      : ${separation.roleAdministration ?? "indéterminé"}`,
  );
  if (separation.indetermine) {
    constats.push(
      "l'une des deux URL de base est absente ou illisible : la séparation des rôles n'est pas établie.",
    );
  } else if (!separation.adminDeclare) {
    // ⚠️ Ce cas n'est pas une fuite de données, c'est l'inverse : l'authentification
    //   et le journal d'audit s'exécuteraient avec le rôle restreint, qui ne voit
    //   aucune ligne hors contexte d'organisation. La connexion échouerait. Le dire
    //   autrement — « cloisonnement perdu » — serait faux, et un message faux fait
    //   chercher la panne là où elle n'est pas.
    constats.push(
      "DATABASE_URL_ADMIN n'est pas déclaré : l'authentification et le journal d'audit " +
        "s'exécuteraient avec le rôle applicatif, lequel n'atteint aucune ligne hors " +
        "contexte d'organisation. Aucune connexion ne serait possible.",
    );
  } else if (separation.memeRole) {
    constats.push(
      `les connexions applicative et d'administration emploient le même rôle ` +
        `« ${separation.roleApplicatif} » : les routes métier s'exécuteraient avec le ` +
        `rôle d'administration, qui contourne la RLS. Déclarer DATABASE_URL_ADMIN séparément.`,
    );
  }

  // --- verdict ------------------------------------------------------------
  if (constats.length === 0) {
    console.log("✅ Rôle de base conforme : la RLS s'applique aux requêtes du produit.");
    for (const ligne of lignes) console.log(ligne);
    return;
  }

  const rapport = [
    "🔴 Le rôle de base n'est pas conforme : le cloisonnement multi-tenant n'est pas garanti.",
    ...lignes,
    "",
  ];
  for (const constat of constats) rapport.push(`  🔴 ${constat}`);
  rapport.push(
    "",
    "   Corriger DATABASE_URL (rôle applicatif, sans BYPASSRLS) et déclarer",
    "   DATABASE_URL_ADMIN (rôle d'administration) séparément.",
    "   docs/DEPLOYMENT_VERCEL.md, section « Rôle applicatif ».",
  );

  const texte = rapport.join("\n");
  if (production) throw new Error(texte);

  console.warn(`${texte}\n   Développement local : le démarrage n'est pas interrompu.`);
}
