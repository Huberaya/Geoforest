# Chantier 8 — accueil public, inscription et connexion

29 septembre 2026 — **code préparé et testé localement ; non déployé sur Vercel**.

## Demande

Utiliser le projet Vercel existant `https://geoforest-eabr.vercel.app/` plutôt qu’un aperçu Arena éphémère, avec la possibilité de créer un compte ou de se connecter depuis l’accueil.

## Observation du site en ligne

La page publique consultée affiche un formulaire de parcelle, une carte et un bilan d’audit. Ce n’est pas le frontend de la branche de travail actuelle. La source de déploiement Vercel n’a pas été vérifiée dans la console : ne pas en déduire une branche précise.

L’interface observée présente notamment « Conforme (aucune perte post-2020) ». Ce raccourci peut être compris à tort comme une conformité EUDR globale. Le nouvel accueil utilise une formulation de préparation de diligence et précise qu’il ne s’agit pas d’une certification ou d’un dépôt officiel automatique. Aucune analyse n’a été lancée sur le site distant.

## Changements réalisés

- Nouvel accueil public, responsive, avec boutons **Créer un compte** et **Se connecter**, accessibles sans chargement de Clerk ou de l’API.
- Accès explicite à l’espace existant sous `/espace` ; les URL d’API métier ne changent pas.
- Page `/sign-up` ajoutée avec composant officiel Clerk `SignUp` ; page `/sign-in` avec `SignIn` ; textes et localisation française conservés.
- Pages de compte séparées du pont de session métier : une panne API ne doit pas empêcher d’afficher le formulaire d’identité.
- État de chargement, erreur SDK, bouton Réessayer, navigation inscription/connexion et retour à l’accueil.
- Redirections Clerk imposées vers `/espace`, sans ancien hôte de sandbox codé dans le parcours.
- Callback OIDC réussi vers `/espace`, échec vers `/espace?auth_error=1` ; comportement testé.
- Portail fournisseur toujours indépendant de Clerk ; formulaires de comptes non indexables.
- Aucun import de rôle Clerk, aucune fusion de compte par e-mail, aucun changement aux protections backend/Neon du bloc précédent.

L’accueil repose sur des composants statiques et une illustration SVG schématique, sans parcelle réelle, statistique fictive de conformité ou image distante. Les liens d’authentification de l’accueil désactivent le préchargement automatique.

## Fichiers principaux

- `src/app/page.tsx` : accueil public.
- `src/app/(workspace)/espace/` : application déplacée sans modifier ses contrôles métier ; pont Clerk réservé à cet espace.
- `src/app/(workspace)/layout.tsx` : provider partagé entre les parcours d’identité et l’espace, sans bloquer les formulaires sur l’API.
- `src/app/(workspace)/sign-in/`, `sign-up/` et `src/components/auth/AccountForm.tsx` : formulaires officiels et erreurs.
- `src/app/globals.css`, `src/app/layout.tsx` : styles et métadonnées.
- `backend/app/auth.py`, `backend/tests/test_foundation.py` : nouvelles destinations du callback OIDC et tests.
- `tests/unit/public-account.test.tsx`, `tests/e2e/public-accounts.spec.ts` : nouveaux contrôles.
- Tests navigateur métier existants : URLs d’entrée adaptées de `/` à `/espace` ; ces parcours métier complets n’ont pas tous été relancés dans ce bloc.

## Vérifications exécutées

| Contrôle | Résultat |
|---|---|
| Backend ciblé : fondation, pont Clerk, vérificateur d’identité | **134 réussis**, 1 avertissement, 16,99 s |
| Tests frontend, dont 8 nouveaux sur accueil/comptes | **31 réussis** |
| Navigateur Chromium : accueil, inscription en panne SDK, connexion en panne SDK, portail | **4 réussis**, 35,4 s |
| Responsive | 1440, 768, 390 et 360 px, sans débordement horizontal |
| Builds OIDC et Clerk développement | Réussis |
| TypeScript, ESLint et Ruff | Réussis |
| Audit npm | Aucune vulnérabilité signalée |

Les tests navigateur utilisent une configuration Clerk fictive, bloquent les requêtes externes et testent volontairement l’indisponibilité du fournisseur. Le backend n’était pas démarré lors de cette recette navigateur : l’accueil et les formulaires restent disponibles, et le portail affiche son entrée publique malgré l’API indisponible. Cela ne valide pas une session fournisseur active ou une inscription réelle.

Les tests du serveur utilisent une base PostgreSQL locale `_test` ; aucun accès Neon. Le test positif de callback OIDC simule la réponse déjà vérifiée du client OIDC et vérifie la session créée et sa redirection. La vérification cryptographique du parcours Clerk reste couverte séparément par ses tests existants.

La suite complète historique de 966 tests n’a pas été relancée ici : les 134 tests sont une **recette ciblée**, pas une nouvelle déclaration de validation de tout le backend.

Preuves et captures : `preuves-chantier-8/accueil-vercel/`. Les métadonnées de titre/indexation ont été finalisées après les captures ; les builds finaux et le contrôle TypeScript les incluent.

## Déploiement et suite

**PRÊT POUR REVUE** : accueil et parcours frontend d’identité dans le code, tests locaux, captures desktop/mobile.

**NON PUBLIÉ** : aucun push GitHub, aucun changement Vercel, aucune modification Clerk ni Neon. Aucun compte Clerk créé par les tests.

**À CONFIRMER POUR VERCEL** : dépôt/branche/commit/racine du déploiement existant, droits de publication, emplacement de l’API FastAPI et configuration cohérente des environnements.

**GARDES CONSERVÉES** : mode Clerk développement interdit avec Neon Production ou `APP_ENV=production`. Pas de suppression de ces contrôles pour permettre un déploiement. Une identité Clerk créée ne garantit pas l’accès à une organisation ou à un backend déployé.

[Procédure Vercel et informations requises](../deploiement/vercel-accueil-comptes.md).

Le chantier 8 reste ouvert. Le changement de mode préexistant de `infra/bootstrap-db.sh` reste exclu du commit. Aucun nouvel aperçu temporaire Arena n’est proposé à l’utilisateur comme point d’entrée du produit ; le serveur de recette a été arrêté.
