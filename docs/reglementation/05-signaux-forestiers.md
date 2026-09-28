# Chantier 5 — vérification préalable des signaux forestiers

28 septembre 2026. **Candidats examinés ; aucune source forestière encore activée dans l’application.** Cette note ne qualifie pas un moteur de conformité ou un service en production.

## Cadre réglementaire relu

Texte consulté : https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226 — articles 2, 8 à 11. La consolidation est un outil documentaire ; les actes authentiques du JO prévalent. La modification de l’annexe I par 2026/2102 identifiée au chantier 3 reste à prendre en compte pour une future classification produit ; ce chantier ne crée pas de classificateur douanier.

- Art. 2(3) : déforestation = conversion de forêt à un usage agricole, qu’elle soit d’origine humaine ou non.
- Art. 2(4–6) : forêt, superficie, hauteur, couvert et usage du sol sont des critères distincts. Les plantations agricoles ne sont pas des forêts au sens de cette définition. Un seuil de couvert appliqué à un pixel ne suffit donc pas.
- Art. 2(7) : la dégradation forestière a une définition structurelle spécifique, non interchangeable avec tout indicateur satellite nommé « degradation ».
- Art. 2(13) : référence après le **31 décembre 2020** ; exigence supplémentaire liée à la dégradation pour les produits contenant du bois ou fabriqués à partir de bois.
- Art. 9 : informations suffisamment concluantes et vérifiables, géolocalisation et période de production ; art. 10 : fiabilité, validité et liens aux autres preuves ; art. 11 : atténuation si nécessaire.

**Conséquences produit :** aucun verdict « conforme », « déforestation démontrée » ou « risque négligeable » issu du seul raster. Une absence de signal, un point isolé, une lacune de données ou un service en panne ne démontrent rien sur l’intégralité de la parcelle. Les données annuelles ne donnent pas une date journalière de conversion. Un signal de 2020 ne doit pas être classé après le 31/12/2020 ; un signal de 2021–2025 reste un indice à examiner, pas une qualification juridique. Les données arrêtées en 2025 ne surveillent pas 2026.

## Candidat A — Hansen / UMD Global Forest Change v1.13, 2000–2025

Documentation officielle lue intégralement :
- https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/download.html
- Catalogue corroborant les classes : https://developers.google.com/earth-engine/datasets/catalog/UMD_hansen_global_forest_change_2025_v1_13
- Visualisation recommandée pour les liens d’attribution : https://glad.earthengine.app/view/global-forest-change

**Licence : CC BY 4.0**, usage commercial explicitement permis ; crédit « Source: Hansen/UMD/Google/USGS/NASA », lien de licence et indication des transformations. Citation Hansen et al. (2013), Science 342, 850–853.

**Couverture annoncée :** longitudes 180W–180E, latitudes 80N–60S ; les tuiles océaniques ne constituent pas des observations utiles. Tuiles GeoTIFF de 10° × 10°. Résolution nominale de l’ordre de 30 m, pas précision cadastrale. La géotransformation réelle de chaque fichier doit être examinée avant calcul ; ne pas utiliser une constante 900 m² comme surface de pixel partout.

**Couches utiles :**
- `lossyear` : 0 = aucune perte cartographiée ; 1..25 = année principale 2001..2025. **Incohérence documentaire repérée :** la page de téléchargement écrit encore « 1–20 » tout en décrivant 2001–2025 ; le catalogue Earth Engine v1.13 spécifie explicitement 0..25. Vérifier les codes réellement lus ; ne jamais convertir un code inconnu en absence de signal.
- `datamask` : 0 sans données, 1 terre cartographiée, 2 eau persistante ; masque fondé sur 2000–2012, **pas indicateur annuel de visibilité/nuages**.
- `treecover2000` : couvert en 2000 de végétation >5 m, 0..100 %. **Pas état forestier 2020**. Aucun filtre par défaut sur ce couvert ne doit effacer un signal ultérieur dans une forêt apparue après 2000.
- `gain` : gain 2000–2012 seulement ; ne pas le soustraire à une perte récente pour conclure « zéro déforestation ».

**Limites annoncées par le producteur :** changement de capteurs/algorithmes, incohérences temporelles, sensibilité aux feux et rotations de plantations notamment. Le producteur déconseille une estimation définitive de superficie par comptage de pixels. Une surface d’intersection cartographique éventuelle doit être libellée indicative, avec sa méthode et ses limites, pas « hectares de déforestation prouvée ».

### Accès vérifié, sans prétendre avoir analysé les rasters

Trois requêtes HEAD anonymes sur la tuile publique `10N_010W` ont réellement renvoyé HTTP 200. En-têtes et identifiants de génération conservés dans `../rapports/preuves-chantier-5/acces-gfc-head.json`.

| Couche | Taille annoncée, octets |
|---|---:|
| lossyear | 127 404 260 |
| datamask | 15 293 782 |
| treecover2000 | 390 143 175 |

Ce sont les tailles **d’une tuile de recette**, pas le volume mondial. HEAD et `Accept-Ranges: bytes` ne prouvent ni une lecture partielle valide, ni une structure COG, ni une qualification géométrique. Aucun raster complet téléchargé à cette étape. Aucun compte Earth Engine, API commerciale ou frais engagé. La licence des données n’est pas celle d’un service de calcul hébergé.

## Candidat B — JRC Tropical Moist Forests, mise à jour 2025

Source officielle : https://forobs.jrc.ec.europa.eu/TMF/data — sections Update, Data Download, Supporting files, GEE, WMS et License consultées.

Couches annuelles, année de déforestation, année de dégradation et transitions ; **forêts tropicales humides**, pas couverture de tous les types de forêt du monde. Le producteur annonce une mise à jour intégrant 2025 et une utilisation gratuite sans restriction, avec obligation de reconnaissance/citation et renvoi au règlement Copernicus pour les conditions complètes. Ces conditions complètes et la citation exacte restent à archiver avant admission.

**Réserve de version explicite :** la page indique que les métadonnées téléchargeables concernent encore v2024 et ne sont pas actualisées v2025. Ne pas attribuer sans vérification un dictionnaire 2024 aux pixels 2025.

La classification repose notamment sur la durée des perturbations (>900 jours) et peut réviser les années historiques. Les dernières années impliquent des règles particulières ; « deforestation » et « degradation » dans ce produit ne sont pas automatiquement les définitions EUDR. Les deux sources utilisant Landsat, leur accord n’est pas la multiplication de deux preuves statistiquement indépendantes.

**WMS exclu du calcul :** le JRC précise que ces images RGB sont destinées à la cartographie, pas à l’analyse. Aucun raster TMF encore téléchargé ou qualifié ; aucun miroir tiers admis par défaut.

## Conditions avant activation d’un connecteur

1. Vérifier les accès réels, licence/citation, version, classes, CRS, grille, bornes, masques et budget de lecture.
2. Distinguer couverture spatiale, période temporelle et signal ; une couverture partielle peut contenir un signal positif sans autoriser de conclusion négative sur le reste.
3. Conserver preuve extraite, empreinte, identifiant amont, méthode, paramètres et versions logicielles. Une empreinte d’extrait n’est pas une empreinte du fichier amont complet.
4. Fixer une stratégie réseau/stockage autorisée et bornée ; pas d’URL fournie librement par le client, pas de redirection non contrôlée, pas de fuite de géométrie ou d’identifiant client à un prestataire.
5. Qualification sur extraits publics réels et géométries de recette inventées ; tests synthétiques séparés et identifiés. Aucun faux résultat satellite présenté comme réel.
