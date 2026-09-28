# GeoForest Trace — bilan du chantier 1

**Date : 28 septembre 2026**
**Branche : `chantier-1/socle-securise`**
**Base auditée : `ba6b8dac4d52a980f2b57b84d5e004e5ad207a40`**

## Décision

**Socle fonctionnel livré et testé localement — soumis à votre recette.**

Il ne s'agit pas d'une autorisation de mise en production. Le déploiement Docker complet sur l'hôte cible, le fournisseur OIDC/MFA de production et les garanties opérationnelles restent à qualifier. Le chantier 2 n'a pas commencé et attend votre GO explicite.

## 1. FAIT

### Architecture et suppression des faux résultats
- Next.js conservé ; une seule API métier, FastAPI.
- Moteurs Python/TypeScript du prototype, SQLite, anciens composants et tests déplacés dans `archive/prototype`, hors builds et exécution.
- Les anciennes routes d'analyse/export ne produisent plus de résultat : 401 sans connexion, 410 après connexion.
- Aucun verdict « conforme EUDR » automatique, aucun score simulé et aucune soumission officielle dans le parcours actif.
- Aucune suppression/migration de données d'un déploiement existant : aucun accès à cet éventuel déploiement n'a été fourni.

### Authentification
- OIDC Authorization Code + PKCE S256 via Authlib.
- Keycloak 26.5.6 de recette, connexion réelle testée en navigateur, sans faux jeton et sans bypass HTTP.
- Vérifications cryptographiques déléguées à Authlib ; issuer attendu contrôlé ; email vérifié exigé.
- Sessions opaques révocables en PostgreSQL, seul le hash du jeton navigateur est stocké.
- Cookies HttpOnly/SameSite=Lax, Secure et préfixe __Host en HTTPS ; rotation à la reconnexion.
- Expiration, révocation à la déconnexion, protection CSRF + Origin sur mutations.
- Configuration de production refusée sans HTTPS, hosts explicites et exigence ACR administrateur.

### Organisations et rôles
- Créer et renommer une organisation, gérer plusieurs appartenances.
- Ajouter/modifier/retirer les droits d'un compte OIDC existant et vérifié.
- Rôles Admin, Compliance Manager, Procurement, Analyst, Viewer, Supplier.
- Périmètre UUID obligatoire pour Supplier ; aucun accès aux membres/journal d'entreprise pour ce rôle.
- Protection du dernier administrateur via l'API et verrou de concurrence sur la gestion des membres.
- Modifications d'organisation protégées par numéro de version.

### Isolation, base et audit
- PostgreSQL 17/PostGIS 3.5 réellement utilisés pour la recette.
- Migration Alembic `0001`, exécution explicite, sans modification automatique forcée du schéma au démarrage.
- Rôles applicatif/migrateur séparés ; rôle applicatif non propriétaire, sans SUPERUSER/BYPASSRLS ni CREATE.
- RLS sur organisations, appartenances et journal ; contexte transactionnel remis à zéro avec le pool.
- Tests SQL directs et API inter-organisations.
- Journal avant/après, auteur, objet, source et date UTC ; insertion atomique avec les mutations.
- UPDATE/DELETE du journal interdits au rôle applicatif ; aucune promesse d'inviolabilité contre l'administrateur DB.

### Interface et exploitation
- Écran de connexion, vue d'ensemble, sélection d'organisation, membres, paramètres et journal fonctionnels.
- Écrans contrôlés aux largeurs 1440, 768, 390 et 360 px ; absence de débordement horizontal vérifiée.
- Navigation des prochains modules désactivée ; chiffres limités aux données effectivement disponibles.
- Protection de taille des requêtes (64 Kio), limite de débit partagée en PostgreSQL, messages d'erreur sans détail SQL.
- Images frontend/API non-root, secrets exclus des contextes Docker, base non publiée par Compose.
- Build standalone : suppression supplémentaire des `.env` que Next.js peut copier par traçage lors d'un build local ; vérification de l'absence de `.env` dans l'artefact final.
- CI GitHub Actions fournie, documentation API, ADR, procédures de configuration et d'exploitation.
- Sauvegarde/restauration réellement exercée sur une base synthétique isolée.

## 2. Tests exécutés et résultats

| Vérification | Résultat final | Précision |
|---|---|---|
| ESLint frontend | Réussi | Aucune erreur |
| TypeScript | Réussi | Aucun échec de compilation |
| Build Next.js 16.3.6 + standalone | Réussi | Artefact démarré réellement |
| Ruff backend/scripts | Réussi | Vérifications E4/E7/E9/F/I |
| Pytest backend | **30 réussis, 0 échoué** | PostgreSQL/PostGIS réel, base dédiée `_test` |
| Playwright Chromium | **2 réussis, 0 échoué** | Connexion publique responsive + parcours OIDC complet |
| Parcours OIDC réel | Réussi | Login Keycloak, PKCE/state/nonce présents, création, édition, journal, cookies et logout |
| Isolation inter-tenant | Réussie pour le périmètre livré | API et SQL rôle applicatif ; contexte falsifié sans appartenance refusé |
| CSRF/origine/session | Réussi | Manquants, origine étrangère, expiration, révocation |
| RBAC | Réussi | Non-Admin refusés sur mutations ; journal limité Admin/Compliance |
| Supplier | Réussi pour le socle | Scope obligatoire et absence d'accès entreprise ; futurs objets fournisseurs non encore présents |
| Journal append-only | Réussi | UPDATE/DELETE refusés au rôle applicatif |
| Migrations base vierge + réexécution | Réussi | Configuration de droits analogue au bootstrap Compose |
| Sauvegarde/restauration | Réussi localement | Migration, PostGIS, données synthétiques et activation RLS retrouvés |
| Audit npm | **0 vulnérabilité connue signalée** | Au scan de cette livraison, pas garantie d'absence de faille |
| Audit Python | **0 vulnérabilité connue signalée** | Lock de dépendances isolé, même limite |
| Exclusion des secrets dans le standalone | Réussi | Aucun `.env` à la racine de l'artefact final |

### Défauts rencontrés puis corrigés durant le chantier
- Lint initial, imports obsolètes des routes supprimées, contrat frontend remplacé.
- Dépendances vulnérables signalées : mises à jour Next.js et dépendances frontend, Authlib, pydantic-settings et pytest.
- Références OIDC inaccessibles depuis un conteneur : séparation issuer public / backchannel interne, même origine navigateur pour Keycloak.
- Copie automatique d'un `.env` local par le standalone Next.js : purge postbuild explicite et exclusion Docker.
- Ressources navigateur manquantes dans la sandbox : installation pour la recette.
- Protection réseau externe de l'aperçu : tests navigateur via une passerelle TLS de boucle locale, décrite ci-dessous.

### Avertissement restant
La suite Python émet un avertissement de dépréciation Starlette concernant son intégration de tests avec httpx. Il n'affecte pas les 30 succès, mais la migration du client de test doit être suivie avec les prochaines mises à jour de dépendances.

## 3. Limites de la recette

- **Docker :** Dockerfiles, réseau Compose et workflow CI écrits ; migration et application testées hors conteneurs. Pas d'exécution complète Docker Compose ni de scan des images dans cet environnement.
- **GitHub :** workflow non exécuté sur GitHub, aucun push effectué ; PAT non reçu ni nécessaire pour les tests locaux.
- **MFA :** contrôle ACR implémenté et refus d'un niveau insuffisant testé. Pas de recette MFA réelle avec un fournisseur de production choisi ; ne pas confondre claim configurable et MFA effectivement imposée par l'IdP.
- **Accès à l'aperçu :** les URLs publiques de la sandbox sont protégées par un jeton de trafic de la plateforme. Les tests Chromium ont utilisé une résolution locale du même nom d'hôte et une passerelle TLS locale vers le véritable frontend, le véritable backend et Keycloak. Aucun échange OIDC n'a été simulé. Cela ne valide pas la passerelle externe Arena ni sa gestion des cookies/iframes ; ouvrir l'aperçu dans un nouvel onglet pour la connexion si nécessaire.
- **Navigateur :** Chromium seulement, contrôles responsive et parcours principal. Pas d'audit WCAG complet, Safari/iOS/Firefox ni test de charge.
- **Données :** uniquement identités et organisations synthétiques. Aucune donnée privée de fournisseur, aucune parcelle réelle ajoutée.
- **Ancien déploiement :** non audité dynamiquement, aucun inventaire de données à migrer hors dépôt.

## 4. NON FAIT — volontairement hors chantier

Fournisseurs et portail de collecte, produits/lots/expéditions, cartes actives et import SIG, coffre documentaire, légalité, analyses satellite, moteur de risque, dossier DDR, connecteur réglementaire, OCR/IA, notifications email, facturation.

Les invitations email sont différées au chantier 2. L'ajout d'un compte préalablement connecté fonctionne dès maintenant. Le client frontend utilise des DTO TypeScript explicites ; sa génération depuis OpenAPI est encore à intégrer, le schéma OpenAPI et le script d'export étant fournis.

## 5. RISQUES et prérequis de production

1. Valider l'hébergement, le fournisseur OIDC, le flow MFA/ACR, le TLS et la politique de rétention.
2. Exécuter la pile Docker/CI sur une infrastructure contrôlée ; scanner les images et confirmer les droits réseau.
3. Ne jamais déployer Keycloak `start-dev`/H2 comme IdP de production.
4. Ajouter limitation par client au reverse proxy de confiance ; le limiteur DB actuel voit l'adresse du pair et peut agréger plusieurs utilisateurs derrière un proxy.
5. Qualifier CSP à nonce strict, monitoring, alertes, sauvegardes chiffrées et restauration sur l'environnement cible.
6. Définir les objectifs RPO/RTO ; le test local ne vaut pas engagement opérationnel.
7. La déconnexion révoque GeoForest, pas nécessairement le SSO IdP ; backchannel logout IdP non implémenté.
8. Les tests d'isolation devront être étendus à chaque futur module, objet, fichier, recherche, export et job.

## 6. Livrables et preuves

- `README.md` : installation, configuration, limites.
- `docs/adr/001-socle.md` : décision technique et périmètre.
- `docs/API.md`, `docs/openapi.json` : contrats du socle.
- `docs/SECURITE_ET_EXPLOITATION.md` : droits, sessions, déploiement et restauration.
- `backend/tests/`, `tests/e2e/` : tests reproductibles.
- `.github/workflows/ci.yml` : contrôles à exécuter sur GitHub.
- `docs/rapports/preuves-chantier-1/` : sorties lint/typecheck/build/Pytest/Playwright, scans de dépendances, migration/restauration, captures desktop/mobile.

Les identifiants synthétiques de l'aperçu sont fournis séparément dans l'espace de travail, jamais dans le repository. Les secrets de configuration sont dans `.env`, ignoré par Git. Aucune clé GitHub n'a été utilisée.

## 7. PROCHAINE ÉTAPE

1. Votre recette du chantier 1 et éventuelles corrections dans ce même chantier.
2. Push de la branche seulement après votre autorisation et mise à disposition sécurisée des accès GitHub.
3. **Attendre votre GO avant de commencer le chantier 2.**

Si vous autorisez ensuite le chantier 2, préciser les commodités/pays du pilote et l'existence éventuelle d'un ancien déploiement ou de données à préserver.
