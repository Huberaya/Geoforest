# Chantier 5 — Rapport d'avancement et de validation

**Date : 25 septembre 2026**  
**Statut : MVP implémenté et validé hors ligne; intégration GFW live et mise en production non validées.**

> La demande « chantier 5 » a été interprétée comme un feu vert général pour implémenter le MVP. Elle n'a pas été comprise comme l'accord distinct de l'utilisateur sur chaque choix méthodologique. Les hypothèses appliquées sont exposées ci-dessous et dans [le plan d'audit C5](CHANTIER_5_AUDIT_PLAN.md).

## FAIT

- Audit de l'ancien service satellite et du contrat GFW, puis implémentation d'un dépistage **indicatif** de perte de couvert arboré; aucun statut « conforme », « non conforme » ou « déforestation confirmée », aucun score de confiance maison.
- Appel backend préparé pour `POST /dataset/umd_tree_cover_loss/v1.13/query/json`, avec redirections interdites, sans clé exposée au navigateur et sans repli vers un résultat simulé.
- Seuils GFW corrigés à partir des [métadonnées officielles des champs v1.13](https://data-api.globalforestwatch.org/dataset/umd_tree_cover_loss/v1.13/fields) : **10 % → code 1** et **30 % → code 5**. Ce mapping n'est autorisé par le code que pour le dataset/version correspondants; une version non vérifiée est refusée.
- Garde live à trois conditions : clé API, `GFW_LIVE_ENABLED=true` **et** `GFW_CONTRACT_VERIFIED=true`. Les deux drapeaux sont `false` par défaut et dans les exemples d'environnement.
- Ajout d'un CLI de probe manuel `backend/scripts/probe_gfw_contract.py` : géométrie synthétique fixe, sans accès DB, exige `ENVIRONMENT=development|test`, `GFW_LIVE_TEST_ENABLED=true` et un accord en ligne de commande. Il ne change pas les drapeaux d'activation du service. Sa garde a été vérifiée localement; aucun appel réseau n'a été lancé.
- États distincts : `signal_post_2020`, `no_signal_observed`, `non_evaluable`, `source_unavailable`. Une source indisponible ne renvoie pas de faux résultat chiffré : les surfaces sont nulles, et l'interface n'affiche pas de faux zéros.
- Routes de candidats, lancement et historique isolées par organisation; rôle `viewer` refusé pour le lancement; points non bufferisés; géométrie non renvoyée dans les réponses de candidats.
- Chaque tentative/résultat est conservé dans `AuditEvent` avec action `plot.deforestation_screened`, acteur, horodatage, objet, états précédent/nouveau et IP. Aucun nouveau modèle/table n'est ajouté.
- Page dédiée dans `/analysis`, affichant provenance, période, résolution, filtres, limites et besoin de revue humaine.
- Aucun changement de géométrie, de statut de parcelle ou d'état de déclaration déclenché par le dépistage.

## NON FAIT

- **Aucun appel GFW live** : aucune clé autorisée n'était disponible pour un test. La forme réelle des réponses, l'unité/agrégation des surfaces et les quotas ne sont donc pas validés.
- Aucune coordonnée réelle de producteur transmise à GFW.
- Aucune migration DB : le périmètre réutilise `AuditEvent`; aucune migration C5 n'est nécessaire ni exécutée. Le scénario de base C3 reste à clarifier avant tout changement de schéma ultérieur.
- Aucune validation juridique ni certification EUDR, aucun déploiement de production.

## TESTS ET VALIDATION TECHNIQUE

- Tests ciblés C5 : **14 réussites** (`GFW_LIVE_ENABLED=false`).
- Suite backend complète : **85 réussites, 0 échec** (`GFW_LIVE_ENABLED=false`).
- Frontend : `npm run typecheck` **réussi**; `npm run build` **réussi**.
- Installation des dépendances frontend via `npm ci` : **0 vulnérabilité signalée**.
- Le CLI probe compile et son garde bloque bien l'exécution sans `GFW_LIVE_TEST_ENABLED=true` (aucune requête réseau dans cette vérification).
- Les tests d'intégration fournisseur utilisent des réponses simulées et valident le contrat attendu en code; ils ne remplacent pas une requête réelle.
- Avertissements backend non bloquants observés : dépréciations `datetime.utcnow`/passlib et configuration de portée par défaut de pytest-asyncio.

## PROBLÈMES ET RISQUES

1. **Validation live manquante** : le code ne doit pas être activé en production avant un test non-production avec une clé autorisée et un polygone synthétique/public.
2. **Limite d'interprétation** : une perte de couvert arboré de 30 m, annuelle, ne prouve pas une conversion de forêt vers un usage agricole au sens EUDR. L'année 2021 ne fournit pas le jour exact et reste marquée comme incertaine près du 31/12/2020.
3. **Dépendance à la version** : le mapping de seuil est documenté pour `v1.13`; une nouvelle version doit faire l'objet d'une vérification du champ avant d'être autorisée.
4. **Décisions méthodologiques** : 10 % comme filtre principal, 30 % comme sensibilité, polygones seulement et traitement prudent de 2021 sont les choix du MVP; ils n'ont pas reçu chacun une confirmation séparée.
5. **Avertissements techniques** : 238 avertissements de dépréciation furent rapportés sur la suite backend; ils n'ont pas causé d'échec mais méritent un chantier de maintenance.
6. **Base** : l'inventaire C3 n'est pas clarifié. Ce n'est pas un bloqueur pour C5 tel qu'implémenté, mais reste un préalable à toute migration ultérieure.

## PROCHAINE ÉTAPE

1. En environnement non-production, injecter la clé autorisée via un gestionnaire de secrets (ne pas la coller dans le chat ni dans la ligne de commande), puis lancer depuis `backend/` le probe `python scripts/probe_gfw_contract.py --confirm-synthetic-polygon`, avec `ENVIRONMENT=test` et `GFW_LIVE_TEST_ENABLED=true`. Il est limité à un polygone fixe synthétique; les flags de l'application doivent rester `GFW_LIVE_ENABLED=false` et `GFW_CONTRACT_VERIFIED=false`.
2. Vérifier/documenter route, authentification, codes de seuil, années, unités/surfaces, erreurs et quotas. Le probe automatique valide le transport et le décodage de réponse, pas la précision scientifique ni les surfaces sur une parcelle réelle.
3. Après revue du test et décision explicite, seulement alors envisager `GFW_CONTRACT_VERIFIED=true` et `GFW_LIVE_ENABLED=true`. Confirmer également les choix méthodologiques avant activation métier. Ne pas lancer de migration sans changement de schéma requis et sans base cible explicitement identifiée.

## Fichiers principaux

- `CHANTIER_5_AUDIT_PLAN.md` — audit, plan et état détaillé.
- `backend/app/services/satellite/deforestation_screening.py` — service et mapping GFW versionné.
- `backend/app/api/v1/endpoints/deforestation_screenings.py` — routes, isolation tenant et audit trail.
- `backend/tests/test_chantier5.py` — tests C5.
- `backend/scripts/probe_gfw_contract.py` — probe manuel protégé, non exécuté.
- `frontend/src/app/(app)/analysis/page.tsx` — interface C5.
