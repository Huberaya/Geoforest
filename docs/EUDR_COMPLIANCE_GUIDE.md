# GeoForest Trace — Guide de Conformité au Règlement (UE) 2023/1115 (EUDR)

Ce document détaille l'alignement réglementaire strict de **GeoForest Trace** avec les dispositions du Règlement Déforestation de l'Union européenne.

---

## Matrice des Articles EUDR & Implémentation Logicielle

| Article EUDR | Intitulé & Obligation Réglementaire | Implémentation GeoForest Trace |
| :--- | :--- | :--- |
| **Article 2(13)** | **Définition « Zéro-Déforestation »** : Aucune conversion de forêt après le 31/12/2020. | Algorithme de détection temporelle Hansen GFW (30m) & Sentinel-2 ($\Delta \text{NDVI}$) par rapport à la date butoir du 31 décembre 2020. |
| **Article 2(40)** | **Droits des Peuples Autochtones & FPIC** : Respect des droits fonciers coutumiers et consentement libre, préalable et éclairé. | Catégorie documentaire dédiée `FPIC_INDIGENOUS_RIGHTS` dans le coffre de preuves et pilier n°3 de la matrice de risques. |
| **Article 3** | **Conditions de mise sur le marché** : Produits zéro déforestation, produits légalement et couverts par une DDR. | Contrôle bloquant interdisant la validation DDR si un lot est lié à une parcelle non conforme. |
| **Article 4** | **Obligations des Opérateurs** : Exercice de la diligence raisonnée et soumission de la Déclaration (DDS). | Workflow DDR complet à 9 statuts, signature électronique de l'attestation sur l'honneur et calcul de complétude. |
| **Article 8** | **Système de Diligence Raisonnée** : Collecte d'informations, évaluation du risque et réduction du risque. | Parcours en 3 étapes : Collecte $\rightarrow$ Évaluation multi-sources $\rightarrow$ Plan de mitigation documenté. |
| **Article 9** | **Exigences d'information & Géolocalisation** : Coordonnées GPS $\ge 6$ décimales, polygone obligatoire si $> 4\text{ ha}$. | Moteur géodésique WGS84 vérifiant le nombre de décimales, la fermeture du polygone et le seuil de 4 ha. |
| **Article 10** | **Évaluation des Risques** : Prise en compte du risque pays, présence de forêts, droits coutumiers, complexité. | Matrice d'évaluation combinée sur 4 piliers produisant un score de 0 à 100 et un niveau de risque transparent. |
| **Article 11** | **Réduction des Risques (Mitigation)** : Mesures d'atténuation adéquates et proportionnées avant toute mise sur le marché. | Centre de traitement des risques (`/risks`) avec statut de mitigation (*À traiter $\rightarrow$ En cours $\rightarrow$ Résolu $\rightarrow$ Validé*). |
| **Article 12** | **Conservation des Enregistrements (5 ans)** : Obligation de tenue des preuves pour contrôle des autorités. | Piste d'audit immuable (`/audit-logs`) horodatée en base PostgreSQL avec historique des modifications et adresses IP. |
| **Article 29** | **Système d'Évaluation des Pays (Benchmarking)** : Classement Faible, Standard, Élevé par la Commission. | Table des pays de référence intégrant les niveaux de risque par défaut et renforçant les exigences sur les zones à risque élevé. |

---

## Décharge de Responsabilité Réglementaire

*GeoForest Trace est une plateforme SaaS d'aide à la décision, de gestion des risques et d'orchestration de la diligence raisonnée. Les calculs et analyses géospatiales constituent des indicateurs techniques et ne remplacent pas les vérifications physiques sur le terrain ni les audits des autorités compétentes désignées par les États membres de l'UE.*
