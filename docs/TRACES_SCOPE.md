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

## 5. Machine d'état
`DRAFT → INCOMPLETE → READY_FOR_REVIEW → UNDER_REVIEW → READY_FOR_DECLARATION → EXPORTED`.
`SUBMITTED` et `DECLARED` ne sont pas atteignables dans le périmètre actuel.
