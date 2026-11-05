/**
 * Contrôle probatoire de la rotation des secrets (C2, critères 6 et 7).
 *
 * ⚠️ À quoi ce contrôle sert — et à quoi il ne sert PAS.
 *
 *   La rotation d'`AUTH_SECRET` et du mot de passe `geoforest_app` exige un
 *   accès Vercel et Neon qui n'existe pas dans cet environnement. Ces deux
 *   critères resteront donc « en attente de l'exploitant ».
 *
 *   Mais on peut prouver AVANT la rotation qu'elle aura l'effet attendu, et
 *   qu'aucun autre dispositif ne la rendra inopérante. C'est ce que fait ce
 *   fichier : il vérifie que la rotation invalide réellement les jetons
 *   existants, que la garde refuse une valeur faible, et que la procédure
 *   écrite est exécutable telle qu'elle est rédigée.
 *
 *   Il ne remplace pas la rotation. Il empêche de la découvrir inopérante le
 *   jour où on la fait.
 *
 * ⚠️ Aucun secret réel n'est lu, écrit ni généré ici. Les valeurs de test sont
 *   construites en mémoire, à partir d'aléa, et ne quittent pas le processus.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { signAccessToken, verifyAccessToken } from "../src/lib/auth/tokens";

const controles: Array<{ nom: string; ok: boolean; detail?: string }> = [];
const verifier = (nom: string, ok: boolean, detail?: string): void => {
  controles.push({ nom, ok, detail });
};

const DEV_PLACEHOLDER = "dev-only-insecure-secret-change-me";

function nouveauSecret(): string {
  return randomBytes(48).toString("base64url");
}

function avecSecret<T>(secret: string, fn: () => Promise<T>): Promise<T> {
  const precedent = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = secret;
  return fn().finally(() => {
    if (precedent === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = precedent;
  });
}

const claims = {
  sub: "11111111-1111-4111-8111-111111111111",
  org: "22222222-2222-4222-8222-222222222222",
  email: "test@exemple.fr",
  name: "Test Rotation",
  role: "ADMIN",
  ver: 1,
  mfa: true,
};

async function main(): Promise<void> {
  /* --- Ce que la rotation doit produire ---------------------------------- */

  // ⚠️ C'est la propriété centrale : un jeton signé avec l'ancien secret doit
  //   être rejeté après la rotation. Sans cela, la rotation ne protege rien —
  //   elle change une variable sans fermer les sessions ouvertes.
  const ancien = nouveauSecret();
  const nouveau = nouveauSecret();

  const jetonAncien = await avecSecret(ancien, () => signAccessToken(claims, 3600));

  const reluAvant = await avecSecret(ancien, () => verifyAccessToken(jetonAncien));
  verifier(
    "un jeton est valide avec le secret qui l'a signé",
    reluAvant !== null && reluAvant.sub === claims.sub,
    "le jeton n'est pas relu : le test ne prouverait rien de la rotation",
  );

  const reluApres = await avecSecret(nouveau, () => verifyAccessToken(jetonAncien));
  verifier(
    "un jeton signé avec l'ancien secret est REJETÉ après rotation",
    reluApres === null,
    "le jeton reste valide après changement du secret : la rotation serait inopérante",
  );

  const jetonNouveau = await avecSecret(nouveau, () => signAccessToken(claims, 3600));
  const reluNouveau = await avecSecret(nouveau, () => verifyAccessToken(jetonNouveau));
  verifier(
    "un jeton signé avec le nouveau secret est accepté",
    reluNouveau !== null && reluNouveau.sub === claims.sub,
  );

  /* --- Ce que la garde doit refuser --------------------------------------- */

  // ⚠️ Le secret trop court n'est refusé qu'en production ; la garde retombe
  //   sur la valeur de développement en développement. On éprouve donc les
  //   deux branches plutôt que d'en supposer une.
  const env = await import("../src/lib/auth/env");

  const tropCourtEnProd = await (async () => {
    const envPrecedent = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: "production", AUTH_SECRET: "court" });
    env.__resetPourTest();
    try {
      env.readSecret();
      return null;
    } catch (err) {
      return (err as Error).message;
    } finally {
      Object.assign(process.env, { NODE_ENV: envPrecedent });
      env.__resetPourTest();
    }
  })();
  verifier(
    "un secret trop court est refusé en production",
    typeof tropCourtEnProd === "string" && /32/.test(tropCourtEnProd),
    "la garde accepterait un secret de moins de 32 caractères en production",
  );

  // ⚠️ La valeur de développement ne doit pas être acceptée en production.
  //   On l'éprouve en simulant NODE_ENV, sans jamais écrire de secret réel.
  const refusDev = await (async () => {
    const envPrecedent = process.env.NODE_ENV;
    const secretPrecedent = process.env.AUTH_SECRET;
    Object.assign(process.env, { NODE_ENV: "production", AUTH_SECRET: DEV_PLACEHOLDER });
    try {
      const moduleEnv = await import("../src/lib/auth/env");
      moduleEnv.__resetPourTest?.();
      moduleEnv.readSecret();
      return null;
    } catch (err) {
      return (err as Error).message;
    } finally {
      Object.assign(process.env, { NODE_ENV: envPrecedent });
      if (secretPrecedent === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = secretPrecedent;
    }
  })();
  verifier(
    "la valeur de développement est refusée en production",
    typeof refusDev === "string",
    "la garde accepterait un secret connu de tous en production",
  );

  /* --- La procédure écrite est exécutable --------------------------------- */

  const doc = readFileSync(join("docs", "ROTATION_SECRETS.md"), "utf-8");

  // ⚠️ Chaque commande citée doit exister réellement dans le dépôt, sinon la
  //   procédure envoie l'exploitant vers un fichier absent — ce qui est déjà
  //   arrivé avec ce document.
  for (const [commande, fichier] of [
    ["scripts/verifier-role.ts", "scripts/verifier-role.ts"],
    ["/api/health", "src/app/api/health/route.ts"],
  ] as const) {
    verifier(
      `la procédure cite « ${commande} », qui existe`,
      doc.includes(commande) && readFileSync(join(fichier), "utf-8").length > 0,
      `« ${commande} » est cité mais introuvable`,
    );
  }

  // ⚠️ Le document renvoyait vers un rapport d'audit supprimé. Une référence
  //   morte n'est pas une référence.
  //
  //   Mais interdire la mention serait trop grossier : signaler qu'une pièce a
  //   disparu est précisément ce qui évite qu'on la cherche. On exige donc que
  //   toute occurrence soit accompagnée, dans le même paragraphe, de la
  //   mention de son absence.
  const lignesRefMorte = doc
    .split(/\n\s*\n/)
    .filter((paragraphe) => /AUDIT-GEOFOREST-2026-11-04\.md/.test(paragraphe))
    .filter((paragraphe) => !/(n'existe pas|inexistant|supprimé|depuis supprimé)/i.test(paragraphe));
  verifier(
    "la procédure ne renvoie pas vers un document inexistant",
    lignesRefMorte.length === 0,
    "AUDIT-GEOFOREST-2026-11-04.md est cité comme s'il existait encore",
  );

  // ⚠️ C2 doit rester NON clos tant que la rotation n'est pas faite : un
  //   chantier de sécurité qui se déclare terminé sans rotation est
  //   exactement la fausse assurance que l'audit reproche au produit.
  verifier(
    "le critère de clôture reste ouvert tant que la rotation n'est pas faite",
    /⛔/.test(doc) && /en attente de l'exploitant/.test(doc),
    "la procédure ne signale plus les critères en attente",
  );

  /* --- Inventaire : tout secret est-il couvert par la procédure ? --------- */

  // ⚠️ Deux secrets ont été ajoutés DEPUIS C2 : GF_STORAGE_SIGNING_SECRET
  //   (signature des URLs de pièces justificatives) et BACKEND_API_TOKEN
  //   (C5). Une procédure de rotation qui les ignore devient fausse.
  for (const secret of ["AUTH_SECRET", "GF_METRICS_TOKEN", "GF_STORAGE_SIGNING_SECRET", "BACKEND_API_TOKEN"]) {
    verifier(
      `${secret} figure dans la procédure de rotation`,
      doc.includes(secret),
      `${secret} n'est pas couvert : une rotation partielle laisserait un secret d'origine`,
    );
  }

  /* ------------------------------- Rapport -------------------------------- */

  const echecs = controles.filter((c) => !c.ok);
  for (const c of controles) {
    if (!c.ok) console.log(`🔴 ${c.nom}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log(`\n${controles.length - echecs.length}/${controles.length} contrôle(s) réussi(s)`);
  process.exit(echecs.length === 0 ? 0 : 1);
}

void main();
