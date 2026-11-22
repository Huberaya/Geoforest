/**
 * Garde locale de détection de secrets dans les fichiers suivis par Git (B2).
 *
 * Complète `.github/workflows/secret-scan.yml` (Gitleaks) par un contrôle
 * rapide, exécutable sans binaire externe, sans jamais afficher la valeur
 * d'un secret détecté (seuls fichier, ligne et règle sont rapportés).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface RegleSecret {
  id: string;
  description: string;
  motif: RegExp;
  /** Chemins où les exemples documentaires ou tests jetables sont tolérés. */
  exclureChemins?: RegExp[];
  /** Motifs de placeholders explicitement non-secrets. */
  exclureLignes?: RegExp[];
}

export interface AlerteSecret {
  fichier: string;
  ligne: number;
  regle: string;
  description: string;
}

const PLACEHOLDERS_EXPLICITES =
  /<[^>]+>|MOT_DE_PASSE|NOUVEAU_MDP|ANCIEN_MDP|REMPLACER|VOTRE_|…en clair…|\.\.\.|\*\*\*/;

export const REGLES_SECRETS: readonly RegleSecret[] = [
  {
    id: "github-pat",
    description: "Jeton personnel GitHub (ghp_ / github_pat_)",
    motif: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  {
    id: "aws-access-key",
    description: "Clé d'accès AWS (AKIA...)",
    motif: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: "neon-api-key",
    description: "Clé API Neon (napi_...)",
    motif: /\bnapi_[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: "vercel-token",
    description: "Jeton Vercel (vcp_...)",
    motif: /\bvcp_[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: "private-key-block",
    description: "Bloc de clé privée PEM",
    motif: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: "postgres-url-with-password",
    description: "URL PostgreSQL non locale contenant un mot de passe en clair",
    motif:
      /postgres(?:ql)?:\/\/[^:\s"'`$]+:[^@\s"'`$]{4,}@(?!127\.0\.0\.1\b|localhost\b|db\b|host\b|hote\b|hôte\b|serveur\b|example\.|exemple\.)[A-Za-z0-9.-]+/i,
    exclureLignes: [PLACEHOLDERS_EXPLICITES],
  },
  {
    id: "sql-role-password-literal",
    description: "Mot de passe littéral dans CREATE/ALTER ROLE ou USER",
    motif: /\b(?:CREATE|ALTER)\s+(?:ROLE|USER)\s+[A-Za-z_][A-Za-z0-9_]*[^\n;]{0,80}\bPASSWORD\s+'[^'\n]{4,}'/i,
    exclureChemins: [/^docs\//, /^README\.md$/, /^scripts\/recette\//],
    exclureLignes: [PLACEHOLDERS_EXPLICITES],
  },
];

export function analyserContenuPourSecrets(
  fichier: string,
  contenu: string,
): AlerteSecret[] {
  const alertes: AlerteSecret[] = [];
  const lignes = contenu.split(/\r?\n/);

  for (const regle of REGLES_SECRETS) {
    if (regle.exclureChemins?.some((re) => re.test(fichier))) continue;

    for (let i = 0; i < lignes.length; i += 1) {
      const texte = lignes[i];
      if (!regle.motif.test(texte)) continue;
      if (regle.exclureLignes?.some((re) => re.test(texte))) continue;
      alertes.push({
        fichier,
        ligne: i + 1,
        regle: regle.id,
        description: regle.description,
      });
    }
  }

  return alertes;
}

export function scannerDepotSuivi(): AlerteSecret[] {
  const fichiers = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);

  const toutes: AlerteSecret[] = [];
  for (const fichier of fichiers) {
    let contenu: string;
    try {
      contenu = readFileSync(fichier, "utf8");
    } catch {
      continue;
    }
    if (contenu.includes("\0")) continue;
    toutes.push(...analyserContenuPourSecrets(fichier, contenu));
  }
  return toutes;
}

const estEntreePrincipale =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (estEntreePrincipale) {
  const alertes = scannerDepotSuivi();
  if (alertes.length > 0) {
    console.error(`🔴 ${alertes.length} secret(s) potentiel(s) détecté(s) (valeurs masquées) :`);
    for (const a of alertes) {
      console.error(`   · ${a.fichier}:${a.ligne} [${a.regle}] ${a.description}`);
    }
    process.exit(1);
  }
  console.log("✅ Aucun secret détecté dans les fichiers suivis par Git.");
}
