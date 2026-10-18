# Validation satellite — rapport (B1)

Date : 14/10/2026 · Branche : `arena/c73246d2-geoforest`.

## Statut

**B1 : BLOCKED_EXTERNAL.** Aucune analyse Global Forest Watch (GFW) réelle n'a été exécutée.
Le produit n'émet donc aucun verdict probant validé. Ce document ne déclare aucune conformité.

Cause : le sandbox n'a ni accès à `data-api.globalforestwatch.org` (HTTP 000, constaté à plusieurs reprises)
ni clé `GFW_API_KEY`. L'utilisateur n'a pas pu obtenir l'un ni l'autre.

## Ce qui est vérifié aujourd'hui (sans GFW)

| Cas | Attendu | Obtenu | Preuve |
|---|---|---|---|
| C — géométrie invalide (auto-intersection) | rejet, aucun appel satellite | `REJECTED` (SELF_INTERSECTION) | `scripts/satellite/validate-reference.ts` |
| D — API indisponible | `ANALYSIS_UNAVAILABLE`, jamais COMPLIANT | `UNAVAILABLE` (tentative réelle vers l'hôte officiel : `fetch failed`) | idem |
| Réponse GFW vide | aucun verdict de conformité | `compliant: null`, non probant | `check-eudr-rules` (section « Réponse GFW », 4 contrôles) ; `test_reponse_vide_ne_donne_aucun_verdict` |
| Perte pré-cutoff seule | conforme probant | `compliant: true` | idem |
| 0,4 ha post-2020 | non conforme (aucune tolérance) | `compliant: false` | idem |

Corrections faites pour cela (commit `fcfd594`) :

- **Réponse vide = aucun verdict.** Le moteur TypeScript et le port Python renvoyaient `COMPLIANT`,
  probant, confiance 0,95, pour une réponse sans ligne. Or une réponse vide ne distingue pas
  « aucune perte » de « aucune donnée ». Règle désormais appliquée : zéro ligne → `ANALYSIS_UNAVAILABLE`.
- **Sérialisation des résultats sans verdict.** `AuditSummary.compliant` était typé `bool` ; un résultat
  sans verdict (`None`) provoquait une erreur de validation Pydantic (500). Corrigé : `Optional[bool]`.

Résultat de la run du runner (sans géométries réelles) : `exécutés 2/5 · échecs 0 · non exécutés 3`, code de sortie 2.

## Ce qui reste à faire (exige GFW)

Cas A, B et E. Le runner refuse de déclarer un cas validé tant que sa géométrie et son résultat attendu
ne sont pas fournis.

### Procédure (à exécuter sur une machine ayant accès à GFW)

1. Obtenir une clé GFW officielle (compte développeur Global Forest Watch).
2. Pour chaque cas A, B, E : l'expert renseigne dans `scripts/satellite/reference-cases.json`
   la géométrie réelle **et** `expected_before_run` **avant** toute exécution.
   Ne jamais renseigner ce champ après avoir vu la réponse.
3. Lancer :
   ```bash
   GFW_API_KEY='…' npx tsx --conditions=react-server scripts/satellite/validate-reference.ts
   ```
4. Résultat attendu : `échecs 0 · non exécutés 0`, code de sortie 0.
5. Conserver la sortie, la date, la version du dataset (`evidence.dataset_version`) et les réponses brutes
   dans le dossier d'évidence de la validation.

### Point de décision à trancher avec l'expert avant le cas E

La règle « réponse vide = aucun verdict » est volontairement prudente. Elle a une conséquence : une parcelle
réellement sans perte, si GFW renvoie zéro ligne pour elle, sera classée « aucun verdict » et non « conforme ».
Pour la lever, il faut établir avec GFW que la réponse vide signifie bien « pixels couverts, aucune perte »
et non « hors couverture ». Tant que ce point n'est pas établi, le produit ne peut pas conclure à la conformité
d'une parcelle sans perte. C'est le sens du cas E.

## Limites

- Les cas C et D utilisent des géométries **fictives** (format uniquement). Elles ne représentent pas de parcelle.
- Le cas D ne prouve pas le comportement sous quota dépassé ou réponse HTTP 5xx. Seul l'échec réseau a été observé.
- Aucune validation méthodologique (vérité terrain, comparaison à une source indépendante) n'a été faite.
- Le moteur déterministe (`deterministicCheck`) reste un outil de démonstration. Il ne sert à aucune preuve.


---

## Addendum — revue du moteur forestier (18/10/2026)

Branche de travail : `forest/engine-evidence-chantier-d-2026-10-18` · PR brouillon : [#4](https://github.com/Huberaya/Geoforest/pull/4).

### Corrections apportées, à confirmer par CI

- **Géométrie :** l'aplatissement d'un `Polygon` conserve désormais ses anneaux dans la même surface ; un anneau intérieur ne devient plus une surface positive indépendante.
- **Contrat des données :** les lignes GFW doivent avoir une année entière plausible et une surface finie, positive ou nulle. Une ligne invalide, une surface négative ou un champ `data` qui n'est pas un tableau déclenche l'indisponibilité et ne peut pas produire de conformité.
- **Destination finale :** le moteur vérifie aussi l'hôte de la réponse après redirection HTTP, pas seulement l'URL configurée.
- **Intégrité :** la provenance inclut `rows_sha256`, empreinte SHA-256 des lignes normalisées. Cette empreinte permet de détecter une différence de contenu ; elle n'est ni une signature du fournisseur ni une preuve autonome de vérité.
- **Confiance :** les scores fixes/formulaires non calibrés ont été supprimés. Aucune valeur de confiance chiffrée n'est publiée sans méthode validée.
- **Restitution et export :** les libellés de l'interface et les résumés d'audit décrivent désormais le signal de perte de couvert, sans déclarer une conformité EUDR complète. Le brouillon JSON/XML conserve l'empreinte et la méthode de provenance disponibles, et précise les limites d'interprétation.

### Statut de la preuve réelle

**Toujours BLOCKED_EXTERNAL.** Aucun appel GFW réel concluant n'est revendiqué dans ce chantier. Les tests automatiques simulent les réponses HTTP et vérifient les garde-fous ; ils ne prouvent ni l'accès au fournisseur, ni la couverture d'une parcelle, ni l'exactitude scientifique des détections. Les cas A, B et E restent à renseigner par un expert avec des géométries réelles, un résultat attendu enregistré avant l'appel et une vérité terrain documentée.

### Risque restant avant GO produit

Le niveau de risque pays est encore estimé par boîtes englobantes géographiques. Cette méthode n'est pas une résolution administrative précise des frontières et ne remplace pas la classification officielle de risque pays applicable. Il faut remplacer ou neutraliser cette estimation dans toute décision réglementaire avant de présenter le niveau pays comme une classification EUDR officielle.

La qualification scientifique indépendante, l'accès GFW officiel, la vérification de couverture et la revue juridique restent hors de portée de la CI. Le produit ne doit pas être déclaré prêt à commercialiser sur la seule base de tests verts.
