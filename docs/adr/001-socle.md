# ADR 001 — Socle du chantier 1

Statut : implémentation autorisée par le propriétaire ; mise en production soumise à recette.

## Objectif et périmètre
Une seule API métier FastAPI, PostgreSQL 17/PostGIS, migrations Alembic explicites. Next.js est une interface et un proxy same-origin, sans logique réglementaire. OIDC Authorization Code + PKCE via Authlib ; Keycloak local pour la recette, fournisseur de production configurable. Sessions opaques révocables en base, jetons OIDC non conservés. Pas de mot de passe géré par GeoForest.

Les anciens moteurs et tests sont archivés dans archive/prototype, hors compilation, images et exécution. Leurs résultats ne sont pas migrés ni requalifiés. Les routes historiques répondent 410 : aucune simulation ou déclaration officielle possible. Les données de production éventuelles restent à inventorier.

## Analyse des risques
Isolation multi-tenant : RLS, permissions serveur, contexte transactionnel et tests SQL avec rôle non propriétaire. Les utilisateurs peuvent appartenir à plusieurs organisations. Supplier est limité à un identifiant de périmètre, sans accès aux réglages/membres/journal entreprise ; le portail lui-même reste chantier 2.

L'administration de membres cible seulement des comptes OIDC déjà enregistrés et vérifiés ; invitation par email différée au chantier 2. Le fournisseur OIDC de production, l'hébergement, l'exigence MFA (ACR) et les secrets restent décisions externes. Aucun contournement d'authentification HTTP de démonstration.

## Fichiers
backend/app : config, database, security, auth, main, schemas.
backend/migrations : schéma, RLS et fonctions de provisionnement.
src/app : écran de connexion, organisations, membres, journal, statut des modules.
infra : Keycloak de développement, bootstrap PostgreSQL.
Dockerfiles/Compose : isolation réseau, images non-root, absence de secrets au build.
CI/tests/docs : tests d'intégration PostGIS, auth, RBAC, régression des routes retirées et recette navigateur.

## Critères de sortie
Lint/typecheck/build et tests backend verts ; migrations sur base vide ; contrôle SQL RLS ; mutations sans session/CSRF refusées ; dernier administrateur protégé ; sessions expirées/révoquées refusées ; navigation responsive vérifiée ; aucun mock actif. Les vérifications impossibles et les prérequis de déploiement sont déclarés dans le bilan, pas présentés comme acquis.

## Sécurité opérationnelle
Le rôle migrateur possède les tables ; le rôle applicatif n'est ni propriétaire ni BYPASSRLS et n'a aucun droit DDL. Les fonctions SECURITY DEFINER ont un search_path fixé et PUBLIC n'a aucun droit d'exécution. Le contexte utilisateur est issu de la session, jamais d'un champ client. La RLS complète les permissions, ne protège pas contre un serveur applicatif totalement compromis capable d'usurper ce contexte.

Le journal est append-only pour le rôle applicatif, pas immuable face au propriétaire DB. Pas de promesse de certification, d'intégration TRACES ou de conformité automatique.
