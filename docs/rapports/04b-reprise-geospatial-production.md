# Chantier 4 repris — disponibilité publique et robustesse de l'interface

29 septembre 2026 · **corrections locales et audit public en lecture seule ; pas de publication**.

## Objectif, périmètre et dépendances

Reprendre le chantier 4 conformément au rappel du propriétaire : distinguer moteur géospatial livré localement, code frontend/backend raccordé, et fonction réellement accessible sur `https://geoforest-eabr.vercel.app/`. Corriger les défauts locaux identifiables sans modifier les données Neon, les règles de calcul ou les permissions.

Audit initial : composant `CountryChecks`, intégration dans `PlotsWorkspace`, hook d'API organisationnel, routes FastAPI, catalogue mondial, packaging Vercel, routage Next et rapports 04/08h. Le rapport mondial final 04 remplace le pilote CI ; les anciens blocages de publication ne sont pas pris comme preuve de l'état distant actuel.

Dépendances : frontend verrouillé via `npm ci`, Python standard pour les références, Chromium local pour la recette de composant. Aucun nouveau paquet métier ni changement de lock. Les téléchargements de dépendances/outils de test ne transmettent aucun document métier.

## 1. Observation publique : blocage confirmé

GET anonymes sans cookies ni credentials, sur le domaine public fourni. Preuve horodatée : [public-http.json](preuves-chantier-4/reprise-production/public-http.json).

| Route observée | Résultat |
|---|---|
| `/` | HTTP 200 ; HTML initial « GeoForest Trace — Espace de travail / Ouverture de votre espace sécurisé… » |
| `/sign-in` | HTTP 404 HTML |
| `/api/v1/me` | HTTP 404, erreur Vercel `DNS_HOSTNAME_RESOLVED_PRIVATE` |
| `/api/v1/organizations/00000000-0000-4000-8000-000000000001/geospatial/sources` | HTTP 404, même erreur DNS privé ; UUID entièrement fictif |

Ces résultats démontrent que le chemin public testé ne permet pas la recette métier. **Ce n'est pas un refus d'autorisation normal de FastAPI**, ni une preuve que les fichiers géographiques sont absents. L'erreur est cohérente avec une destination de proxy privée, mais la valeur exacte de configuration distante reste inconnue sans inspection Vercel authentifiée.

Le code local contient la nouvelle page publique et la route de connexion ; l'HTML et le 404 observés montrent un écart de comportement avec ce code. Aucun commit distant exact, alias Production, journal de déploiement ou variable serveur n'a été vérifié par l'API d'administration Vercel. Un HTTP 200 sur `/` ne qualifie donc ni le backend ni le chantier 4.

## 2. Raccordement local existant

- `PlotsWorkspace` construit son API sur `/api/v1/organizations/{org}` et affiche `CountryChecks` dans le détail d'une parcelle, avec une clé parcelle/révision.
- Les appels catalogue, historique et création correspondent aux routes de `backend/app/geospatial/routes.py`, enregistrées par `app/main.py`.
- Le serveur relit la géométrie de la révision autorisée ; aucune géométrie ou conclusion favorable n'est acceptée comme verdict du navigateur. Autorisation, RLS, idempotence et audit restent inchangés.
- Le catalogue actif est Natural Earth mondial indicatif. Le profil Vercel n'exclut pas ce module de cohérence pays ; les fonctionnalités forêt, documents et diligence restent distinctes et soumises à leurs propres gardes.
- Les règles d'exclusion backend ne visent pas `reference/`. Cela ne prouve **pas** les octets effectivement présents dans une fonction Vercel déployée.
- La réécriture `/api/:path*` conserve le chemin vers le backend public configuré. Sa compilation a été vérifiée avec `https://api.geoforest.example`, domaine **fictif de test** ; aucun service n'y a été déployé.

## 3. Corrections réalisées

### Catalogue indisponible

Un échec du GET catalogue pouvait laisser « Chargement de la couverture… » indéfiniment malgré une erreur générique. Le composant affiche désormais un état explicite, sans conclusion favorable, et un bouton **Réessayer le catalogue**. La réponse serveur `coverage=UNAVAILABLE` permet aussi la relance.

### Historique et pagination

Les anciennes données pouvaient rester affichées pendant une nouvelle requête ou après l'échec du chargement d'une autre page. Les réponses sont maintenant liées à leur API, parcelle, révision, page et génération de rafraîchissement. Une réponse obsolète n'est jamais affichée comme résultat du contexte courant.

Pendant l'attente : historique non chargé, pas de nombre zéro présenté comme fait. En échec : message explicite et bouton **Réessayer l'historique**, sans prétendre que les comparaisons ont disparu. Le retour à la page précédente reste possible. Les réponses tardives de requêtes abandonnées sont ignorées, même si le transport n'honore pas l'annulation.

Les erreurs GET affichées sont des messages fixes : pas de détail brut provenant du backend. Les résultats indicatifs, sources, limites, revue humaine et non-vérification du pays restent visibles. Les droits d'écriture serveur ne changent pas.

### Contrôle reproductible des références

Nouveau `scripts/audit-geospatial-artifact.py` : vérifie le manifeste épinglé et lit les 246 références avec les contrôles runtime d'empreinte, structure, coordonnées et budgets. Refuse les catalogues incomplets, exceptions masquées et sources altérées/absentes.

L'audit est hors ligne, sans `.env`, accès DB, réseau ou modification des fichiers. Il **ne requalifie pas la topologie PostGIS** et ne vérifie pas le bundle Vercel distant. `scripts/qualify-geospatial.py` reste l'outil du pilote historique CI : ne pas le présenter comme audit du catalogue mondial actif.

## 4. Tests exécutés

| Vérification | Résultat / portée |
|---|---|
| Tests frontend complets | **107 PASS**, dont 12 nouveaux cas `CountryChecks` |
| Audit de références : tests succès/refus | **6 PASS** |
| Chromium composant + CSS réelle, API fictive | **3 PASS**, largeurs 360 / 390 / 1280 px |
| Audit des fichiers de référence | **246 / 246**, exceptions AQ/EG/UM conservées |
| TypeScript, ESLint, Prettier ciblé, Ruff ciblé | PASS |
| Build Next local OIDC fictif | PASS ; aucun backend réel sollicité |
| Build Next profil hébergé Clerk production fictif | PASS ; réécriture HTTPS compilée vérifiée, **pas une activation Clerk** |

**Total : 116 tests réussis**, plus les audits et builds ci-dessus.

Les 12 cas frontend couvrent l'indisponibilité catalogue/historique et la relance, la pagination défaillante, deux types de réponses tardives, la lecture seule, les marges invalides, l'idempotence d'une relance POST et le rafraîchissement après succès. La visibilité des contrôles pour un lecteur n'est pas un nouveau test RLS serveur.

La recette navigateur utilise le composant réel et la CSS applicative dans une fixture distincte des routes Next. Toutes les réponses métier sont fictives et les requêtes externes du navigateur sont bloquées. Pas d'erreur JavaScript ni débordement horizontal constatés ; captures dans les preuves. **Pas une recette complète du dialogue, de la carte, de Clerk, du backend ou de la DB en production.**

Le premier lancement Chromium a échoué faute de bibliothèque `libnspr4.so` dans le runtime éphémère ; les dépendances système de test ont ensuite été installées et les trois cas rejoués avec succès. Aucun contournement de protection applicative.

Les tests PostGIS, géométries extrêmes, RBAC/RLS serveur et sauvegarde/restauration du chantier 4 d'origine **ne sont pas annoncés comme relancés ici**. La comparaison géographique elle-même n'a pas changé.

## 5. Reproduction

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run test:unit
npm run typecheck
npm run lint
python scripts/audit-geospatial-artifact.py
python -m pytest --confcutdir=tests/geospatial_artifact tests/geospatial_artifact -q
# Machine de recette locale uniquement :
npx playwright install --with-deps chromium
npx playwright test --config tests/gis-browser/playwright.config.ts
```

La fixture Vite n'ouvre qu'un serveur loopback pendant le test et ne lit pas les fichiers `.env`. Elle n'est pas une page produit ou une nouvelle URL publique. Aucun serveur permanent laissé actif.

Fichiers principaux : `CountryChecks.tsx`, `country-checks.test.tsx`, `tests/gis-browser/`, script/tests d'audit des références. Preuves : `docs/rapports/preuves-chantier-4/reprise-production/`, empreintes dans `sha256.json`. La modification préexistante `infra/bootstrap-db.sh` est exclue.

## 6. Plan de raccordement restant — priorité chantier 4

1. **Accès Vercel actuel nécessaire** pour inspecter projet/frontend, alias Production, branche/commit réellement déployés et variables cibles. Ne pas réutiliser les anciens jetons temporaires ni demander des secrets en clair dans un rapport.
2. Vérifier/créer la topologie backend déjà préparée (racine `backend`, région candidate `fra1`) dans le périmètre autorisé et sans souscription payante implicite. Tester directement `/health/live` puis `/health/ready` ; le premier ne garantit pas la DB/RLS.
3. Configurer `API_INTERNAL_URL` vers le vrai backend HTTPS public, pas localhost ni l'origine frontend. Vérifier que l'identité et les environnements correspondent ; les secrets DB restent côté backend. Ne pas contourner TLS, auth ou RLS.
4. Publier le code attendu sur la cible **Production**, pas seulement Preview, puis vérifier le commit/alias et la disparition de l'erreur de proxy. L'accord de publication antérieur n'est pas une preuve qu'elle a eu lieu.
5. Avec session et organisation de recette autorisées : vérifier catalogue 246/exceptions, comparaison saine, non-couverture, source indisponible, historique par révision et isolation organisation/fournisseur ; refaire la recette mobile intégrée et la qualification PostGIS/runtime cible.

Le domaine reste différé conformément au choix du propriétaire. Les gardes Clerk de production ne seront pas assouplies pour qualifier artificiellement l'authentification sur un domaine non éligible. La disponibilité de l'API et la recette authentifiée sont deux étapes distinctes. **Aucune nouvelle migration Neon n'est proposée dans ce lot** ; constater l'état effectif et préserver les données existantes avant toute action future.

## Bilan

- **PRÊT — local :** raccordement inspecté, affichages d'erreur/pagination corrigés, tests et références vérifiés.
- **À FINALISER :** backend public, routage distant, publication du bon code, sessions et recette complète cible.
- **BLOQUÉ — usage public vérifié :** routes API testées en erreur DNS privé ; connexion attendue 404. Pas de résolution distante sans accès actuel à sa configuration.
- **RISQUE RÉGLEMENTAIRE :** une référence Natural Earth à l'échelle 1:10 millions, historique/de facto, ne vérifie ni pays réel, ni souveraineté, ni légalité ou conformité EUDR. Pas de conclusion favorable par défaut.
- **PROCHAINE ÉTAPE :** lever le blocage Vercel/backend du chantier 4, pas revenir implicitement aux sous-lots documentaires.
