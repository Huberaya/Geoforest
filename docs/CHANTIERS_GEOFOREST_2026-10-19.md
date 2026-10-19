# Rapport d'exécution — GeoForest, chantiers 1–3

Date : 19/10/2026

## Périmètre et garde-fous

- Dépôt : `Huberaya/Geoforest`
- Branche de travail isolée : `forest/chantiers-1-2-3-audit-2026-10-19`
- PR de suivi : #6, brouillon, cible `forest/country-risk-neutralization-2026-10-18`
- Aucun merge, changement de `main`, secret ou déploiement de production n'est effectué dans ce chantier.

## État initial vérifié

- La PR #5 est ouverte, en brouillon et non fusionnée. Son head initial était `c639a2255d4e34ccfbbc3e0475ab20d9924564f0`.
- Le workflow CI associé à ce SHA a terminé avec `success` : job frontend/backend (tests Python, typecheck, lint, tests unitaires, règles EUDR, build) et job DB/HTTP sur une branche Neon éphémère.
- Cette réussite concerne ce SHA uniquement. Elle ne valide pas la preuve GFW réelle ni une conformité EUDR complète.

## Chantier 1 — moteur satellitaire

### Correction apportée sur la branche isolée

Le cas D du runner `scripts/satellite/validate-reference.ts` simulait l'indisponibilité avec une clé API factice, mais laissait `fetch` effectuer un appel réel. Le résultat dépendait du réseau et pouvait contacter GFW inutilement.

Le cas D remplace maintenant temporairement `globalThis.fetch` par une fonction qui rejette avec une erreur réseau simulée. Un bloc `finally` restaure `fetch` et la valeur d'origine de `GFW_API_KEY` (ou supprime la variable si elle n'existait pas). Cela rend le test déterministe et évite d'utiliser une clé factice après le cas D.

### État de vérification

- Code poussé sur la branche de travail isolée.
- Vérification réalisée sur le head `0c74c5e0c876b25aa80ff470535a7338638902c7` : workflow GitHub Actions `39183371600` terminé avec succès pour les deux jobs. Le job frontend/backend a passé tests Python, typecheck, lint, tests unitaires, règles EUDR et build. Le job Neon éphémère a passé migrations, contrôles DB, parcours end-to-end, contrôles HTTP inter-tenant, parcours fournisseur et nettoyage.
- Le statut Vercel associé à ce head est `success` (Preview prête), pas un déploiement de production.
- Aucun appel GFW réel n'est revendiqué.

## Chantier 2 — protocole de validation

Les cas A, B et E de `scripts/satellite/reference-cases.json` ont encore `geometry: null` et `expected_before_run: null`. Ces cas restent non exécutables tant qu'un expert n'a pas fourni des géométries réelles documentées et pré-enregistré les attentes avant toute requête. Ne pas inventer ni rétro-remplir les attentes après avoir observé les réponses.

Les cas C et D sont des scénarios techniques fictifs : ils testent le rejet de géométrie et l'indisponibilité simulée, pas l'exactitude scientifique des données.

## Chantier 3 — sécurité décisionnelle

Les contrôles existants neutralisent le risque pays approximatif : sans source administrative et benchmark officiel versionné, le pays est `XX` / « Non déterminé » et le risque pays `UNKNOWN`. Les réponses vides ou les erreurs du fournisseur ne doivent pas être interprétées comme une conformité.

Points à maintenir bloqués :
- aucune déclaration de conformité EUDR complète fondée uniquement sur le signal satellite ;
- aucune conclusion de faible risque en l'absence de preuve ;
- aucune validation externe tant que l'accès GFW, la couverture des parcelles, la vérité terrain et les résultats A/B/E ne sont pas documentés.

## Conditions de sortie

Le chantier n'est pas terminé tant que :
1. les contrôles techniques sur le head `0c74c5e0c876b25aa80ff470535a7338638902c7` sont réussis ; un éventuel commit documentaire doit lui aussi repasser la CI ;
2. les cas A/B/E sont renseignés avec des géométries de référence documentées et des attentes pré-enregistrées avant tout appel réel ;
3. la validation GFW réelle est exécutée avec une clé fournie via le secret GitHub Actions `GFW_API_KEY` (ne jamais la coller dans le dépôt ou le chat) ;
4. les limites scientifiques, géographiques et juridiques restent affichées clairement.

Ce rapport ne déclare ni le moteur validé scientifiquement, ni le produit prêt à commercialiser, ni la conformité EUDR.
