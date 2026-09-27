# Chantier 7 — Coffre documentaire et légalité

**Statut : MVP C7 implémenté dans la branche complémentaire; tests locaux réussis.**
**Pas de migration appliquée, pas d'essai runtime MinIO/ClamAV, pas de déploiement ni d'écriture DB de production.**
**Plan de référence :** `agent-work/CHANTIER_7_AUDIT_PLAN.md` (audit/plan séparé).

## Analyse

- Le plan C7 et l'audit existants ont été repris; l'application historique à la racine n'a pas été modifiée.
- Décisions conservées : dépôt fournisseur limité à son propre profil; OCR reporté; catégories/checklist indicatives, configurées par tenant et non exhaustives; aucun verdict/certificat juridique automatisé.
- Références de conception : article 9 EUDR et FAQ Commission (conservation cinq ans à partir de la mise sur le marché/export, pas de l'upload; exemples de preuves non exhaustifs). Voir les URL officielles dans le plan C7.

## Plan exécuté

1. Modèle tenant-scopé, versions immuables, associations métier et checklist configurable.
2. Pipeline de fichier avec plafond 20 Mio par défaut, signature/type réel, validation DOCX, SHA-256 et ClamAV fail-closed.
3. Stockage S3/MinIO privé, lien pré-signé court ou proxy authentifié; aucune clé objet dans l'API publique.
4. Routes opérateur et fournisseur, RBAC, validation des cibles dans le même tenant, partage fournisseur explicite, audit trail.
5. Interfaces opérateur/fournisseur, indicateurs du dashboard, tests backend/frontend et vérification offline de la migration.

## Implémentation — FAIT

- `backend/app/models/documents.py` et `backend/app/models/__init__.py` : documents, versions binaires immuables, liens vers fournisseur/produit/lot/parcelle et checklist tenant.
- `backend/app/services/documents/` : validation d'extension/signature/MIME et structure DOCX, scan ClamAV via INSTREAM, stockage S3/MinIO et règles de statut/checklist.
- `backend/app/schemas/documents.py` : contrats de lecture, dépôt, version, revue, téléchargement et checklist.
- `backend/app/api/v1/endpoints/documents.py` : listes, upload, versions, liens, métadonnées, revue humaine, archivage, historique, checklist et téléchargements. RBAC : lecture opérateur pour les rôles internes; écritures admin/compliance/procurement; revue également procurement.
- `backend/app/api/v1/endpoints/supplier_documents.py` : portail limité au fournisseur du compte; dépôt sur son profil; l'opérateur doit explicitement rendre ses propres documents visibles. Notes internes et liens vers d'autres ressources sont redigés de la réponse fournisseur.
- `backend/alembic/versions/20260926_0002_document_vault.py` : migration additive après `20260925_0001`, créant `documents`, `document_versions`, `document_links`, `document_checklist_items`.
- `backend/app/services/dashboard/overview.py` et `frontend/src/app/(app)/dashboard/page.tsx` : KPIs d'échéance et checklist configurée; onboarding C7 activé.
- `frontend/src/app/(app)/documents/page.tsx` : coffre opérateur, associations, partage, revue humaine, archivage et checklist multi-périmètre.
- `frontend/src/app/supplier-portal/page.tsx` : dépôt et consultation des documents propres/partagés au fournisseur.
- `frontend/src/lib/api.ts` : multipart `FormData` sans définir artificiellement `Content-Type`; téléchargement authentifié.
- `docker-compose.yml` : service ClamAV interne ajouté; paramètres C7 dans `backend/.env.example`.
- `README.md` mis à jour; `frontend` reçoit Vitest et une configuration ESLint compatible Next 16.

## Limites délibérées — NON FAIT

- Pas d'OCR, pas d'auto-classification juridique, pas de checklist légale universelle ou préremplie, pas de certification ni conclusion automatique.
- Pas d'intégration TRACES/EUDR-IS; aucune API supposée.
- Pas de worker d'alertes persistantes ni d'email d'expiration : les échéances et états de checklist sont calculés à la consultation.
- Pas de purge automatique ni de date de conservation calculée à partir de l'upload. Le lot actuel n'expose pas la date de mise sur le marché/export nécessaire; aucune suppression n'est programmée.
- Pas de test réel d'upload MinIO/ClamAV dans ce sandbox; les routes ont été testées avec stockage simulé et avec indisponibilité antivirus.
- La migration n'a pas été appliquée sur PostgreSQL ni sur Neon enfant. Préflight sécurisé effectué sans lire ni afficher de valeurs : aucun binding `DATABASE_URL`, `NEON_DATABASE_URL`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_BRANCH_ID`, `PGHOST` ou `PGDATABASE` n'est injecté dans l'environnement; aucune connexion n'a donc été tentée. Aucun DSN/token n'a été demandé ou reçu.
- Pas de migration ou écriture sur `production`.
- Pas de push effectué : le checkout ne présente actuellement aucun remote Git configuré, aucun helper/secret d'auth GitHub sûr, aucun agent SSH chargé. Le jeton ponctuel déjà utilisé auparavant n'a pas été réutilisé.

## Tests et validation

### Backend

- `backend/.venv/bin/pytest -q` : **101 passed**.
- Couverture C7 : isolation de tenant, filtrage portail fournisseur, rédaction de métadonnées internes, RBAC fournisseur, dépôt et audit, association produit tenant, KPI dashboard, refus fail-closed si ClamAV est indisponible, signatures MIME et DOCX.
- Les tests de migration compilent offline l'upgrade/downgrade PostgreSQL et vérifient les quatre nouvelles tables; aucun accès DB externe n'est utilisé.
- Kit Neon enfant préparé hors ligne : `backend/scripts/neon_child_branch_c7_upgrade.sql` (chaîne complète), `neon_child_branch_c7_incremental_upgrade.sql` (depuis C1), `verify_neon_child_branch_c7_schema.sql` (catalogues read-only) et guide `README_NEON_CHILD_BRANCH_TEST.md`. Révision attendue `20260926_0002`, 13 tables métier, 46 index nommés `ix_`, 65 index physiques et 26 FK. Les commandes Alembic utilisaient une URL locale factice en mode `--sql`; aucun serveur ni service Neon n'a été contacté.

### Frontend

- `npm test` : **1 passed** (multipart upload sans `Content-Type` manuel).
- `npm run typecheck` : **OK**.
- `npm run lint` : **0 erreur, 17 avertissements** (principalement avertissements de code préexistant et navigation `window.location`).
- `npm run build` : **OK**; avertissement Next.js non bloquant sur les deux lockfiles présents dans les répertoires parent/branche.
- `npm audit --omit=dev --audit-level=moderate` : **0 vulnérabilité de dépendances de production**. Après mise à jour vers Vitest 4.1.11, l'installation a également rapporté 0 vulnérabilité.

### Environnement

- `docker-compose.yml` parse comme YAML; le runtime Docker n'a pas été démarré (CLI Docker indisponible).
- Aucun appel externe, aucune migration distante, aucun déploiement et aucune écriture sur Neon `production`.

## PROBLÈMES / RISQUES

- Avant usage réel, il faut valider MinIO/S3 et ClamAV dans un environnement local/de test; ClamAV non prêt signifie que les uploads échouent volontairement.
- En production : fournir les identifiants S3 par gestionnaire de secrets, endpoint public de présignature joignable et HTTPS, chiffrement/permissions minimales du bucket, limites du reverse proxy, sauvegardes et politique de conservation.
- Les URL de présignature sont valides cinq minutes; leur accès après émission ne peut pas être audité comme un appel API distinct.
- L'audit capture le peer IP de la requête; derrière un proxy, il faudra configurer proprement la chaîne de proxies de confiance si l'IP client réelle est requise.
- Le test migration validé est hors ligne seulement; l'essai sur une branche Neon enfant reste une étape à faire via le mécanisme de secrets sécurisé déjà requis.
- Le linter laisse 17 warnings préexistants; ils ne bloquent ni le typecheck ni le build.

## PROCHAINE ÉTAPE

1. Fournir/configurer un accès sécurisé à une branche Neon enfant; appliquer et vérifier la migration uniquement sur cette branche, puis downgrade/re-upgrade si le protocole de test l'exige. Ne pas toucher `production`.
2. Démarrer ClamAV et MinIO en environnement de développement, tester upload réel propre/infecté, téléchargement proxy/pré-signé et permissions tenant/fournisseur.
3. Configurer un remote Git et une identité/credential sûre (sans réutiliser le jeton ponctuel déjà utilisé); ensuite commit/push vers `agent/chantiers-c1-c5-complement` sans écraser le dépôt distant.
4. Revue finale utilisateur du rapport et des résultats runtime avant fusion ou déploiement.
