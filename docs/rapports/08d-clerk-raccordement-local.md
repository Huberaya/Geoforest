# Chantier 8 — Clerk raccordé à l’application en développement local

29 septembre 2026 · suite de l’incrément 08c · **recette automatisée réussie, connexion humaine à valider**.

> Suite : [accueil public et comptes pour Vercel](08e-accueil-public-comptes-vercel.md). L’espace applicatif y est déplacé sous `/espace` ; les adresses Arena de recette sont temporaires et ne sont plus le point d’entrée souhaité.

## Résultat livré

Le parcours Clerk est maintenant raccordé au frontend et à FastAPI, derrière un mode explicite `AUTH_PROVIDER=clerk_development`. Le mode OIDC reste celui par défaut. Un aperçu temporaire a été préparé avec l’instance Clerk développement fournie et **une base locale distincte de Neon Production**.

- Écran de connexion Clerk en français.
- Échange de preuve Clerk validée contre un cookie applicatif court, HttpOnly et CSRF conservé lors des renouvellements.
- Renouvellement toutes les vingt secondes et au retour d’un onglet visible.
- Déconnexion locale puis Clerk, attente d’un renouvellement en cours et gestion des échecs.
- Liaison des utilisateurs par `(issuer, subject)`, sans fusion par e-mail et sans import de rôles ou organisations Clerk.
- Portail fournisseur `/portail` séparé du provider et du pont Clerk : il reste accessible par ses liens sécurisés, même si Clerk est indisponible.
- Ancien parcours OIDC conservé, mais callback OIDC refusé lorsque le mode Clerk est sélectionné. Les API refusent les cookies issus de l’autre parcours.

**Aucune migration SQL supplémentaire, aucun accès à Neon, aucun compte Clerk créé par les tests, aucun changement de configuration Clerk et aucun service payant souscrit.** Les deux appels de qualification réels du nouveau transport HTTP sont des lectures de JWKS, pas des lectures de profils utilisateur.

## Sécurité et limites explicites

Le backend refuse le mode Clerk développement en production ou avec une base distante. La cible doit être sur `127.0.0.1`/`localhost`, suffixée `_test`, sans paramètres de connexion permettant de substituer la cible. Cela empêche d’utiliser par inadvertance l’URL Neon existante dans ce parcours de recette.

Les sessions applicatives expirent au plus tôt entre la date d’expiration de la preuve et **60 secondes après le contrôle**. Une révocation Clerk n’est donc pas instantanément répercutée dans un cookie déjà accordé : délai résiduel maximum de 60 secondes, vérification en ligne à chaque renouvellement. Aucun webhook de révocation n’est installé.

Origin est obligatoire et exact pour l’échange et la déconnexion. Les API métier gardent leur CSRF et leurs permissions en base. Un utilisateur connecté ne reçoit aucune appartenance automatiquement ; la création éventuelle d’une organisation reste une action métier explicite.

Les contrôles cryptographiques et de profil du bloc 08c sont conservés. Ajouts : cache JWKS limité à 60 secondes, rotation testée, quatre vérifications simultanées par instance de vérificateur, budget réseau de dix secondes et plafond de 30 échanges/minute/pair. Ces limites ne sont pas une qualification de charge production. Un changement de clé peut nécessiter d’attendre la fin du cache ; aucun renouvellement forcé illimité sur `kid` inconnu.

Le MFA Clerk n’est **pas** assimilé à un ACR OIDC. Le développement exige `ADMIN_ACR` vide et est interdit en production. Une politique MFA Clerk et sa recette restent nécessaires avant un futur lancement public.

La clé secrète n’est injectée que dans FastAPI. Le lanceur la retire de l’environnement Next ; un contrôle de l’ensemble de l’artefact `.next` a confirmé son absence. Les identifiants ne sont pas ajoutés au dépôt.

## Choix frontend

Le SDK officiel `@clerk/nextjs` est utilisé pour ses composants et hooks navigateur, pas comme autorité d’accès aux données côté Next. FastAPI vérifie les preuves et PostgreSQL applique les permissions/RLS. Le frontend ne rend aucune donnée métier côté serveur.

Une première expérimentation du middleware Next Clerk standard entraînait un handshake distant avant le rendu de la page. Elle a été retirée : pas de middleware d’authentification Next, pas de `auth()` Next ni de provider SSR dynamique dans la solution retenue. Ainsi, l’indisponibilité du SDK client peut être présentée avec une page de secours maîtrisée, et le portail fournisseur n’en dépend pas.

Les tests navigateur finaux utilisent une instance fictive et bloquent les requêtes externes du navigateur. Ils ne prétendent pas valider la connexion réelle, OAuth, le MFA ou les paramètres particuliers de votre instance Clerk.

## Fichiers principaux

- `backend/app/clerk_routes.py` : échange et fermeture de session.
- `backend/app/clerk_identity.py` : protections de réseau, cache et concurrence ajoutées.
- `backend/app/{config,auth,security,middleware,main}.py` : sélection du parcours, garde-fous et raccordement.
- `backend/tests/test_clerk_bridge.py`, `backend/identity_tests/test_clerk_identity.py` : tests HTTP/DB et cryptographiques.
- `src/app/(workspace)/{layout,page}.tsx`, `src/app/(workspace)/sign-in/[[...sign-in]]/page.tsx` : groupe entreprise et connexion ; les URLs ne changent pas.
- `src/components/auth/`, `src/auth-provider.ts` : pont de session et configuration frontend.
- `next.config.ts`, `.env.example`, dépendances/lockfile et CI : CSP ciblée, variables documentées, SDK et tests frontend.
- `tests/unit/`, `tests/e2e/clerk-development.spec.ts` : tests frontend et navigateur.

## Résultats de recette

| Contrôle | Résultat |
|---|---|
| Suite backend complète, base locale | **966 réussis**, 13 avertissements, 487,36 s |
| Dont tests historiques | 863 |
| Dont vérificateur Clerk isolé | 67 |
| Dont pont HTTP/DB Clerk | 36 |
| Tests frontend simulant SDK/HTTP et configuration | **23 réussis** |
| Navigateur : page publique OIDC responsive | **1 réussi** |
| Navigateur : panne SDK et indépendance du portail | **2 réussis** |
| Largeurs contrôlées sur la page de secours | 1440, 768, 390 et 360 px |
| TypeScript / ESLint / Ruff | Réussis |
| Builds frontend OIDC et Clerk développement | Réussis |
| Audit npm | Zéro vulnérabilité signalée |
| Transport réel HTTPX : JWKS public et Backend API | GET authentifié réussi, clés correspondantes |
| Aperçu : page connexion, redirection, refus anonyme, logout et preuve absente | Réussis |
| Connexion humaine réelle Clerk / E2E OAuth / MFA | **Non exécutés** |

La recette backend de ce bloc utilise **PostgreSQL 17.11 / PostGIS 3.5.2**, installés localement. Elle ne remplace pas ni ne réécrit les preuves précédentes sur PostgreSQL 18.6 / PostGIS 3.6.4 et la restauration Neon. Aucune fixture n’a été exécutée contre Neon.

Les 13 avertissements backend sont ceux des bibliothèques Starlette/TestClient et Rasterio déjà rencontrés. Les tests frontend emploient des mocks et des données fictives ; les tests navigateur de panne ne sont pas une preuve de connexion réelle réussie. Les chemins positifs du pont sont couverts séparément par les tests HTTP/DB et les tests frontend simulés.

Preuves : `preuves-chantier-8/clerk-raccordement/`. Les journaux ne contiennent pas de secret Clerk. Les contrôles CI ont été exécutés localement ; aucune exécution GitHub Actions distante n’est revendiquée.

## Aperçu et prochaine action

L’aperçu utilise `geoforest_clerk_test` en local, pas `neondb`. Il est temporaire ; cette base ne doit pas servir à conserver des données métier réelles. Les modules forêt/documents/diligence restent désactivés dans ce profil de recette.

**Prochaine action : l’utilisateur ouvre l’aperçu dans un nouvel onglet et se connecte avec son compte Clerk développement existant.** Aucun mot de passe ou code de connexion ne doit être partagé avec l’assistant. Vérifier ensuite l’identité affichée, les renouvellements et la déconnexion ; ne créer que des données fictives de recette.

La première connexion autorisée par l’utilisateur liera son identité à un utilisateur GeoForest **dans la base locale**. Elle ne crée pas automatiquement de compte Clerk ou d’appartenance à une organisation.

[Configuration et procédure de recette humaine](../deploiement/clerk-developpement.md).

## Bilan de lancement

- **PRÊT POUR RECETTE HUMAINE LOCALE** : raccordement développement et contrôles automatisés.
- **À FINALISER** : connexion réelle de l’utilisateur, qualification OAuth/MFA, récupération de compte et tests transversaux dans cette configuration.
- **NON AUTORISÉ PAR CE BLOC** : utilisation de Clerk développement avec Neon Production, déploiement public ou activation de services payants.
- **CHANTIER 8 TOUJOURS OUVERT** : hébergement/coffre, sauvegardes récurrentes, supervision, résilience, qualification de charge et gates réglementaires inchangés.

Les changements sont enregistrés localement, sans push GitHub. Le changement de mode préexistant de `infra/bootstrap-db.sh` reste exclu du commit.
