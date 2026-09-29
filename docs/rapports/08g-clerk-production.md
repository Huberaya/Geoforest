# Chantier 1 de la mise en production — Authentification Clerk

**29 septembre 2026 — suite du chantier 8 initial**
**Statut : implémentation et tests locaux livrés ; activation réelle à finaliser.**

## Objectif et périmètre

Préparer une authentification Clerk exploitable en production, sans contourner les gardes du mode développement ni confier les permissions au navigateur. Ce chantier ne déploie pas le backend Vercel et ne modifie ni Neon, ni Clerk, ni les DNS.

Le travail porte sur le code basé sur `7a2da36`, sur la branche `chantier-8/security-release`. Les données et comptes des tests sont fictifs.

## Réalisé

- Nouveau mode explicite **`clerk_production`**, distinct d'OIDC et de `clerk_development`.
- Configuration live stricte : clés de production, origine HTTPS canonique, domaine personnalisé, cohérence clé publique/émetteur côté frontend, secrets backend distincts et masqués dans la représentation de la configuration.
- Conservation des exigences Neon : rôle runtime, TLS vérifié, RLS et contrôle de schéma au démarrage. Le mode Clerk développement reste interdit sur une base distante et en production.
- Vérification serveur du JWT RS256/v2, de l'émetteur, de l'origine, des dates et du lien utilisateur/session. Relecture de la session et du profil dans Clerk, refus des comptes indisponibles et emails principaux non vérifiés.
- Clés de signature live obtenues via la Backend API de la même instance. Aucun secret transmis à l'hôte FAPI configurable.
- Sessions applicatives opaques de 60 secondes maximum, liées à la session Clerk, cookies Secure/HttpOnly/SameSite, renouvellement, rotation et déconnexion protégée.
- Rôles et organisations exclusivement issus de PostgreSQL ; aucune fusion automatique par email ni droit provenant des métadonnées Clerk.
- **MFA administrateur contrôlée côté serveur**, à partir des deux facteurs signés et du profil Clerk, avec échéance bornée. Le renouvellement seul ne prolonge pas une ancienne MFA.
- Parcours **Sécurité du compte → Vérifier mon identité**, avec revérification Clerk puis nouveau contrôle backend. Une annulation ou un retour à un seul facteur n'accorde aucun privilège administrateur.
- État MFA affiché par `/api/v1/me` aligné sur le contrôle réel des permissions ; actualisation du frontend lors d'un changement d'assurance.
- Connexion, inscription, déconnexion et CSP frontend compatibles avec les deux modes Clerk. Portail fournisseur indépendant conservé.
- Compilation du profil Clerk production ajoutée à la CI, avec configuration publique fictive, sans secret Clerk. Cette nouvelle étape CI n'a pas encore été exécutée sur GitHub.

**Aucune migration de schéma :** le marqueur de session et son assurance utilisent le champ `sessions.acr` existant. Les comptes ne sont pas provisionnés dans une organisation à partir des claims Clerk.

## Fichiers principaux

| Zone | Fichiers |
|---|---|
| Vérification et configuration | `backend/app/clerk_identity.py`, `config.py` |
| Sessions, MFA, API | `clerk_routes.py`, `security.py`, `auth.py`, `main.py`, `middleware.py` |
| Configuration frontend | `src/auth-provider.ts`, `next.config.ts`, layouts et pages comptes/espace |
| Session et sécurité du compte | `ClerkSessionBridge.tsx`, `ClerkSecurityControls.tsx`, `AuthSession.tsx`, `globals.css` |
| Tests | `test_clerk_production.py`, `test_clerk_production_bridge.py`, tests unitaires frontend et `clerk-production.spec.ts` |
| Exploitation | [Guide Clerk production](../deploiement/clerk-production.md), workflow CI |

## Tests et preuves

| Vérification | Résultat |
|---|---|
| Suite backend complète pendant le chantier | **1 043 réussis**, 500,36 secondes, 13 avertissements |
| Régression ciblée sur la version finale : identité, sessions, fondation et sécurité de livraison | **250 réussis**, 37,12 secondes, 1 avertissement |
| Tests unitaires frontend finaux | **54 réussis** |
| Chromium, profil production fictif | **5 réussis**, 50,9 secondes |
| Builds frontend Clerk production et OIDC | Réussis |
| TypeScript, ESLint, Ruff | Réussis |
| Audit npm | 0 vulnérabilité signalée |

**Précision sur la version testée :** les 1 043 tests ont été exécutés avant l'ajustement final harmonisant l'affichage MFA de `/api/v1/me` et le rafraîchissement frontend. Après cet ajustement, les 250 tests ciblés, les 54 tests frontend, les builds et les 5 tests navigateur ont été relancés. Les 250 tests recouvrent une partie de la suite complète ; ces nombres ne doivent pas être additionnés.

La base PostgreSQL 17/PostGIS a été créée **localement et uniquement pour les tests**, puis migrée de `0001` à `0007`. Les tests vérifient notamment la rotation des sessions, les refus de mauvaise origine, le CSRF, la révocation, les pannes, l'absence de fusion par email, les refus inter-organisations, la MFA expirée et les configurations dangereuses.

Les tests cryptographiques utilisent des JWT signés localement avec des clés fictives. La Backend API Clerk est simulée. Les tests navigateur bloquent le réseau d'identité et vérifient les écrans publics, les erreurs et l'absence d'ouverture de l'espace métier sans vérification. Le backend n'était pas exposé pendant cette recette navigateur : le portail est testé sur son entrée publique, pas comme session fournisseur active.

**Responsive vérifié sur les écrans publics et d'indisponibilité : 1 440, 768, 390 et 360 px, sans débordement horizontal.** Le parcours MFA hébergé réel sur smartphone reste à qualifier.

Incidents de test résolus : premier passage backend interrompu par la limite d'exécution de 300 secondes, puis suite complète relancée avec une durée suffisante ; bibliothèques système Chromium initialement absentes, installées avant la recette réussie. Les avertissements restants concernent le transport TestClient Starlette/httpx et des dépréciations Rasterio/Affine.

Preuves, captures et empreintes des fichiers : `docs/rapports/preuves-chantier-8/clerk-production/`.

## Dépendances et risques restant à lever

### Domaine personnalisé obligatoire pour le parcours retenu

La [documentation de production Clerk](https://clerk.com/docs/guides/development/deployment/production) exige un domaine possédé avec accès DNS. L'adresse `geoforest-eabr.vercel.app` seule ne suffit pas à ce prérequis. L'hébergement peut rester sur Vercel avec un domaine personnalisé ; aucun domaine n'a été acheté ou modifié.

Le code supporte le schéma standard `clerk.<domaine>` et l'application sur ce domaine ou un de ses sous-domaines. Les domaines satellites et le proxy FAPI ne sont pas implémentés dans cette livraison.

### Limites de sécurité explicites

- Révocation distante : une session applicative déjà délivrée peut rester valide jusqu'à **60 secondes**, sans renouvellement possible si Clerk la refuse. Pas de promesse de révocation globale instantanée par webhook.
- MFA : fenêtre maximale de dix minutes, réduite conservativement pour l'arrondi des âges signés ; besoin d'un vrai second facteur et d'une stratégie de revérification disponible sur l'instance.
- Quotas et charge : le renouvellement relit Clerk ; capacité, coûts, limitations de débit et fonctionnement derrière le proxy Vercel restent à qualifier.
- Ni inscription, ni connexion, ni MFA humaine réelle n'ont été réalisées par ces tests. Les secrets et paramètres de production n'ont pas été utilisés.
- Le routage backend Vercel et son repli actuel vers localhost restent à traiter au chantier suivant. L'ajout du mode production ne les corrige pas à lui seul.

## Bilan et prochaine action

**PRÊT POUR REVUE :** code d'authentification production, protections, tests locaux, guide de configuration et de recette.

**À FINALISER :** domaine détenu, instance Clerk Production, configuration DNS/certificats, paramètres live, disponibilité MFA, recette humaine et qualification opérationnelle.

**BLOQUÉ POUR LANCEMENT PUBLIC :** backend non hébergé et raccordement réel non effectué. La Production Vercel n'a pas été modifiée. Ce chantier ne prétend pas rendre la connexion publique déjà opérationnelle.

**RISQUE RÉGLEMENTAIRE :** authentifier une personne ne certifie ni son organisation ni sa conformité EUDR ; les permissions, preuves et validations métier restent nécessaires.

**CHANTIER SUIVANT :** préparer et qualifier le backend Vercel, puis configurer l'identité réelle sur le domaine choisi. Ne pas promouvoir un ancien build compilé avec des clés Clerk de développement.

Aucun push GitHub, déploiement Vercel, changement de compte Clerk, accès Neon, achat ou modification DNS pendant ce chantier. La modification préexistante du mode de `infra/bootstrap-db.sh` reste exclue. Les serveurs de recette ne constituent pas un point d'entrée produit.
