# ADR 004 — Cadrage du moteur géospatial de référence

28 septembre 2026 · GO utilisateur reçu après publication du chantier 3.

**Statut : périmètre mondial indicatif choisi par le propriétaire, intégré et recetté localement ; application 0.5.0 / migration 0004.**

Le noyau local est exposé par des routes OIDC autorisées ; résultats persistants append-only, liés à la révision de parcelle. Le snapshot français geoBoundaries reste rejeté ; un autre référentiel, Natural Earth Map Units, fournit désormais 246 codes ISO, dont FR et GF distincts, avec exceptions AQ/EG/UM. Aucun fond externe ou source satellite activé. Voir `docs/rapports/04-chantier-4.md`.

Branche : `chantier-4/gis-sources`, issue de `106cfa3c7afa0b4716930ca78f3a58a69f196fad`.

## Dépendances et état de départ

Le chantier 3 fournit déjà PostGIS, des géométries versionnées, les surfaces géodésiques, les validations bornées, les relations spatiales autorisées et la simulation non destructive à six décimales. Réutiliser ce socle, sans créer un deuxième moteur autoritatif ni réécrire les résultats historiques.

Le chantier 4 doit apporter la cohérence géographique avec des référentiels qualifiés et des règles versionnées. La déforestation et les connecteurs satellite relèvent du chantier 5, pas de cette étape.

## Ordre de travail

1. **Vérification préalable** : relire les sources officielles EUDR pertinentes et les documents techniques actuels ; sélectionner des candidats pour les frontières administratives. Documenter licence, usage commercial, couverture, résolution, date, version, provenance et zones disputées. Aucun candidat n’est considéré qualifié à ce stade.
2. **Décisions techniques** : définir le contrat de référentiel, son ingestion contrôlée, ses empreintes et versions ; déterminer si une migration 0004 est nécessaire avant de l’écrire. Définir les seuils de tolérance et leur justification, pas de seuil arbitraire présenté comme réglementaire.
3. **Moteur** : cohérence pays déclaré/géométrie, points proches de frontières, polygones traversant plusieurs pays, absence de couverture, territoires et ambiguïtés. Un échec de source ou une ambiguïté doit produire un état explicite, jamais une validation favorable par défaut.
4. **Intégration API/UI** : contrôles sourcés avec date/version/méthode/limites, séparés de la validation géométrique et du statut juridique. Conservation des analyses historiques. Pas de modification automatique du pays déclaré.
5. **Recette** : tests fonctionnels, données corrompues, isolation tenant/fournisseur, provenance, responsive et non-régression ; migration/restauration si le modèle change ; rapport de sortie avant tout chantier 5.

## Fichiers envisagés

- `backend/app/plots/geometry.py` et `services.py` : réutilisation du noyau, séparation nette des contrôles existants et des nouveaux résultats.
- Nouveau module `backend/app/geospatial/` : contrat de source, ingestion et contrôle de cohérence ; emplacement à confirmer après revue du code.
- `backend/migrations/versions/0004_*` seulement après validation du modèle et de la stratégie de reprise.
- `src/components/plots/AnalysisView.tsx` et écrans parcelles : provenance et états expliqués.
- Tests backend/E2E, OpenAPI, documentation des sources et rapport chantier 4.

## Invariants et risques

- Aucun retour aux rectangles de pays du prototype ; ne pas réactiver `archive/prototype`.
- Pays déclaré, cohérence spatiale et origine réelle sont trois notions distinctes.
- Ne pas déduire propriété, légalité, absence de déforestation ou conformité d’une intersection avec une frontière.
- Pas de fond tiers ni de transmission de coordonnées à un service externe sans décision explicite. Privilégier l’analyse locale de référentiels correctement licenciés.
- Polygones simplifiés, îles absentes, zones côtières et territoires disputés peuvent générer de faux écarts. Expliquer l’incertitude, ne pas imposer une interprétation de souveraineté.
- Maintenir les refus explicites des cas non pris en charge (notamment antiméridien/pôles) tant qu’aucune extension n’est réellement testée.
- Aucune exemption réglementaire déduite du pays ou de la commodité seuls ; pas de surface inventée pour un point.
- Aucun objectif de millions de parcelles considéré acquis sans mesure de charge.

## Critères de sortie

Au moins un référentiel géographique effectivement qualifié et reproductible, ou un blocage explicite soumis au propriétaire avant de prétendre livrer la cohérence pays. Résultats et versions traçables, comportement sûr en cas d’indisponibilité, frontières et cas ambigus testés, droits/isolation préservés, non-régression des chantiers précédents, guide et rapport honnête.

**Décision de sortie : livraison locale du périmètre mondial indicatif avec exceptions explicites ; nouveau GO obligatoire avant chantier 5.**
