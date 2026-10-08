# GeoForest — Rapport de résolution des blockers B1–B9

Date : 08/10/2026 · Branche : `arena/c73246d2-geoforest`.

## Statuts utilisés

`OPEN` · `IN_PROGRESS` · `FIXED` (code corrigé, non vérifié en conditions réelles) · `VERIFIED` (preuve reproductible) · `BLOCKED_EXTERNAL` (dépend d'une ressource absente de cet environnement).

Aucun blocker n'est `VERIFIED` sans preuve citée.

## Tableau

| Blocker | Statut | Evidence | Tests | Remaining |
|---|---|---|---|---|
| **B1** Satellite réel | **BLOCKED_EXTERNAL** | GFW injoignable depuis le sandbox (HTTP 000 sur `data-api.globalforestwatch.org` et `production-api.globalforestwatch.org`). Aucune clé `GFW_API_KEY`. Le code ne produit aucun verdict probant sans réponse GFW valide (`fetch failed` → `ANALYSIS_UNAVAILABLE`, constaté dans les journaux `test:unit`). | Unitaires à substitution réseau ; cas « API indisponible » couvert | Jeu de parcelles de référence A–E (conforme, déforesté après cutoff, invalide, API indisponible, données insuffisantes) à exécuter avec une clé GFW réelle ; vérité terrain ; validation méthodologique par un expert. Non réalisé. |
| **B2** Secrets | **OPEN** | Scan d'historique Git par recherche de motifs (`postgres://…:…@`, `password=`, clés AWS, clés privées, JWT) sur les 2 commits (`1c95f4c`, `cf87494`). Trouvé : `postgres:postgres` dans `1c95f4c` (compose, `.env.example`, Dockerfile), désormais retirés. `Trace!Demo2026x` présent dans HEAD uniquement comme valeur de refus (`scripts/seed-auth.ts`, fixture `check-p106-regles.ts`). Aucun autre secret détecté par motifs. | Scan par motifs : non outillé. Gitleaks non installable (hôte de téléchargement hors liste). | Scan outillé (gitleaks ou detect-secrets) à lancer en CI. Rotation des identifiants ayant existé dans un environnement déployé : **à faire par l'exploitant**, impossible d'agir sur les environnements réels d'ici. |
| **B3** Déploiement | **BLOCKED_EXTERNAL** | Docker indisponible dans le sandbox (`docker info` en échec). `docker-compose.yml` corrigé : variables obligatoires (`:?`), application sur `geoforest_app`, plus de `NEXT_PUBLIC_API_URL`. Non exécuté. | `npm run test:db` sur base locale (rôle `geoforest_app`, RLS, limites SQL) : OK. | `docker compose up` sur hôte disposant de Docker ; vérifier migrations, health, restart, persistance, logs. |
| **B4** Documents / antivirus | **OPEN** | Aucun moteur antivirus installé ; base ClamAV injoignable (`database.clamav.net`, HTTP 000). Pièces : statut `NOT_SCANNED`. Garde-fou en place : `VALID` refusé pour `INFECTED` et pour pièce sans fichier. | E2E-008 (validation refusée sans fichier, 422 ; auditeur 403). Pas de test de cycle complet PDF/DOCX/XLSX/corrompu/infecté. | Décision produit/sécurité : ClamAV en service (à déployer) **ou** politique écrite interdisant la validation d'une pièce `NOT_SCANNED`. Tests de types de fichiers réels à écrire. |
| **B5** CSP | **BLOCKED_EXTERNAL** (vérification) | En-tête `Content-Security-Policy-Report-Only` dans `src/proxy.ts`, avec `unsafe-inline` et `unsafe-eval`. Le commentaire source indique qu'une CSP bloquante casserait la carte (Leaflet via unpkg, tuiles Esri). Passage bloquant **non fait** : il ne peut pas être vérifié sans navigateur. Tentative d'installation de Chromium via Playwright : échec (CDN de téléchargement hors liste blanche). | Aucun test de navigateur possible dans ce sandbox. | Navigateur headless sur un hôte ayant accès aux CDN. Ensuite : nonces dans `proxy.ts`, retrait de `unsafe-eval`, inventaire des ressources externes, tests carte / auth / upload / iframe. |
| **B6** S3 | **BLOCKED_EXTERNAL** | Aucun endpoint, bucket ni identifiant S3 dans l'environnement. | — | Tests upload/read/delete/signed URL/isolation tenant sur bucket réel. |
| **B7** TRACES | **FIXED** (périmètre « préparation uniquement », règle de repli du brief) | Écran Déclarations : « Aucune déclaration n'est transmise depuis ce produit » ; compteur « Transmis : 0 — capacité absente ». Aucun appel TRACES dans `src/` ni `backend/`. Périmètre écrit dans `docs/TRACES_SCOPE.md`. | E2E-007 : export refusé pour non probant ; aucune transmission annoncée. | Statut `VERIFIED` non attribuable sans relecture humaine de la formulation finale. Intégration officielle : non engagée, nécessite l'environnement TRACES officiel. |
| **B8** E2E | **OPEN** | Harnais : 49/49 (passe actuelle, après corrections B9). Détail des scénarios E2E-001 à 008 du brief : **non disponible** dans le contexte de cette passe. Parcours fournisseur (invitation, compte, dépôt) : **non construit**. | 49 contrôles, 8 groupes | Obtenir la liste officielle des scénarios ; écrire le parcours fournisseur complet et les tests cross-tenant sur chaque objet (suppliers, products, lots, parcels, documents, analyses, exports, users). |
| **B9** Token FastAPI | **VERIFIED** (corrigé dans cette passe) | Avant : `src/lib/api.ts` utilisait `NEXT_PUBLIC_API_URL` pour appeler FastAPI depuis le navigateur ; `next.config.ts` réécrivait `/fastapi/*` vers FastAPI. Aucun appel n'envoyait le jeton, donc le chemin était cassé (401), mais une variable publique pouvait rediriger le client vers n'importe quel service. Après : `API_BASE` fixé à `""` (routes Next uniquement), rewrite supprimé, variable retirée de `docker-compose.yml`. | (1) `tsc` 0 erreur ; `eslint .` 0 avertissement ; pytest 63/3 xfail. (2) `npm run build` (production) : bundle client sans `GF_BACKEND_API_TOKEN`, sans `/fastapi/`, sans `localhost:8000` (grep sur `.next/static`, 0 occurrence). (3) E2E 49/49 sur le build corrigé. | Le service FastAPI n'est plus utilisé par l'interface. S'il doit l'être un jour, passer par une route serveur Next qui ajoute le jeton ; ne pas réintroduire d'appel navigateur. |

## Corrections de cette passe

1. **B9** : suppression du chemin navigateur vers FastAPI (`src/lib/api.ts`, `next.config.ts`, `docker-compose.yml`).
2. Aucune autre modification fonctionnelle. Les résultats de tests ci-dessus portent sur le code après cette correction.

## Ce qui n'a pas pu être fait, et pourquoi

- **B1, B3, B6** : ressources externes absentes (réseau restreint, pas de Docker, pas de S3). Aucune simulation n'a été présentée comme vérification.
- **B2** : la rotation dépend des environnements déployés, qui ne sont pas accessibles depuis ce sandbox.
- **B4** : le moteur antivirus n'est pas installable ici ; la décision de politique revient au produit.
- **B5, B8** : travail de développement restant, non démarré dans cette passe.
- **B7** : décision de périmètre à prendre avant tout développement.

## Mise à jour de cette passe (2e itération)

- **B7** : périmètre « préparation uniquement » adopté ; `docs/TRACES_SCOPE.md` ajouté.
- **B5** : bloquée pour vérification (pas de navigateur headless). Aucune CSP bloquante activée sans test.
- Relecture de l'interface : aucune formulation « soumis » ou « déclaré » trouvée.

## Décision

Aucun blocker critique n'est fermé de façon démontrable en dehors de B9 et B7 (périmètre). **Décision inchangée : NO-GO.**
