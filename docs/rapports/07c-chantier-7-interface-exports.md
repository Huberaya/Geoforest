# Chantier 7 — interface et exports intégrés

> Historique : chantier 7 désormais clôturé pour le MVP interne. Voir le [bilan final](07d-chantier-7-cloture.md). Les réserves ci-dessous décrivent l’état de cet incrément, pas le bilan courant.
29 septembre 2026 · branche `chantier-7/due-diligence-exports` · troisième incrément.

**Statut : incrément fonctionnel livré localement ; chantier 7 encore À FINALISER. Aucun GO8, aucun déploiement de production ni push GitHub.**

## Objectif et réalisation

Rendre les dossiers persistés du deuxième incrément utilisables dans l’interface et téléchargeables en PDF/JSON/CSV privés. Dépendances : migration 0007, contextes des chantiers 2–6, authentification/RLS existants. Aucune migration supplémentaire.

- Navigation staff, préparation multi-lots, qualification explicite, brouillons figés, contrôles et messages de blocage, revue humaine, nouvelles révisions et consultation historique.
- Liste paginée des dossiers et recherche de lots (100 premiers résultats, périmètre limité à 20).
- Décisions internes avec rôles, notes et confirmation, idempotence des tentatives identiques, conflits conservés comme erreurs explicites.
- Trois formats sous `GET …/export.{kind}`, avec `kind=json|csv|pdf`. Le chemin `/export.json` reste utilisable.
- PDF lisible : opérateur, lots, légalité, risque, preuves et décisions. JSON compagnon nécessaire pour le détail structuré complet. CSV index UTF-8 BOM, cellules protégées contre les formules.
- En-tête `X-Content-SHA256`, vérification navigateur avant téléchargement, audit transactionnel. Aucun octet d’export libéré si la session expire pendant l’opération.
- Police DejaVuSans embarquée avec licence ; dépendances ReportLab 5.0.1 et charset-normalizer 3.5.1 épinglées.
- Versions backend/frontend 0.8.0-dev. `DILIGENCE_ENABLED=false` par défaut ; écran indisponible avec erreur explicite si le serveur n’active pas la fonctionnalité.

Fichiers principaux : `backend/app/diligence/{artifacts,pdf_worker,routes}.py`, fontes locales, `src/components/diligence/DiligenceWorkspace.tsx`, page/CSS, tests API et navigateur, script de fixtures, OpenAPI et [guide utilisateur](../guide-diligence.md).

## Sécurité et limites PDF

Le contenu utilisateur est échappé avant mise en page ; aucune balise utilisateur n’est interprétée et aucune URL n’est chargée par le chemin de rendu. Sous-processus à environnement minimal, entrée 2 Mio, sortie 8 Mio, CPU 15 s, délai parent 25 s, espace d’adressage 512 Mio, 64 descripteurs, core interdit. Budget de texte 80 000 caractères et 60 pages. Caractères non couverts refusés explicitement plutôt que remplacés.

Verrou PostgreSQL global à la base : un seul export PDF simultané ; le second reçoit 429, les autres formats restent possibles. Ce choix protège le MVP mais n’est ni une file durable, ni une stratégie adaptée à des millions de dossiers. Les limites de ressources ne constituent **pas une sandbox OS/réseau qualifiée**.

Le PDF n’est ni une signature électronique qualifiée ni un dossier officiel. Les déclarations humaines, noms et notes restent des données non vérifiées. Aucun numéro officiel n’est inventé ; la validation interne n’équivaut jamais à une déclaration aux autorités.

## Tests réellement exécutés

| Contrôle | Résultat |
|---|---|
| Régression backend complète | **815 passed**, 13 avertissements, 439,85 s, sortie 0 |
| API diligence ciblée | **35 passed**, 14,63 s, sortie 0, inclus dans les 815 |
| Chromium + frontend + vraie API/PostgreSQL | **4 passed**, 8,7 s |
| TypeScript | Réussi |
| ESLint | Réussi, sans avertissement |
| Build Next.js standalone | Réussi ; dotenv retirés de l’artefact |
| Ruff backend et script de fixtures | Réussi |
| Audit Python des dépendances épinglées | Aucune vulnérabilité connue signalée |

API : exports des trois formats sur dossier incomplet et dossier avec géométrie/preuve/légalité/risque ; lecture PDF indépendante avec pypdf, extraction des mentions, empreinte et décision ; rôle Viewer/Analyst/Supplier sur tous formats ; verrou concurrent PDF ; échec de génération sans audit validé ; expiration en fin d’export sans libération de fichier ni audit validé ; balise distante conservée comme texte ; caractères hors police refusés ; budget texte ; CSV anti-formule.

Navigateur : préparation/revue d’un dossier **bloqué**, trois téléchargements avec vérification d’empreinte, révision suivante/historique, desktop et viewport 390×844 sans débordement horizontal ; Viewer sans préparation ni décision ; Supplier sans navigation diligence et API 403. Aucune erreur JavaScript observée dans les deux parcours principaux. Capture desktop examinée visuellement.

**Périmètre précis de cette preuve** : sessions synthétiques injectées dans le navigateur, API et DB réelles, pas de mock HTTP. OIDC n’a pas été rejoué. Le parcours positif de validation est testé côté API, mais pas encore de bout en bout dans le navigateur. Le test Viewer vérifie la disponibilité des exports dans l’interface ; les téléchargements sont exécutés dans les deux parcours Admin et autorisés par les tests API de rôles.

Les premières tentatives navigateur ont échoué pour dépendances système Chromium absentes, puis configuration locale d’origine/cookie incohérente avec les sessions. Environnement corrigé ; aucun contrôle de sécurité n’a été desserré. Les serveurs de recette ont été arrêtés après vérification. Les tokens de fixtures restent hors Git et sont révoqués après recette.

Les résultats migration/restauration du deuxième incrément restent historiques : aucune nouvelle restauration avec les trois formats n’est revendiquée. Les tests documentaires continuent d’utiliser le scanner synthétique ; aucun nouveau test antivirus réel dans ce bloc.

## Reste avant clôture du chantier 7

1. Compléter la recette navigateur positive de validation/corrections/retrait, avec connexion OIDC et écran étroit 360 px ; conflits et changements de rôle/session pendant interaction.
2. Approfondir les tests aux bornes PDF (60 pages, timeout réel, mémoire) et l’examen visuel des longues mises en page ; tester les téléchargements depuis une restauration isolée.
3. Arrêter le périmètre du suivi externe : guide de saisie assistée livré, **suivi manuel structuré de références non implémenté**. Pas de connecteur officiel qualifié, API officielle existante et non simulée.
4. Bilan final de chantier et réserves de lancement ; attendre GO8 avant le chantier suivant.

Les réserves d’hébergement UE, chiffrement, antivirus de production, sandbox, sauvegardes opérationnelles, SMTP/OCR et qualification réglementaire des autres régimes restent applicables. Cet incrément n’autorise pas une annonce de conformité absolue ni une mise en production.

## Reproduction

Après migration d’une base suffixée `_test`, exécuter la régression backend, puis générer les données navigateur via `APP_ENV=test E2E_DILIGENCE_SEED=/chemin/prive/hors-repo/fixture.json .venv/bin/python scripts/seed-diligence-e2e.py`. Le script refuse une sortie dans le dépôt ; le fichier contient des sessions sensibles et doit rester privé.

Démarrer l’API en mode test avec les mêmes base, secret de session et `PUBLIC_ORIGIN=http://localhost:3000`, `DILIGENCE_ENABLED=true`, puis Next.js avec proxy `/api` vers cette API. Exécuter `E2E_DILIGENCE_SEED=/chemin/prive/hors-repo/fixture.json npx playwright test tests/e2e/diligence.spec.ts`. Ne pas exécuter la régression destructive simultanément. Révoquer les sessions de fixtures après usage.

Preuves : `preuves-chantier-7/{backend-increment3,api-increment3,e2e-increment3,build-increment3,lint-increment3,types-increment3,ruff-increment3,audit-python-increment3}.txt`.
