# Périmètre TRACES — ce que GeoForest fait et ne fait pas

Date : 08/10/2026. Décision de périmètre appliquée : **préparation et export uniquement**
(règle de repli du brief, §17 : aucune intégration officielle TRACES disponible).

## 1. Ce que GeoForest fait
- Prépare un dossier de diligence (readiness, evidence pack, export document).
- Bloque l'export d'une analyse non probante et d'une parcelle déforestée après le cutoff
  (`src/app/api/v1/export/traces/route.ts`, FastAPI `export/traces`).
- Affiche l'état réel : écran « Déclarations » — « Aucune déclaration n'est transmise depuis ce produit »,
  compteur « Transmis : 0 — capacité absente ».

## 2. Ce que GeoForest ne fait pas
- Aucune transmission à TRACES NT. Aucun appel réseau vers un service TRACES n'existe dans le code.
- Aucun identifiant officiel TRACES n'est généré ni stocké.
- Le statut `DECLARED` n'est posé par aucune route.

## 3. Formulations interdites tant que l'intégration n'existe pas
« Submitted », « Soumis à TRACES », « Déclaré », « Officially registered », « Transmis ».
Formulation autorisée : « Préparation de déclaration — soumission officielle non effectuée. »

## 4. Conditions d'une intégration officielle (non engagée)
Authentification au service officiel, transmission, identifiant officiel renvoyé, gestion des erreurs,
retry idempotent, journalisation et audit trail. Chacun doit être testé sur l'environnement officiel,
qui n'est pas accessible depuis le sandbox de cette passe.

## 5. Machine d'état (chantier 3, B-12)
Source unique : `src/lib/eudr/dds-etats.ts`. Vérifiée par `npm run test:unit` (`check-dds-etats.ts`)
et par `npm run test:dds-etats:http` (parcours sur le serveur réel). Les états `INCOMPLETE`,
`READY_FOR_REVIEW` et `READY_FOR_DDS` sont des **états de readiness** calculés, non des statuts
de dossier : ils ne sont pas stockés.

Chemin nominal :
`DRAFT → IN_ANALYSIS → UNDER_REVIEW → READY_FOR_DECLARATION → EXPORTED`.

- `READY_FOR_DECLARATION → EXPORTED` n'est posé **que** par l'export (`POST /api/v1/export/traces`) d'une
  analyse rattachée à un dossier prêt. L'export revérifie la readiness et journalise la transition.
  Un export refusé ne change rien.
- `EXPORTED` signifie « brouillon généré, non transmis ». Sortie : `UNDER_REVIEW` (nouvelle revue) ou `ARCHIVED`.
- `SUBMITTED` (soumission officielle) et `DECLARED` (déclaration officielle, accusé du SI EUDR) :
  **inatteignables**. Aucune action ne les pose, et le PATCH les refuse avec un motif explicite (409).
  Leur atteinte exige une intégration TRACES NT, non réalisée : statut **BLOCKED_EXTERNAL**.
- Un dossier `READY_FOR_DECLARATION`, `EXPORTED`, `SUBMITTED` ou `DECLARED` est **figé** : refus de
  rattacher ou détacher une analyse, et refus de modifier son intitulé ou son poids net (409).
