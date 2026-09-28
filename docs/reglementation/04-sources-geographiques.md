# Chantier 4 — vérification préalable et qualification des sources

Consultation : 28 septembre 2026. Qualification **pour comparaison géographique indicative uniquement**, pas pour preuve de pays réel, de propriété ou de conformité EUDR.

## Références effectivement relues

- Texte officiel consolidé : https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226 ; article 2(28), article 3, articles 9 et 10. Le pays de production et la géolocalisation sont des informations distinctes. Une intersection avec un référentiel ne satisfait pas les exigences de preuve de légalité ou d’absence de déforestation. Le seuil reste **plus de 4 ha hors bovins**, sous réserve du régime applicable.
- La modification de l’annexe produits 2026/2102 identifiée au chantier 3 n’est pas un référentiel géographique et n’est pas utilisée pour classifier les produits dans ce chantier. Aucun nouveau classificateur réglementaire.
- Documentation API geoBoundaries : https://www.geoboundaries.org/api.html . gbOpen est annoncé compatible CC BY 4.0 ; gbHumanitarian peut avoir des licences moins ouvertes ; gbAuthoritative est annoncé non utilisable commercialement. Ces deux derniers produits ne sont pas activés.
- Attribution : https://www.geoboundaries.org/index.html . Référence demandée : Runfola, D. et al. (2020), geoBoundaries: A global database of political administrative boundaries, PLoS ONE 15(4): e0231866, https://doi.org/10.1371/journal.pone.0231866 . Afficher geoBoundaries et un lien sur la page des résultats.
- Conditions de la source primaire Natural Earth : https://www.naturalearthdata.com/about/terms-of-use/ . Domaine public, usage commercial permis, aucune garantie d’exactitude ou d’adéquation à un usage particulier.

## Deux échantillons réellement téléchargés et figés

Métadonnées publiques consultées :
- https://www.geoboundaries.org/api/current/gbOpen/CIV/ADM0/
- https://www.geoboundaries.org/api/current/gbOpen/FRA/ADM0/

Les URL `current` ne sont pas des versions reproductibles. Les GeoJSON téléchargés sont donc épinglés au commit amont **9469f09592ced973a3448cf66b6100b741b64c0d**, avec octets source et empreinte SHA-256 conservés dans `backend/reference/geoboundaries/`. Aucune simplification ni réparation appliquée.

| Couche | Métadonnées publiées | Décision |
|---|---|---|
| CIV-ADM0-2848817 | Côte d’Ivoire ; année représentée 2018 ; Natural Earth ; source primaire Public Domain ; build du 12/12/2023 ; 1 entité, 1 599 sommets annoncés | Admissible au prototype de comparaison **indicative**, avec attribution geoBoundaries, année et limites visibles. Aucune précision métrique garantie. Pas de validation cadastrale ni de statut réglementaire favorable. |
| FRA-ADM0-40433807 | France ; année représentée 2016 ; geoBoundaries/Wikipedia ; source primaire CC0 ; build du 12/12/2023 ; 1 entité, 3 492 sommets annoncés ; URL primaire tronquée à `commons.wikimedia.org/wiki/File` | **Non retenue pour les contrôles applicatifs** : provenance primaire insuffisamment précise et couverture France entière non démontrée. Conserver seulement comme échantillon de qualification rejetée. Ne pas assimiler son emprise à toute la France et ne pas conclure qu’un point ultramarin contredit un pays FR. |

Les données sont anciennes même si leur téléchargement est récent. `retrieved_on`, `buildDate` et `boundaryYearRepresented` ne sont pas interchangeables. L’API `current` consultée ne prouve pas qu’une frontière est juridiquement actuelle.

## Contrat retenu pour le premier incrément

- Entrée : source locale inscrite explicitement dans un manifeste, nom/version/URL/licence/attribution/année/empreinte obligatoires ; pas d’URL contrôlée par un utilisateur, pas de téléchargement pendant un calcul.
- Validation séparée des parcelles : un pays dépasse évidemment le plafond de 100 000 ha d’une parcelle ; ne pas détourner ce plafond. Géométrie pays bornée, 2D, WGS84, finie, polygones fermés et topologiquement valides via PostGIS ; pas de réparation silencieuse.
- Refuser les octets modifiés, les clés JSON répétées, structures ambiguës, pays inconnus, géométries corrompues, budgets dépassés et sources non autorisées par le manifeste.
- Référentiel absent ou pays non couvert : **NON COUVERT / NON ÉVALUÉ**, jamais « conforme » ni déduction d’un autre pays.
- Géométrie couverte par la source : **DANS LE RÉFÉRENTIEL — INDICATIF**, pas « pays vérifié ».
- Intersection partielle ou avec une limite : revue humaine ; chevauchement administratif et litige réel sont distincts.
- Une marge de proximité de frontière doit être fournie et enregistrée explicitement par le pilote. C’est un paramètre de revue technique, pas une mesure de précision de la source et pas un seuil EUDR. Aucun chiffre de confiance inventé.
- L’analyse conserve pays déclaré, identifiant/version/empreinte source, instant de calcul, version de méthode et limites. Elle ne modifie pas la déclaration ni les révisions historiques.

## Limites et suite obligatoire

Ce téléchargement ne livre ni une couverture mondiale, ni une vérification administrative officielle. La Côte d’Ivoire est un **échantillon pilote**, pas un pays prioritaire supposé du client. France et tous les autres pays restent non couverts par ce premier incrément.

Avant livraison du chantier 4 : étendre/qualifier le catalogue selon les sources admissibles, intégrer le stockage des analyses et les permissions/API/UI, afficher l’absence de couverture sans ambiguïté, tester les frontières et indisponibilités, puis effectuer la recette complète. Aucun fond cartographique externe ou connecteur satellite activé.

## Extension mondiale décidée et qualifiée après le pilote

Le propriétaire a choisi **couverture mondiale indicative**. Le pilote CI est remplacé dans le catalogue actif par **Natural Earth 1:10 millions Admin 0 Map Units**, domaine public ; les anciens résultats geoBoundaries restent inchangés.

Sources effectivement consultées :
- https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/ : le fournisseur distingue countries et map units et recommande ces dernières pour distinguer les outre-mer français. Le fichier countries initialement examiné n’est donc pas retenu comme artefact de calcul.
- https://www.naturalearthdata.com/about/disputed-boundaries-policy/ : représentation par défaut de facto, variantes de points de vue possibles ; ce n’est pas un arbitre juridique de souveraineté.
- Conditions d’usage Natural Earth déjà relues ci-dessus : domaine public, usage commercial permis, sans garantie d’exactitude/adéquation.

Téléchargement réel de `ne_10m_admin_0_map_units.geojson`, épinglé au commit **f1890d9f152c896d250a77557a5751a93d494776** du dépôt natural-earth-vector, tag du dépôt v5.1.2, date de commit 13/05/2022. **Ce n’est ni une date de validité juridique des frontières ni une année représentée universelle.** Le terme 10m signifie échelle 1:10 millions, pas résolution métrique de dix mètres. Aucune dernière version ou exactitude en 2026 n’est proclamée.

Qualification et dérivation documentée : source brute inchangée conservée, empreinte `57da82be755f4afccd8f3b14251bb2752f5df1395f47d2d86f817470c4a48862`. Groupement selon ISO_A2_EH du fournisseur ; composantes valides dissoutes explicitement par PostGIS pour supprimer leurs frontières internes. Pas de réparation de contour invalide, simplification ou reprojection. Les noms d’unités/identifiants NE et empreintes des fichiers dérivés sont conservés dans le manifeste ; la version du préparateur PostGIS y figure.

**246 codes ISO de pays et territoires admis**, chacun testé en structure, empreinte et topologie. **Exceptions explicites :** AQ (étendue polaire non prise en charge), EG (géométrie amont invalide), UM (aucune unité ISO non ambiguë). **18 unités non ISO/non rattachées sont listées et non réaffectées par supposition.** La liste figure dans `backend/reference/naturalearth/manifest.json`.

France (FR) et Guyane (GF) sont distinctes dans cette source. L’admission de la nouvelle source FR ne réhabilite pas le snapshot geoBoundaries FRA précédemment rejeté. Les conventions ISO de cette source ne résolvent pas à elles seules la bonne déclaration juridique d’un produit ou une revendication territoriale.

Tous les résultats restent **indicatifs**, sans pays vérifié ni score réglementaire. Les frontières/côtes/îles, unités disputées ou exclues, ancienneté et limites cartographiques nécessitent une revue humaine. Une zone située hors d’un contour n’est pas une fraude démontrée. Le calcul ne fait aucun appel externe et aucune réanalyse historique automatique.
