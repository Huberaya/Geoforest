# Recette de validation externe — EUDR / GFW / SI EUDR

**Document :** « Recette de validation externe (Geoforest, 2026-10-19) »
**Auteur :** Agent Arena.ai (Arena.ai — Agent Mode)
**Statut :** **non exécutée.** Aucune ligne de cette recette n'a été jouée.

> **Avertissement.** Ce document décrit ce qu'il faudrait faire, avec quels
> moyens, pour transformer les vérifications logicielles en validation externe.
> Il ne contient **aucun résultat**. Les suites de tests simulent les réponses
> du fournisseur ; elles ne prouvent pas que Global Forest Watch se comporte
> ainsi.

---

## 0. Ce qui est déjà démontré, et ce qui ne l'est pas

| Déjà démontré (test logiciel) | Non démontré |
|---|---|
| Le moteur refuse une charge utile GFW malformée | Que GFW renvoie ces charges utiles |
| Le moteur ne fabrique pas de verdict sans donnée | Que les données GFW sont exactes ou complètes |
| Le calcul de surface est conforme à `pyproj` | Que la parcelle déclarée correspond au terrain |
| Les règles topologiques sont appliquées | Que le SI EUDR les accepte |
| La trace conserve méthode, version, paramètres, limites | Que cette trace suffise à une autorité |
| Le pays est résolu par des frontières réelles versionnées | Que ces frontières soient celles qu'un contrôle retiendra |

---

## 1. Prérequis à obtenir avant toute exécution

| Élément | Où le consigner | Sans lui |
|---|---|---|
| Clé GFW autorisée, quota connu | coffre-fort de secrets, **jamais** dans le dépôt | recette bloquée |
| Version épinglée du jeu de données (`GFW_DATASET_VERSION`) | cette fiche, champ « version testée » | recette non reproductible |
| Siège GFW réellement appelé (URL finale après redirection) | journal de recette | provenance non opposable |
| Géométrie de référence déboisée connue | fichier GeoJSON + source de la connaissance | impossible de distinguer « pas de perte » de « pas de couverture » |
| Géométrie de référence non déboisée | idem | idem |
| Accès au SI EUDR **ACCEPTANCE** (pas la production) | identifiants nominatifs | recette d'acceptation bloquée |

**Interdits, sans exception :**
- aucune clé fictive ne doit activer le chemin « live » ;
- aucun résultat simulé ne doit être présenté comme un appel réel ;
- aucune écriture sur un environnement de production.

---

## 2. Recette GFW — 7 cas

Pour chaque cas : consigner `date`, `heure UTC`, `URL d'appel`, `version
demandée`, `version servie` (déduite de l'URL finale), `en-têtes de réponse`,
`corps de réponse` (tronqué à 2 Ko), `code de sortie du logiciel`.

### Cas G1 — Réponse nominale

- **Appel** : géométrie de référence déboisée, `GFW_DATASET_VERSION` épinglée.
- **Attendu préenregistré** : `source = "gfw-live"`, `compliant` non nul,
  `is_probative = true`, `provenance.params.version_jeu_de_donnees` égale à la
  version demandée.
- **Critère de succès** : schéma conforme (`data` tableau, lignes
  `{umd_tree_cover_loss__year: entier, area__ha: ≥ 0}`), version identique.
- **Critère d'échec** : version `latest` en retour, schéma inattendu, ou
  `compliant = null` sur une géométrie connue comme déboisée.

### Cas G2 — Perte connue

- **Appel** : même géométrie que G1.
- **Attendu préenregistré** : `compliant = false`, `loss_year` attendu,
  `loss_area_ha` dans la tolérance **à fixer avant l'appel** (proposition :
  ±10 % de la surface connue, ou ±0,5 ha, au plus grand des deux).
- **Critère d'échec** : valeur hors tolérance, ou verdict conforme.

### Cas G3 — Absence de perte

- **Appel** : géométrie de référence non déboisée.
- **Attendu préenregistré** : `compliant = true`, `loss_area_ha = 0`.
- **Critère d'échec** : `compliant = null` (le moteur doit savoir lire une
  réponse vide) — sauf si la géométrie est hors couverture, auquel cas voir G4.

### Cas G4 — Hors couverture (océan)

- **Appel** : point en haute mer.
- **Attendu préenregistré** : réponse vide, `compliant = true` **et**
  `LIMITE_REPONSE_VIDE` présente dans `provenance.limits`.
- **Critère d'échec** : verdict conforme **sans** la limite de couverture.
- **Ce que ce cas ne peut pas prouver** : la distinction entre « aucune perte »
  et « hors couverture » reste hors de portée d'une requête unique. Le cas
  documente l'indistinction, il ne la lève pas.

### Cas G5 — Panne fournisseur

- **Appel** : clé volontairement invalide, puis quota dépassé, puis délai
  dépassé (`GFW_TIMEOUT_SECONDS=1` sur une emprise large).
- **Attendu préenregistré** : `source = "unavailable"`, `compliant = null`,
  `is_probative = false`, **aucun repli** vers le moteur de démonstration.
- **Critère d'échec** : verdict émis, ou repli silencieux.

### Cas G6 — Version non épinglée

- **Appel** : `GFW_DATASET_VERSION=latest`.
- **Attendu préenregistré** : `LIMITE_VERSION_NON_EPINGLEE` présente dans les
  limites, `provenance` conserve la version **servie**.
- **Critère d'échec** : absence de la limite, ou version non consignée.

### Cas G7 — Cohérence des deux implémentations

- **Appel** : rejouer G1 à G4 sur `POST /api/v1/audit/parcel` (Python) **et**
  sur la route Next.js équivalente.
- **Attendu préenregistré** : mêmes `compliant`, `source`, `is_probative`,
  écarts de surface < 0,01 %.
- **Critère d'échec** : divergence de verdict entre les deux piles.

---

## 3. Recette SI EUDR — 3 cas

### Cas E1 — Dépôt d'un fichier conforme aux règles internes

- **Appel** : GeoJSON à 6 décimales, sans trou, sans auto-intersection,
  surface < 4 ha.
- **Attendu préenregistré** : acceptation, avec numéro d'accusé.
- **Critère d'échec** : refus dont la cause n'est expliquée par aucune règle
  documentée — ce serait la preuve que nos règles sont incomplètes.

### Cas E2 — Polygone à trous

- **Attendu préenregistré** : notre validateur refuse (`POLYGON_WITH_HOLES`).
  Le SI doit **aussi** refuser, ou fournir une spécification autorisant les
  trous. Si le SI accepte, notre refus est trop strict et doit être révisé.
- **Critère d'échec** : nos deux règles divergent sans explication.

### Cas E3 — Point et règle des 4 ha

- **Attendu préenregistré** : point accepté pour < 4 ha, refusé au-delà
  (art. 9(1)(d)).

---

## 4. Recette des frontières — 3 cas

### Cas F1 — Points de contrôle

- **Appel** : `resoudre_pays` sur au moins 20 points de contrôle, dont Tunis,
  Alger, Tanger, Belgrade, Kiev, Pristina, un point en haute mer, un point
  côtier.
- **Attendu préenregistré** : ceux du §4.1, identiques en TypeScript et en
  Python.
- **Critère d'échec** : divergence entre les deux piles, ou attribution d'un
  pays voisin à un point hors couverture.

### Cas F2 — Zone frontalière

- **Appel** : 10 points situés à moins de 500 m d'une frontière.
- **Attendu préenregistré** : le produit peut se tromper ; ce qui est testé est
  qu'il **ne prétend pas** le contraire. La limite de généralisation doit être
  présente dans la provenance.
- **Ce que ce cas ne peut pas prouver** : la justesse cadastrale.

### Cas F3 — Territoire contesté

- **Appel** : Crimée, Cachemire, Sahara occidental.
- **Attendu préenregistré** : le produit rapporte l'attribution du jeu Natural
  Earth (`RU`, `IN`, `MA`) **sans la présenter comme un arbitrage**. Toute
  évolution vers un arbitrage explicite est une décision produit, pas un
  correctif.

---

## 5. Recette terrain — 1 cas

### Cas T1 — Parcelle avec relevé indépendant

- **Éléments à obtenir** : relevé GPS de la parcelle (précision annoncée),
  orthophoto datée, identité de l'exploitant, date de récolte.
- **Attendu préenregistré** : écart de surface < 5 % entre le relevé et le
  calcul géodésique ; concordance de l'occupation du sol.
- **Critère d'échec** : écart non expliqué.
- **Sans ce cas**, aucune affirmation sur la justesse terrain n'est possible —
  et elle n'est faite nulle part dans ce dépôt.

---

## 6. Question juridique non tranchée

Une parcelle dont la récolte est antérieure au 31/12/2020 et qui a subi une
perte postérieure à cette date :

- le moteur **live** la déclare non conforme (la perte post-butoir suffit) ;
- le moteur de démonstration affiche « hors champ temporel ».

Les deux comportements coexistent. **Aucune source ne permet de trancher ici.**
Éléments à obtenir : texte consolidé du règlement (UE) 2023/1115 et de ses
actes d'exécution, position de l'autorité compétente, avis juridique écrit.

Tant que cette question n'est pas tranchée, le comportement du moteur live est
conservateur (il refuse) et la divergence est consignée dans le rapport de
validation.

---

## 7. Journal de recette (à remplir)

| Cas | Date | Opérateur | Version testée | Résultat observé | Verdict |
|---|---|---|---|---|---|
| G1 | — | — | — | — | non exécuté |
| G2 | — | — | — | — | non exécuté |
| G3 | — | — | — | — | non exécuté |
| G4 | — | — | — | — | non exécuté |
| G5 | — | — | — | — | non exécuté |
| G6 | — | — | — | — | non exécuté |
| G7 | — | — | — | — | non exécuté |
| E1 | — | — | — | — | non exécuté |
| E2 | — | — | — | — | non exécuté |
| E3 | — | — | — | — | non exécuté |
| F1 | — | — | — | — | non exécuté |
| F2 | — | — | — | — | non exécuté |
| F3 | — | — | — | — | non exécuté |
| T1 | — | — | — | — | non exécuté |

---

*Document « Recette de validation externe (Geoforest, 2026-10-19) » établi par
**Agent Arena.ai** (Arena.ai — Agent Mode). Aucun cas n'a été exécuté.*
