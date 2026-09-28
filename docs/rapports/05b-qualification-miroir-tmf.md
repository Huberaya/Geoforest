# Qualification technique du miroir JRC TMF

28 septembre 2026 · décision utilisateur `qualify_mirror` · chantier 5

## Décision et portée

**Admis pour observations indicatives à la demande**, sous contrôles de chaque lecture. Distribution : Epoch via Source Cooperative, `https://data.source.coop/epoch/jrc-tmf/v1_2025/{tile}/{layer}.tif`. Trois couches fermées : `DeforestationYear`, `DegradationYear`, `AnnualChange_2020`. Pas d’URL choisie par un utilisateur, pas de téléchargement primaire de secours, pas de compte/service payant engagé. L’activation serveur `FOREST_ANALYSIS_ENABLED` demeure désactivée par défaut.

Cette admission n’est ni une certification de tous les pixels, ni une validation terrain, ni une approbation du miroir par la Commission européenne. Les données d’un fournisseur tiers restent un risque de disponibilité et d’intégrité. Les pixels extraits et leurs empreintes sont conservés, indépendamment d’une disponibilité future du miroir.

## Licence, provenance et transformations

- Primaire : https://forobs.jrc.ec.europa.eu/TMF/resources/tutorial/gee — section License and Attribution : données gratuites, sans restriction d’utilisation ; attribution cartographique « Source: EC JRC ». Citation : Vancutsem et al., 2021, *Science Advances*, DOI `10.1126/sciadv.abe1603`.
- Métadonnées primaires téléchargées : `backend/reference/tmf-mirror/official-*.xml`, URLs et SHA-256 dans `official-reference-downloads.json`. Elles indiquent « No limitations on use / No other restrictions », mais leurs dates anciennes ne prouvent pas à elles seules la sémantique de l’édition 2025.
- Tutoriel primaire actuel : collection `projects/JRC/TMF/v1_2025/AnnualChanges`, classes 1 forêt humide non perturbée, 2 dégradée, 3 déboisée, 4 régénération, 5 eau, 6 autres couverts. Zéro non utilisé comme preuve de non-événement. Les champs d’année décrivent le **premier** événement, pas toutes les récidives.
- Les QML primaires téléchargés sont conservés, mais celui des changements annuels expose une rampe interpolée et non un dictionnaire sémantique fiable. Le tutoriel primaire, pas cette rampe, justifie les classes.
- README du miroir : https://source.coop/epoch/jrc-tmf/README.md ; copie `mirror-readme.md`. Epoch déclare passage en COG ZSTD, pyramides nearest et retournement des rasters south-up avec correction du géoréférencement, sans rééchantillonnage des pixels natifs. Ces déclarations ne sont pas une vérification exhaustive du reconditionnement.
- Attribution complémentaire explicite Epoch / Source Cooperative, non-approbation UE. Ne pas présenter « Copernicus/JRC open data » comme une nouvelle licence contractuelle inventée ; le droit d’utilisation est documenté par les sources JRC ci-dessus. Aucun logo UE utilisé.

## Vérifications exécutées

| Contrôle | Résultat / preuve |
|---|---|
| HEAD / Range réel | 200 puis 206 exact de 16 octets ; `jrc-mirror-probe.json` |
| If-Match volontairement incorrect | HTTP 412 ; `jrc-mirror-condition-probe.json` |
| Version | ETag fort multipart, validateur opaque **pas MD5 du fichier** ; If-Match et contrôle ETag pour chaque GET ; pas de génération GCS pour ce miroir |
| Grilles | 86 en-têtes DeforestationYear inspectés, 0 exclu ; EPSG:4326, uint16, pas natif `0.00026949458523585647`, alignement global, tailles/blocs bornés |
| Catalogue | Index parquet SHA-256 `243752c8953f09b8da9567eadb7f73a74ece4ce0de30959951d13819d0464804` ; **86/86 emprises nominales différentes des natives** |
| Manifest natif | `backend/reference/tmf-mirror/qualification.json`, SHA-256 `373f7664ebf992fc1701a2e2fe7d700c4abe6f1f4269b410ea461e2c1546d652` vérifié au chargement ; modification = refus |
| Comparaison primaire | 9 fenêtres de 64×64, soit 36 864 pixels DeforestationYear/N10_W10 concordants ; grille/CRS/dimensions concordants ; `jrc-mirror-primary-comparison.json` |
| Trois couches réelles | Lecture par worker isolé et scénario navigateur réel, contrôles grille/dtype/classes/ETag ; source et preuves persistées dans PostgreSQL puis relues |
| Erreurs et régressions | 112 tests unitaires forestiers, 18 API forestiers inclus dans **604 backend réussis** ; **7 E2E réussis sans skip** |

Le fichier primaire de comparaison de 114 721 845 octets a été téléchargé uniquement pour qualification administrative hors job : SHA-256 `bb71d2508e957a68a3a61617e5d2c9ae3ba3a8bfb34ccf8b6ed57fa02febad1e`. Une première tentative interrompue a été remplacée par le téléchargement complet. Ce fichier de cache n’est pas committé. Une première lecture de comparaison a échoué ; une répétition instrumentée puis la comparaison ont réussi. Disponibilité non garantie, panne jamais remplacée par des pixels zéro.

L’inspection mondiale a porté sur les en-têtes DeforestationYear, pas sur tous les pixels ni tous les en-têtes des trois couches. Les deux autres couches sont vérifiées contre la grille admise **à chaque accès**. La comparaison indépendante au primaire porte sur une seule tuile et une seule couche ; elle ne prouve pas l’exactitude de tous les retournements south-up annoncés.

## Méthode et garde-fous

- Fenêtres natives ≤256×256, 16 au plus ; mêmes budgets partagés 64 Mio / 512 requêtes / 90 secondes et mêmes limites processus que GFC.
- Aucun planificateur GFC réutilisé pour la grille TMF. Intersections à aire positive, trous, masques de bord, absence de rééchantillonnage. Un pixel partagé est affecté à la première tuile du manifeste déterministe ; aux chevauchements, le résultat est partiel et ne permet pas de conclusion négative complète.
- Signal = première année renseignée de déforestation **ou** dégradation ≥2021, union par pixel. Ces deux événements ne sont pas confondus avec la définition juridique EUDR et leurs compteurs restent disponibles séparément.
- Classes annuelles 2020 1/2/4 : contexte TMF interprétable, jamais forêt juridique certifiée au 31 décembre 2020. Autres classes/absence = impossibilité de conclure négativement à l’échelle de l’extrait complet. Zéro signifie aucun événement renseigné dans cette couche, **pas absence prouvée de déforestation**. Pas de contrôle supplémentaire de densité annuelle des observations Landsat.
- Chaque réponse conserve la source choisie, période, empreinte du manifeste, pixels compressés, dtype uint16 ou uint8, transform, sélection/bord, provenance et empreintes de lecture. Une année entière 2005 n’est pas le code GFC 25.
- Années récentes révisables, récurrences incomplètes avec ces couches, 2026 non observée, TMF limité aux forêts tropicales humides. GFC/TMF ne sont pas deux preuves statistiquement indépendantes (Landsat).
- Source, consentement et identifiant de requête liés ; une reprise avec une autre source ne réutilise pas un résultat antérieur. La source du worker est vérifiée avant enregistrement. Sessions/rôles vérifiés avant et après calcul ; RLS et audit inchangés.
- Les coordonnées et noms fournisseurs ne sont pas envoyés au miroir. Les tuiles/blocs et le serveur d’origine peuvent révéler une zone approximative et une adresse réseau ; information visible dans le consentement.

## Requalification

`PYTHONPATH=backend .venv/bin/python scripts/qualify-tmf-mirror.py` nécessite `pyarrow==25.0.1` uniquement pour cette tâche administrative. **Ne pas exécuter dans le répertoire de référence d’un service actif** : un nouveau manifeste modifie son empreinte. Travailler en copie, comparer les changements, examiner licence/provenance/classes/grilles/valeurs, rejouer les tests puis admettre explicitement le nouveau SHA dans le code. Aucune mise à jour automatique de version ou de licence.
