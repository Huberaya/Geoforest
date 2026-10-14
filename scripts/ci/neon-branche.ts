/**
 * Branche Neon éphémère pour la CI (chantier 2 : contrôles HTTP et base).
 *
 * Usage (dans le job CI uniquement) :
 *   tsx scripts/ci/neon-branche.ts creer       # crée la branche, exporte les variables
 *   tsx scripts/ci/neon-branche.ts role-app    # fixe le mot de passe du rôle applicatif
 *   tsx scripts/ci/neon-branche.ts supprimer   # supprime la branche (toujours, en fin de job)
 *
 * Entrées (secrets GitHub, jamais affichés) :
 *   NEON_API_KEY, NEON_PROJECT_ID, NEON_PARENT_BRANCH_ID
 *   NEON_DATABASE_NAME (défaut « neondb »), NEON_ADMIN_ROLE (défaut « neondb_owner »)
 *   NEON_API_URL (défaut « https://console.neon.tech/api/v2 » ; surchargeable pour les tests)
 *
 * Garanties :
 *   · la branche est créée à partir d'une branche parente désignée, jamais écrite sur elle ;
 *   · le mot de passe du rôle applicatif est tiré au hasard et n'existe que sur la branche ;
 *   · `GF_BASE_JETABLE=oui` autorise les seules opérations destructrices (seed --reset) ;
 *   · sans secret, le script échoue : aucune exécution silencieuse sans base.
 *
 * Les valeurs sont écrites dans `$GITHUB_ENV` (masquées avant), jamais dans les journaux.
 */
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Client } from "pg";

const API = (process.env.NEON_API_URL ?? "https://console.neon.tech/api/v2").replace(/\/$/, "");
const BASE_DONNEES = process.env.NEON_DATABASE_NAME ?? "neondb";
const ROLE_ADMIN = process.env.NEON_ADMIN_ROLE ?? "neondb_owner";
const ROLE_APP = "geoforest_app";
const NOM_BRANCHE_PREFIXE = "ci-geoforest";

function exiger(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) {
    throw new Error(`${nom} est absent. Configurer le secret GitHub correspondant (aucune base n'est choisie par défaut).`);
  }
  return valeur;
}

/** Exporte une variable pour les étapes suivantes du job, en la masquant d'abord. */
function exporter(nom: string, valeur: string, masquer = true): void {
  if (masquer) console.log(`::add-mask::${valeur}`);
  const fichier = process.env.GITHUB_ENV;
  if (!fichier) throw new Error("GITHUB_ENV absent : ce script s'exécute dans un job GitHub Actions.");
  const delimiteur = `EOF_${randomBytes(8).toString("hex")}`;
  appendFileSync(fichier, `${nom}<<${delimiteur}\n${valeur}\n${delimiteur}\n`);
}

async function api(methode: string, chemin: string, corps?: unknown): Promise<{ status: number; json: any }> {
  const cle = exiger("NEON_API_KEY");
  // Neon signale les conflits transitoires par 423 et 503 : seule une nouvelle tentative est sûre.
  for (let essai = 1; essai <= 6; essai += 1) {
    const res = await fetch(`${API}${chemin}`, {
      method: methode,
      headers: {
        authorization: `Bearer ${cle}`,
        accept: "application/json",
        ...(corps !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
    if ((res.status === 423 || res.status === 503 || res.status === 429) && essai < 6) {
      await new Promise((r) => setTimeout(r, 2000 * essai));
      continue;
    }
    const texte = await res.text();
    let json: any = null;
    try {
      json = texte ? JSON.parse(texte) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }
  throw new Error("api Neon : nombre d'essais épuisé");
}

async function creer(): Promise<void> {
  const projet = exiger("NEON_PROJECT_ID");
  const parente = exiger("NEON_PARENT_BRANCH_ID");
  const nom = `${NOM_BRANCHE_PREFIXE}-${process.env.GITHUB_RUN_ID ?? "local"}-${process.env.GITHUB_RUN_ATTEMPT ?? "0"}-${Date.now().toString(36)}`;

  const creation = await api("POST", `/projects/${projet}/branches`, {
    branch: { name: nom, parent_id: parente, protected: false },
    endpoints: [{ type: "read_write" }],
  });
  if (creation.status >= 300 || !creation.json?.branch?.id) {
    throw new Error(`création de branche refusée (HTTP ${creation.status})`);
  }
  const brancheId: string = creation.json.branch.id;

  const uri = await api(
    "GET",
    `/projects/${projet}/connection_uri?branch_id=${encodeURIComponent(brancheId)}` +
      `&database_name=${encodeURIComponent(BASE_DONNEES)}&role_name=${encodeURIComponent(ROLE_ADMIN)}`,
  );
  const adminUri: string | undefined = uri.json?.uri;
  if (uri.status !== 200 || !adminUri) throw new Error(`URI de connexion indisponible (HTTP ${uri.status})`);

  // Même hôte et même base, rôle applicatif : seul le mot de passe change (fixé par `role-app`).
  exporter("NEON_BRANCH_ID", brancheId, false);
  exporter("DATABASE_URL_ADMIN", adminUri);
  exporter("GF_BASE_JETABLE", "oui", false);

  // Secrets de test, tirés au hasard pour ce run seulement. Le mot de passe des comptes de
  // démonstration sert aussi aux contrôles E2E : une seule valeur, gardée en mémoire ici.
  const motDePasseDemo = randomBytes(24).toString("base64url");
  exporter("AUTH_SECRET", randomBytes(48).toString("base64url"));
  exporter("GF_STORAGE_SIGNING_SECRET", randomBytes(48).toString("base64url"));
  exporter("SEED_DEMO_PASSWORD", motDePasseDemo);
  exporter("E2E_PASSWORD", motDePasseDemo);
  console.log(`branche de test créée : ${nom}`);
}

async function roleApp(): Promise<void> {
  const adminUri = exiger("DATABASE_URL_ADMIN");
  const motDePasse = randomBytes(24).toString("base64url");
  // Alphabet base64url uniquement : aucune quote ni caractère spécial dans le littéral SQL.
  if (!/^[A-Za-z0-9_-]+$/.test(motDePasse)) throw new Error("mot de passe généré invalide");

  const client = new Client({ connectionString: adminUri });
  await client.connect();
  try {
    await client.query(`alter role ${ROLE_APP} login password '${motDePasse}'`);
  } finally {
    await client.end();
  }

  const url = new URL(adminUri);
  url.username = ROLE_APP;
  url.password = motDePasse;
  exporter("DATABASE_URL", url.toString());
  console.log(`rôle ${ROLE_APP} activé sur la branche de test`);
}

async function supprimer(): Promise<void> {
  const projet = exiger("NEON_PROJECT_ID");
  const branche = process.env.NEON_BRANCH_ID;
  if (!branche) {
    console.log("aucune branche à supprimer (la création a échoué avant).");
    return;
  }
  // Garde-fou : seule une branche créée par ce script peut être supprimée.
  if (!branche.startsWith("br-")) throw new Error("identifiant de branche inattendu : suppression refusée");
  const res = await api("DELETE", `/projects/${projet}/branches/${encodeURIComponent(branche)}`);
  if (res.status !== 200 && res.status !== 204 && res.status !== 404) {
    throw new Error(`suppression de la branche refusée (HTTP ${res.status})`);
  }
  console.log("branche de test supprimée");
}

async function main(): Promise<void> {
  const commande = process.argv[2];
  if (commande === "creer") await creer();
  else if (commande === "role-app") await roleApp();
  else if (commande === "supprimer") await supprimer();
  else throw new Error("usage : neon-branche.ts creer | role-app | supprimer");
}

main().catch((e) => {
  console.error(`ERREUR neon-branche : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
