# Géolocalisation — vérification préalable du chantier 3

Consultation : 28 septembre 2026. Statut : notes de conception, pas avis juridique ni qualification d’un connecteur officiel.

## Sources effectivement consultées

1. [Règlement 2023/1115 consolidé au 26/12/2025](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226), notamment articles 2(15a), 2(27–29), 4a(5), 9(1)(d), 10 et 12.
2. [Documentation GeoJSON de l’Information System EUDR](https://acceptance.eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html), page portant la date de mise à jour du 17 août 2026, consultée intégralement (trois parties).
3. [Publication du règlement délégué 2026/2102](https://eur-lex.europa.eu/eli/reg_del/2026/2102/oj/eng) : notice officielle confirmant la publication JO du 17 septembre 2026 et le statut en vigueur. Il modifie la liste des produits ; la consolidation de décembre 2025 ne doit donc pas servir seule à qualifier l’assujettissement d’un produit. L’annexe détaillée n’a pas été relue dans cette étape, qui ne développe aucun classificateur de produits.
4. [Politique des tuiles OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/), conditions techniques principales consultées : attribution, HTTPS, identification, Referer, cache, absence de préchargement massif ou d’usage hors ligne des serveurs publics ; service sans SLA.

## Conséquences pour la conception

| Point vérifié | Conséquence prévue |
|---|---|
| Article 2(28) : latitude/longitude avec au moins six décimales ; polygone pour parcelles de **plus de 4 ha**, hors bovins | Distinguer représentation géographique, surface déclarée et qualité de mesure. Ne pas remplacer le seuil par « au moins 4 ha ». Pas de promesse d’exactitude GPS déduite du nombre de décimales. |
| Article 2(27) : parcelle définie par propriété immobilière et homogénéité permettant l’évaluation | Ne pas fusionner silencieusement des polygones voisins pour fabriquer une parcelle légale. |
| Article 9(1)(d) : toutes les parcelles et dates/périodes ; bovins : établissements où ils ont été détenus | Relations de traçabilité explicites ; un point GPS courant ne prouve pas la totalité d’une chaîne bovine. Le chantier ne qualifie pas cette exhaustivité. |
| Article 4a(5) : possibilité d’adresse postale pour les micro/petits opérateurs primaires ; définition conditionnelle à l’article 2(15a) | Ne pas affirmer que chaque acteur doit universellement fournir un polygone. L’éligibilité au régime reste à qualifier, pas déduite du type de fournisseur ou du pays seul. |
| GeoJSON : WGS84, longitude puis latitude | EPSG:4326 ; plages vérifiées ; aucune inversion ou reprojection implicite d’un fichier ambigu. |
| Documentation IS : points, polygones, multi-géométries ; lignes non acceptées ; anneaux fermés ; trous non pris en charge | Le sous-ensemble importé par GeoForest sera explicite. Validité PostGIS et compatibilité du futur échange officiel seront deux résultats distincts. |
| IS : troncature à six décimales, pouvant invalider une géométrie | Conserver la source ; simuler et contrôler la transformation séparément. Aucune réparation silencieuse, aucun écrasement de l’original. |
| IS : Area d’un point facultative et valeur par défaut de 4 ha | **Ne jamais inventer 4 ha dans GeoForest**. Surface non connue reste non connue. |
| IS : propriétés ProducerName, ProducerCountry, ProductionPlace, Area ; Type II impose ProducerCountry par Feature | Conserver les propriétés reconnues et leur provenance ; ne pas inférer le pays réel à partir d’une déclaration. L’export officiel appartient à un chantier ultérieur. |
| IS : limite technique de 25 Mb pour les GeoJSON d’une DDS | Ne pas confondre cette limite avec les quotas de sécurité plus petits du MVP GeoForest. |

## Ambiguïtés du guide technique à ne pas recopier

- Un exemple Point est présenté avec un niveau de tableau supplémentaire ; le parseur doit appliquer la structure GeoJSON correcte, pas reproduire cette anomalie.
- Un exemple de troncature présente une latitude hors plage. Il ne justifie pas d’accepter des latitudes supérieures à 90°.
- La section des solutions de contournement parle de parcelles « under 4 hectares » ; le seuil normatif de l’article 2(28) reste **plus de 4 ha** pour l’obligation de polygone hors bovins.
- Le texte sur les concavités et « overlapping sides » est imprécis : ne pas assimiler toute concavité valide à une auto-intersection. La compatibilité réelle de cas limites demandera une recette sur l’environnement officiel autorisé.

## Frontières du chantier

Validation technique et avertissements explicables seulement. Pas de géocodage inversé ni de vérification administrative du pays sans jeu de frontières qualifié ; pas d’évaluation de déforestation/légalité/risque ; pas de déclaration aux autorités ni de statut « accepté par TRACES » sans essai effectivement réalisé.

Le fond de carte sert à la navigation, pas de preuve réglementaire. Le fournisseur de tuiles peut connaître l’IP du navigateur et les zones affichées ; les attributs et géométries métier ne doivent pas lui être transmis comme payload. Choix de confidentialité à faire avant activation d’un fond tiers.
