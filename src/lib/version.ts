/**
 * Version de l'application, exposée par `/api/health`.
 *
 * ⚠️ Pourquoi une constante versionnée, et non une lecture de `package.json`.
 *
 *   La sonde renvoyait « inconnue » en production. Cause : elle lisait
 *   `process.env.npm_package_version`, qui n'est posé que par `npm run …` — et
 *   un serveur démarré par `next start` n'a pas cet environnement. Un incident
 *   devenait donc impossible à rattacher au déploiement qui l'a produit.
 *
 *   La première correction tentée était une variable `env` de `next.config.ts`.
 *   Elle n'a **rien fait** : le build a conservé l'ancienne expression, et le
 *   contrôle n'a pas bronché — vérifié en inspectant le bundle compilé, le
 *   `GF_VERSION` n'y figurait pas. C'est exactement le type de correction
 *   « plausibles mais inopérante » que cet audit reproche au produit.
 *
 *   D'où cette forme, volontairement la plus simple : une constante écrite ici,
 *   comparée à `package.json` par `scripts/check-version.ts` en CI. Deux
 *   valeurs qui doivent coïncider, une seule qui décide, et un contrôle qui
 *   échoue si elles divergent. La CI teste le **comportement** (la sonde renvoie
 *   cette valeur), la revue teste le reste.
 */
export const VERSION_APPLICATION = "0.1.0";
