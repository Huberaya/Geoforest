# Parcelles et géolocalisation — guide utilisateur

Version 0.4.0 · 28 septembre 2026 · chantier 3

## Ce que fait ce module

Il collecte et conserve des géométries, leurs contrôles techniques et leur provenance. Il permet de rattacher un lot à **une révision précise** d’une parcelle. Il ne vérifie ni la propriété, ni le pays réel, ni la légalité, ni la déforestation. Une parcelle « enregistrée » ou une proposition « adoptée » n’est pas une déclaration aux autorités.

- **Manuel** : coordonnées, dessin, choix de fournisseur, revue et rattachement.
- **Assisté** : acquisition GPS à votre demande, import avec aperçu.
- **Automatique, technique uniquement** : validation, surface calculée lorsque possible, recherche de relations dans le périmètre autorisé.
- **À confirmer réglementairement** : assujettissement du produit et de l’acteur, exhaustivité des parcelles/établissements, compatibilité et acceptation d’un futur échange officiel.

## 1. Créer une parcelle dans l’espace entreprise

1. Créez d’abord le fournisseur dans **Fournisseurs**.
2. Ouvrez **Parcelles → Créer une parcelle** ; choisissez le fournisseur, une référence et un nom. Le pays est une déclaration, pas une vérification géographique.
3. Choisissez une méthode :
   - **Coordonnées du point** : saisissez longitude puis latitude ; les valeurs négatives et les virgules décimales sont acceptées dans ces deux champs. Cliquez **Appliquer les coordonnées du point**.
   - **Placer un point** : cliquez sur la carte.
   - **Dessiner un contour** : ajoutez au moins trois sommets, puis terminez le contour. Le dernier sommet est fermé automatiquement ; vous pouvez annuler le dernier sommet avant de terminer.
   - **Utiliser ma position GPS** : autorisez le navigateur. La précision annoncée et la date sont conservées. Un refus ou une indisponibilité ne bloque pas la saisie manuelle. Aucune surveillance GPS continue.
   - **GeoJSON** : pour une géométrie préparée dans un outil SIG, collez une Geometry Point/Polygon/MultiPolygon. Le serveur reste l’autorité de validation.
4. Pour déplacer un point ou les sommets de l’anneau extérieur d’un polygone simple, utilisez les poignées. L’édition graphique est limitée à 200 poignées ; pour trous, multipolygones et contours plus complexes, utilisez GeoJSON ou un outil SIG.
5. Renseignez la matière et la superficie **déclarée** si connues, puis la source/les observations. N’inventez pas une superficie de 4 ha pour un point.
6. Cliquez **Vérifier la géométrie**, lisez erreurs, avertissements et limites, cochez la confirmation, puis enregistrez. Une modification invalide l’analyse précédente ; il faut refaire la vérification.

**La carte n’a pas de fond géographique externe.** La grille n’est pas un cadastre, ses cases ne sont pas une graduation géographique. Aucune requête de tuiles n’est envoyée. Les formes restent navigables et sélectionnables. Un fond contractuel ou auto-hébergé nécessitera une décision et une configuration séparées.

Les six décimales de représentation ne démontrent pas la précision réelle d’un relevé GPS. Vérifiez l’ordre longitude/latitude et le système WGS84/EPSG:4326 de votre source.

## 2. Lire les contrôles

- **Erreur** : géométrie non prise en charge, coordonnées invalides, anneau ouvert, auto-intersection, budget dépassé, etc. Corrigez la source ; aucun ajustement silencieux n’est effectué.
- **Surface calculée** : surface géodésique PostGIS pour un polygone ; séparée de la surface déclarée. Un point n’a pas de surface calculable.
- **Troncature à six décimales** : simulation séparée, sans remplacer votre source. Une géométrie peut devenir invalide après cette transformation.
- **Trous** : conservés s’ils sont géométriquement valides, mais avertissement relatif au guide technique de l’Information System EUDR.
- **Doublon / chevauchement / intersection** : relation technique avec des parcelles auxquelles vous avez accès. Ce n’est ni une fraude démontrée, ni un verdict de risque. Les résultats sont limités ; une indication de troncature signifie que la liste n’est pas exhaustive.
- **Point et seuil de surface** : l’avertissement conditionnel vise les parcelles de **plus de 4 ha hors bovins**, selon le régime applicable. Ce module ne décide pas de votre éligibilité à un régime particulier.

Le pays déclaré n’est pas confronté à des frontières administratives. Les exemples de recette sont volontairement synthétiques en océan ; leur pays déclaré ne constitue pas une preuve de localisation.

## 3. Importer GeoJSON ou KML

1. Ouvrez **Importer GeoJSON / KML**.
2. Choisissez le fournisseur, le format, le pays par défaut et un préfixe de références.
3. Chargez un fichier texte ou collez son contenu. Vérifiez les propriétés reconnues et celles qui sont ignorées.
4. Prévisualisez : examinez les formes, références, erreurs, avertissements et intersections.
5. Confirmez explicitement. L’import est **tout ou rien** ; aucune ligne partielle n’est conservée après un échec.

Limites MVP : **1 Mio de source, 100 éléments, 10 000 positions au total**. Le plafond HTTP des routes géographiques est distinct : 2 Mio, enveloppe JSON comprise. GeoJSON Geometry/Feature/FeatureCollection et le sous-ensemble KML documenté sont acceptés ; pas de SHP, KMZ, NetworkLink, récupération réseau ni XML avec entités/DTD. Les altitudes KML ne sont pas utilisées en 2D et sont signalées.

Le même contenu et les mêmes paramètres, dans le même périmètre, sont rejoués sans créer de doublons. Un changement de contenu, de fournisseur ou de paramètres constitue une autre opération. L’application conserve le texte source privé et son empreinte ; ce n’est pas encore un coffre documentaire général.

Dans le détail d’une **révision issue d’un import**, les rôles autorisés en écriture peuvent télécharger le fichier source. Modifier la parcelle ensuite ne supprime pas l’ancienne révision ni son origine.

## 4. Consulter, modifier et archiver

- Recherchez par nom/référence ; la carte affiche la **page courante**, pas tout le patrimoine. Pagination de 20 éléments dans l’interface.
- **Filtrer sur la zone visible** applique une emprise géographique. Retirez ce filtre pour retrouver les parcelles situées ailleurs, notamment une nouvelle adoption fournisseur.
- Ouvrez une parcelle pour consulter sa révision courante et son historique. Les contrôles affichés sont ceux enregistrés à cette révision, pas une surveillance continue.
- Une modification crée une nouvelle révision. En cas de conflit de version, rechargez et confrontez les changements ; l’application n’écrase pas silencieusement le travail d’un autre utilisateur.
- L’archivage conserve l’historique et les liens existants. Activez **Inclure les archives** pour les consulter. Ce n’est pas une suppression du dossier.

## 5. Rattacher les parcelles à un lot

Dans **Lots**, utilisez l’action **Parcelles** sur la ligne du lot. Seules les parcelles du même fournisseur sont proposées. Rattachez les parcelles choisies puis enregistrez.

Le lot retient une **révision explicite**. Modifier la parcelle de v1 à v2 ne réécrit pas le lot resté sur v1. Adopter une version plus récente nécessite un choix explicite dans le dialogue. Un changement de fournisseur du lot incompatible avec les liens existants est refusé : examinez la traçabilité avant de modifier les associations.

## 6. Fournisseur : proposer sans modifier le référentiel du client

Votre lien sécurisé ouvre votre propre espace. La section **Mes parcelles proposées** est indépendante des trois étapes de collecte initiale : elle ne transforme pas le pourcentage de cette collecte en score EUDR.

1. Proposez un point ou un contour ; saisissez, dessinez ou utilisez le GPS à votre demande.
2. Vérifiez les contrôles, confirmez et enregistrez le brouillon.
3. Relisez puis **Transmettez la parcelle**. Une transmission conserve un snapshot immuable ; elle n’adopte rien automatiquement chez le client.
4. Si le client demande des corrections, lisez sa note, modifiez le brouillon, vérifiez et transmettez à nouveau.
5. Après adoption, la proposition est verrouillée. Contactez le client pour un changement ultérieur du référentiel.

Le portail ne révèle pas les parcelles canoniques ou les autres fournisseurs. Il ne recherche pas les chevauchements avec le référentiel entreprise. Le lien est secret : ne le transférez pas publiquement. Fermez votre accès sur un appareil partagé ; le client peut aussi révoquer le lien.

## 7. Entreprise : revoir et adopter

Seuls **Admin** et **Compliance Manager** peuvent effectuer la revue. Dans **Propositions fournisseurs**, ouvrez la géométrie et les contrôles, et actualisez les relations avec le référentiel si nécessaire.

- **Demander une correction** : rédigez une note exploitable.
- **Adopter** : confirmez explicitement la revue, ajoutez une note et ajustez la référence si nécessaire. L’adoption crée une **nouvelle parcelle** ; elle n’écrase pas une parcelle existante et ne rattache aucun lot automatiquement.

Une référence déjà utilisée provoque un conflit, pas un remplacement implicite. L’adoption n’est ni une certification, ni un statut « déclaré aux autorités ».

## Droits et limites

Admin / Compliance Manager / Procurement : écriture canonique ; Analyst / Viewer : lecture. Supplier OIDC : lecture de son propre périmètre seulement. Le portail fournisseur utilise une session distincte et ne donne pas ces droits d’écriture canoniques.

Polygones traversant l’antiméridien ou dépassant 85° de latitude : non pris en charge. Plafond technique de surface : 100 000 ha, sans rapport avec un seuil réglementaire. Pas de connecteur satellite, analyse de déforestation, validation de pays, export officiel, pièces de légalité ou déclaration EUDR dans ce chantier.

## 8. Comparer le pays déclaré — pilote chantier 4 (version 0.5.0)

Dans le détail d’une parcelle, sélectionnez d’abord la **révision consultée**, puis ouvrez la section **Cohérence pays — comparaison indicative**.

1. Pour les rôles autorisés en écriture, renseignez explicitement la marge de revue en mètres (entier de 0 à 50 000). Ce n’est pas une précision de position ni une exigence légale. Avec 0, seuls les contacts/intersections exacts déclenchent la proximité.
2. Lancez **Comparer le pays de cette révision**. Le pays et la géométrie sont relus côté serveur ; la déclaration n’est jamais corrigée automatiquement.
3. Lisez le résultat, la source, l’année représentée et les limites. Tous les résultats nécessitent une revue humaine et restent « pays non vérifié / risque non évalué ».
4. Consultez l’historique par révision. Une nouvelle révision ne reçoit pas les anciennes analyses ; revenez à l’ancienne pour retrouver son résultat. Les archives restent consultables et peuvent faire l’objet d’une comparaison historique.

**Couverture actuelle : pilote Côte d’Ivoire uniquement**, contour représentant 2018, fourni par geoBoundaries/Natural Earth. Il ne s’agit pas d’une frontière certifiée actuelle ou d’une donnée cadastrale. France et autres pays : **Pays non couvert**, sans inférer un autre pays. Une source illisible, modifiée ou une erreur du calcul donne **Source indisponible**, jamais une correspondance favorable.

« Dans le référentiel » signifie que la géométrie est contenue dans ce contour précis. « Hors du référentiel », « intersection partielle » et « limite géographique » demandent de confronter les données ; aucun de ces messages ne démontre une fausse déclaration ou une fraude.

Le calcul ne consulte aucun service externe. Les liens de source/licence sont accessibles sur clic explicite ; aucun fond cartographique ni suivi GPS supplémentaire n’est activé. Analyst/Viewer et Supplier OIDC ne peuvent que lire les résultats de leur périmètre. Le portail par lien n’expose pas l’historique du référentiel entreprise.
