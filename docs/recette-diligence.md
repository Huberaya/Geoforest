# Recette du chantier 7

Cette procédure ne qualifie pas un déploiement de production. Exécuter exclusivement sur des bases suffixées `_test`, sans données réelles. Les tests pytest réinitialisent les tables : ne jamais les exécuter simultanément avec la recette navigateur ou une comparaison de restauration.

## 1. Backend et limites PDF

Après bootstrap des rôles séparés et migration 0007 :

```sh
cd backend
../.venv/bin/pytest -q
../.venv/bin/pytest tests/test_diligence_api.py tests/test_diligence_pdf_limits.py -q
```

`test_diligence_pdf_limits.py` exerce les 60/61 pages avec une vraie pagination ReportLab et le pied de page de production, un contenu long réel, le délai parent de 25 secondes, la limite CPU de 15 secondes, l’espace d’adressage de 512 Mio et la limite de fichier de 8 Mio. Pour les quatre limites de processus, seul le rendu est remplacé par une sonde dans un **vrai sous-processus** ; `main()` applique les mêmes limites de production. Le test vérifie également l’absence de processus enfant survivant. Ce n’est ni un test de charge multi-instance, ni une qualification de sandbox OS/réseau.

## 2. Recette navigateur OIDC positive

Prérequis de recette exécutés : PostgreSQL 17/PostGIS, Python 3.13, Node, Chromium Playwright et Keycloak 26.6.0 local en mode développement. L’IdP est un service de test HTTP local, pas un modèle de configuration de production. Les contrôles de signature, issuer, PKCE, CSRF et permissions restent actifs.

1. Créer hors dépôt un répertoire privé 0700, puis `config.json` en 0600 avec les champs `username`, `password`, `subject` (UUID Keycloak du compte), `email` (adresse `.invalid`), `client_secret`, `session_secret`. Générer des secrets aléatoires ; ne pas les committer ni les journaliser.
2. Créer/importer dans Keycloak un realm `geoforest`, client confidentiel `geoforest`, Authorization Code et PKCE S256, redirection `http://localhost:3000/api/auth/callback`, compte fictif avec email vérifié. Pas de direct password grant ni d’inscription libre nécessaires.
3. Configurer Keycloak avec **hostname complet `http://localhost:3000/identity`** et chemin HTTP relatif `/identity`, port 8080. Le discovery doit annoncer exactement `http://localhost:3000/identity/realms/geoforest`. Un hostname sans `/identity` a provoqué un refus d’issuer lors de la première tentative : corriger l’IdP, ne jamais désactiver le contrôle.
4. Après la régression backend, générer une fixture documentaire complète :

```sh
APP_ENV=test E2E_DILIGENCE_PRIVATE=/chemin/prive \
  .venv/bin/python scripts/seed-diligence-final-e2e.py
```

Le script utilise les variables de bases de test de `backend/tests/conftest.py` (surcharge possible par environnement), crée un dossier READY, son justificatif PNG fictif, légalité/risque fictifs, et rattache l’utilisateur OIDC à l’organisation. **Le scanner est synthétique dans le seul processus de préparation** ; aucun patch scanner n’est installé dans l’API live. La session temporaire de préparation est supprimée. `fixture.json` et le coffre restent privés.

5. Démarrer l’API avec les paramètres explicites : `APP_ENV=test`, origine `http://localhost:3000`, base runtime test, les secrets locaux du fichier privé, `OIDC_ISSUER=http://localhost:3000/identity/realms/geoforest`, `OIDC_BACKCHANNEL_ORIGIN=http://localhost:8080`, `ADMIN_ACR=` pour ce realm de test, `DILIGENCE_ENABLED=true`, `DOCUMENTS_ENABLED=true`, `DOCUMENT_STORAGE_ROOT=/chemin/prive/documents`. Définir les hôtes autorisés de recette et désactiver les access logs contenant les paramètres du callback OIDC (`--no-access-log`). Ne pas reprendre une configuration `.env` de production.
6. Démarrer Next.js avec `KEYCLOAK_INTERNAL_URL=http://127.0.0.1:8080` et `API_INTERNAL_URL=http://127.0.0.1:8000`, puis :

```sh
E2E_DILIGENCE_PRIVATE=/chemin/prive \
  npx playwright test tests/e2e/diligence-final.spec.ts
```

Les deux scénarios partagent la fixture et s’exécutent séquentiellement avec un worker. Ils se connectent réellement via l’IdP : aucune injection de cookie ou mock HTTP dans ces deux tests. Le second scénario modifie le rôle via une connexion privilégiée **de fixture**, pour simuler un changement concurrent ; le navigateur doit subir le refus API. Les PDF/CSV/JSON téléchargés et la capture 360px sont écrits dans le répertoire privé. Régénérer une fixture propre avant de rejouer la suite.

Le scénario historique `diligence.spec.ts` reste séparé : il utilise des sessions injectées et son propre script `seed-diligence-e2e.py` pour la préparation incomplète et les rôles Viewer/Supplier. Ne pas confondre cette preuve avec l’authentification OIDC.

## 3. Restauration isolée et exports

1. Arrêter toutes les instances API, workers et écritures de la source. Dans la recette finale, Next.js et Keycloak ont également été arrêtés.
2. Produire un dump PostgreSQL cohérent (rôles/propriétés conservés) et copier le coffre privé avec les permissions, sans réécrire les blobs. Dump 0600, répertoires 0700.
3. Créer **une autre base `_test`**, restaurer le dump et les extensions/owners/grants attendus. Ne pas ouvrir l’API restaurée avant révocation des sessions/invitations copiées.
4. Exécuter `scripts/check-document-vault.py --root /coffre/restaure --output /rapport/prive.json --writers-stopped` avec l’URL migrator de restauration. Refuser une preuve manquante/invalide.
5. Définir les URLs source migrator, restore migrator et restore runtime distinctes ; origine et hôtes TestClient ; `APP_ENV=test`, `DILIGENCE_ENABLED=true`, secret de session de test, `DOCUMENT_STORAGE_ROOT` restauré, et `RESTORE_PROOF_OUTPUT` vers un rapport non sensible. Exécuter :

```sh
.venv/bin/python scripts/verify-diligence-restore.py --writers-stopped
```

Le script compare sept tables sensibles, révoque sessions ordinaires/fournisseur et invitations restaurées, utilise une session éphémère pour vérifier les trois formats sur toutes les révisions et les refus anonymes, puis révoque cette session et les sessions restantes de la source. Ne pas comparer ce dump à une source réinitialisée ultérieurement par pytest.

## 4. Fin de recette

Arrêter les serveurs ; révoquer les sessions, détruire les secrets de l’IdP de test ou supprimer son instance. Conserver seulement les preuves expurgées dans Git. Les dumps, coffre, identités de recette et exports complets restent dans un espace privé. Les images de recette ne contiennent que des données fictives ; aucun jeton ou numéro de vérification officiel ne doit y figurer.
