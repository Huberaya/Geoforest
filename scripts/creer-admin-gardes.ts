/**
 * Garde-fous pour la création d'un compte administrateur initial en production.
 *
 * Module pur (sans accès base) : importé par `scripts/creer-admin.ts` et par
 * les tests unitaires.
 *
 * Principes :
 *  - aucun mot de passe par défaut, jamais passé en argument CLI ;
 *  - politique de mot de passe identique à l'application (`checkPasswordPolicy`) ;
 *  - refus explicite du mot de passe historique publié dans le dépôt ;
 *  - exige `DATABASE_URL_ADMIN` explicite (aucun repli silencieux) ;
 *  - format d'organisation, de pays ISO-2 et d'adresse e-mail validés avant toute
 *    connexion réseau.
 */
import { checkPasswordPolicy } from "../src/lib/auth/password";
import { MOT_DE_PASSE_PUBLIE } from "./seed-gardes";

export interface EnvironnementCreationAdmin {
  DATABASE_URL_ADMIN?: string;
  ADMIN_ORG_NAME?: string;
  ADMIN_ORG_SLUG?: string;
  ADMIN_ORG_COUNTRY?: string;
  ADMIN_EMAIL?: string;
  ADMIN_NAME?: string;
  ADMIN_PASSWORD?: string;
}

export interface ParametresAdminValides {
  databaseUrlAdmin: string;
  orgName: string;
  orgSlug: string;
  orgCountry: string;
  email: string;
  name: string;
  password: string;
}

export type DecisionCreationAdmin =
  | { autorise: true; parametres: ParametresAdminValides }
  | { autorise: false; refus: string[] };

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const PAYS_ISO2_RE = /^[A-Z]{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function estUrlPostgresValide(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function validerCreationAdmin(env: EnvironnementCreationAdmin): DecisionCreationAdmin {
  const refus: string[] = [];

  const databaseUrlAdmin = env.DATABASE_URL_ADMIN?.trim() ?? "";
  if (!databaseUrlAdmin) {
    refus.push("DATABASE_URL_ADMIN est requis (URL du rôle propriétaire neondb_owner).");
  } else if (!estUrlPostgresValide(databaseUrlAdmin)) {
    refus.push("DATABASE_URL_ADMIN n'est pas une URL PostgreSQL valide.");
  }

  const orgName = env.ADMIN_ORG_NAME?.trim() ?? "";
  if (orgName.length < 2 || orgName.length > 160) {
    refus.push("ADMIN_ORG_NAME est requis (2 à 160 caractères).");
  }

  const orgSlug = (env.ADMIN_ORG_SLUG?.trim() ?? "").toLowerCase();
  if (!SLUG_RE.test(orgSlug)) {
    refus.push(
      "ADMIN_ORG_SLUG est requis (3 à 63 caractères : minuscules, chiffres et tirets, ex. geoforest-prod).",
    );
  }

  const orgCountry = (env.ADMIN_ORG_COUNTRY?.trim() || "FR").toUpperCase();
  if (!PAYS_ISO2_RE.test(orgCountry)) {
    refus.push("ADMIN_ORG_COUNTRY doit être un code pays ISO-2 sur 2 lettres (ex. FR).");
  }

  const email = (env.ADMIN_EMAIL?.trim() ?? "").toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    refus.push("ADMIN_EMAIL doit être une adresse e-mail valide.");
  }

  const name = env.ADMIN_NAME?.trim() ?? "";
  if (name.length < 2 || name.length > 120) {
    refus.push("ADMIN_NAME est requis (2 à 120 caractères).");
  }

  const password = env.ADMIN_PASSWORD ?? "";
  if (!password) {
    refus.push("ADMIN_PASSWORD est requis (jamais passé en argument de ligne de commande).");
  } else {
    if (password.trim() === MOT_DE_PASSE_PUBLIE) {
      refus.push("ADMIN_PASSWORD correspond au mot de passe historique publié dans le dépôt : refusé.");
    }
    const policy = checkPasswordPolicy(password, email);
    if (!policy.ok) {
      refus.push(`ADMIN_PASSWORD ne respecte pas la politique de sécurité : ${policy.reasons.join(" ; ")}.`);
    }
  }

  if (refus.length > 0) {
    return { autorise: false, refus };
  }

  return {
    autorise: true,
    parametres: {
      databaseUrlAdmin,
      orgName,
      orgSlug,
      orgCountry,
      email,
      name,
      password,
    },
  };
}
