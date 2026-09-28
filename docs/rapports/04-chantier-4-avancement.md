# Chantier 4 — premier incrément : sources et noyau de comparaison

28 septembre 2026 · branche `chantier-4/gis-sources`

**CHANTIER EN COURS — pas encore livré dans l’application.** Aucun chantier 5 commencé.

## FAIT

- Relecture préalable ciblée du texte officiel EUDR, notamment géolocalisation, pays de production, distinction information/preuve et analyse du risque.
- Consultation effective des licences et de l’API geoBoundaries, des conditions Natural Earth et des métadonnées de deux couches ADM0 ; conclusions et liens dans [la note de qualification](../reglementation/04-sources-geographiques.md).
- Téléchargement de deux contours publics, épinglés au commit amont `9469f09592ced973a3448cf66b6100b741b64c0d`. Sources brutes, métadonnées, URLs et SHA-256 conservés ; aucune donnée personnelle ni parcelle fournisseur réelle.
- **Côte d’Ivoire : retenue uniquement pour le pilote de comparaison indicative**, représentation 2018, build 2023. Pas de précision métrique garantie, pas de preuve juridique de frontière actuelle.
- **France : écartée des contrôles applicatifs**. Source primaire indiquée de manière incomplète et couverture territoriale entière non démontrée ; ne pas appliquer cette emprise aux outre-mer.
- Lecteur local strict : empreinte vérifiée, 4 Mio / 250 000 positions maximum pour un référentiel, clés JSON répétées refusées, coordonnées finies/2D, anneaux fermés, rejet des cas non supportés et des échappements de chemin. Ces plafonds de référentiel ne remplacent pas ceux des parcelles.
- Reconnaissance explicite de la déclaration historique OGC CRS84 présente dans le fichier (longitude, latitude WGS84). Aucun autre CRS interprété implicitement ; ni reprojection, ni simplification, ni réparation.
- Noyau PostGIS de comparaison en lecture seule : couverture, intersection partielle, distance sphéroïdale à la limite et marge de revue fournie explicitement. **Aucun seuil réglementaire ou précision de source déduit de cette marge.**
- Résultats distincts : dans/hors du référentiel **à titre indicatif**, revue de limite, intersection partielle, pays non couvert, source indisponible. Tous gardent `country_verified:false`, `human_review_required:true` et `regulatory_status:NOT_ASSESSED`.
- Provenance de résultat : empreinte de géométrie, pays déclaré inchangé, version de méthode/PostGIS, source/version/année/empreinte/licence/attribution, date de calcul et limites.
- Échec SQL de la comparaison isolé par savepoint et classé indisponible, jamais transformé en correspondance. Les erreurs préalables de validation de parcelle restent bloquantes.
- Script reproductible `scripts/qualify-geospatial.py`, sans téléchargement ni écriture de données. Références incluses dans la recette de construction de l’image backend ; **image Docker non construite dans cette étape**.

## TESTS EXÉCUTÉS

**201 tests backend réussis**, soit les 152 existants et **49 nouveaux cas** ; PostgreSQL/PostGIS réels. Ruff et format réussis. L’avertissement de dépréciation TestClient/httpx préexistant reste visible.

Les nouveaux tests couvrent le contour public épinglé, les empreintes, source absente/altérée, JSON/CRS/structures invalides, budgets, symlinks, pays inconnu/non couvert, paramètres non finis, frontière exacte, points proches des deux côtés, polygone traversant la frontière, multipolygone disjoint partiellement couvert, trous et topologie invalide. Une erreur SQL injectée vérifie la récupération du savepoint.

Les fixtures de comparaison sont fictives en zone océanique. Le point intérieur utilisé pour tester le contour public ivoirien est un point inventé, **pas une exploitation ou une personne identifiée**. La source française n’est jamais utilisée pour un résultat de comparaison.

Preuves :
- [Suite backend complète](preuves-chantier-4/pytest-increment-1.txt)
- [Ruff et format](preuves-chantier-4/ruff-increment-1.txt)
- [Qualification technique du snapshot ivoirien](preuves-chantier-4/qualification-civ.json)

## NON FAIT — nécessaire avant livraison du chantier 4

- Catalogue géographique plus large et qualification de ses conditions/couvertures. **Aucune couverture mondiale annoncée** ; un seul échantillon admis au pilote.
- Persistance et immutabilité des analyses de cohérence pays, modèle/migration 0004 éventuelle et stratégie de réanalyse des anciennes révisions.
- API métier, permissions et isolation des analyses persistées. Le noyau est explicitement **sans frontière d’autorisation** et n’est exposé par aucune route HTTP.
- Intégration entreprise/portail et affichage des attributions, années et limites dans l’interface.
- Recette navigateur du chantier 4, charge/performance, migration/restauration et audits actualisés de la future intégration.

## BASE / GIT / RISQUES

Aucune migration 0004 créée ou exécutée, aucun changement de schéma et aucune écriture géospatiale persistante de cet incrément. L’application demeure en version 0.4.0 sur le schéma 0003. Aucun push de ce nouvel incrément ; aucun token exposé précédemment réutilisé.

L’année du téléchargement n’est pas l’année représentée. Une source téléchargeable et correctement licenciée ne devient pas une preuve géographique précise. La comparaison indique seulement une relation avec un contour identifié, et non le pays réel, la propriété, la légalité, l’absence de déforestation ou la conformité d’un produit.

**Prochaine étape dans le chantier 4 déjà autorisé :** catalogue/qualification complémentaire et modèle de résultats versionnés, puis API/UI et recette complète. Aucun nouveau GO requis pour poursuivre ce chantier ; un GO distinct restera nécessaire pour passer au chantier 5.
