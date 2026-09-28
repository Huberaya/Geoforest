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
