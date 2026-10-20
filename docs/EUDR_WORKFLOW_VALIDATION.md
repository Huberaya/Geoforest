# Validation du workflow EUDR

Date de validation : 08/10/2026 · Branche : `arena/c73246d2-geoforest`.
Périmètre : parcours qui va de la parcelle à la déclaration interne, et son refus lorsqu'une
condition n'est pas remplie. **Ce document ne valide pas la conformité juridique du produit**
(non revue par un juriste) et **ne constate aucune transmission officielle à TRACES NT**.

## 1. Chaîne de décision

```
Fournisseur ──► Parcelle (plot) ──► Analyse satellite (parcel_audit) ──► Dossier DDS
      │                 │                    │                              │
  (saisie)       (géométrie validée)   (verdict + provenance)        (readiness calculée)
      │                                                                     │
  Pièces ───────────────────────────────────────────────────────────────────┘
  (déposées, condensat SHA-256, validées par la conformité)
```

Le dossier ne déclare rien par lui-même. Son état est **calculé** à partir des faits rattachés.

## 2. États du dossier (`due_diligence_statements.status`)

Transitions autorisées (`src/app/api/v1/due-diligence/[id]/route.ts`) :

| De | Vers |
|---|---|
| DRAFT | MISSING_DATA, IN_ANALYSIS, ARCHIVED |
| MISSING_DATA | DRAFT, IN_ANALYSIS, ARCHIVED |
| IN_ANALYSIS | UNDER_REVIEW, RISK_IDENTIFIED, MISSING_DATA, ARCHIVED |
| UNDER_REVIEW | RISK_IDENTIFIED, ACTION_REQUIRED, **READY_FOR_DECLARATION**, IN_ANALYSIS, ARCHIVED |
| RISK_IDENTIFIED | ACTION_REQUIRED, UNDER_REVIEW, ARCHIVED |
| ACTION_REQUIRED | UNDER_REVIEW, RISK_IDENTIFIED, ARCHIVED |
| READY_FOR_DECLARATION | UNDER_REVIEW, ACTION_REQUIRED, ARCHIVED |
| DECLARED | ARCHIVED |
| ARCHIVED | DRAFT |

**Porte de sortie vers READY_FOR_DECLARATION** : le dossier doit être en `UNDER_REVIEW` **et** la
readiness doit être `READY_FOR_REVIEW`. Sinon : 409, avec la liste des blocages et des manquants.
**Dossier figé** : `READY_FOR_DECLARATION` et `DECLARED` refusent tout rattachement ou détachement
d'analyse (il faut repasser le dossier en revue).

Note : `DECLARED` existe dans l'énumération mais **aucune route ne le pose** : la déclaration
officielle n'est pas implémentée.

## 3. Readiness (`src/lib/eudr/readiness.ts`)

Fonction pure, sans accès base. Neuf contrôles :

| Code | Contrôle | Gravité si non satisfait |
|---|---|---|
| fournisseur | Fournisseur rattaché | MANQUANT |
| produit | Produit rattaché | MANQUANT |
| poids_net | Poids net > 0 | MANQUANT |
| parcelles_analysees | Au moins une analyse rattachée | MANQUANT |
| geometries | Aucune géométrie invalide | MANQUANT |
| analyses_probantes | Toute analyse est probante (source officielle) | **BLOCAGE** |
| deforestation | Aucune perte post-2020 établie | **BLOCAGE** |
| pieces_valides | Au moins une pièce valide liée au fournisseur ou aux parcelles | MANQUANT |
| pieces_expirees | Aucune pièce obligatoire (LAND_TENURE, HARVEST_PERMIT) expirée | **BLOCAGE** |

**États** : `BLOCKED` (au moins un blocage) › `INCOMPLETE` (au moins un manquant) › `COMPLETE`
(tout satisfait, dossier non soumis) › `READY_FOR_REVIEW` (complet, en revue) › `READY_FOR_DDS`
(complet, validé). `READY_FOR_DDS` signifie « prêt à être soumis à un humain habilité » ; il ne
signifie **pas** « déclaré ».

**Risque expliqué** : cinq facteurs, chacun avec son niveau et sa raison (géographique,
déforestation, documentaire, traçabilité, complétude). Le niveau global est le plus grave des facteurs.
Échelle : `LOW < STANDARD < HIGH < CRITICAL`. Une analyse non probante donne « déforestation : HIGH »
(jamais LOW) ; une déforestation établie donne CRITICAL.

**Champs dénormalisés** (`risk_level`, `completeness_score`, `plots_count`, `total_area_ha`) :
recalculés par le serveur après chaque modification. Les saisir manuellement renvoie 409 :
c'est ce qui permettait de présenter un dossier « risque LOW, complétude 100 % » sans données.

## 4. Rattachement des analyses

- `POST /api/v1/due-diligence/{id}/audits` `{ audit_id }` : rattache une analyse. Refus : analyse
  d'une autre organisation (404, même réponse qu'une analyse inexistante), analyse déjà rattachée à ce dossier (409), dossier figé (409).
- `DELETE /api/v1/due-diligence/{id}/audits/{auditId}` : détache. L'analyse n'est **jamais effacée**.
- `POST /api/v1/audit/parcel` accepte `plot_id` et `due_diligence_id` : l'analyse est rattachée à
  la création, la parcelle est mise à jour, et la readiness du dossier est recalculée.
- Statut de la parcelle : déduit de la dernière analyse. Une analyse non probante laisse la
  parcelle en `PENDING`. Une analyse probante pose `COMPLIANT` ou `NON_COMPLIANT`.

## 5. Export TRACES

`POST /api/v1/export/traces` (TypeScript et FastAPI, mêmes règles) refuse, par ordre :
1. analyse introuvable (404) ;
2. géométrie invalide (409) ;
3. analyse non probante (409, avec `is_probative: false`, distinguant simulation et indisponibilité) ;
4. parcelle déforestée post-2020 (409, `blocked: true`).

Un export réussi produit un **document d'export**. Il ne constitue pas une soumission : aucun appel
à TRACES NT n'existe dans le produit. Les messages ne doivent pas dire « soumis » ou « transmis ».

## 6. Ce qui est validé, et comment

| Règle | Validation | Résultat |
|---|---|---|
| Aucun verdict sans source probante | E2E-002, E2E-007 ; pytest `test_api_audit_without_source_is_unavailable` | Validé |
| Dossier avec analyse non probante bloqué | E2E-003 | Validé |
| READY_FOR_DECLARATION refusé sans revue ni complétude | E2E-004 | Validé |
| Champs calculés non saisissables | E2E-004 | Validé |
| Rattachement tenant-safe, pas de doublon, dossier figé | E2E-005, E2E-006 | Validé |
| Export refusé pour non probant et déforestation | E2E-007 (cas non probant) ; pytest `test_export_non_compliant_bloque` (cas déforestation, moteur FastAPI) | Validé pour le non probant. Le cas déforestation **n'est pas** exercé de bout en bout (pas de source probante disponible) |
| Logique de readiness | `check-readiness.ts` : 40 contrôles | Validé |
| Calcul de risque expliqué | `check-readiness.ts` (facteurs, raisons, niveaux) | Validé |

## 7. Limites et écarts constatés

- **Échelle de risque** : le brief attend `LOW / MEDIUM / HIGH / UNKNOWN`. Le produit utilise
  `LOW / STANDARD / HIGH / CRITICAL` pour le dossier, et `HIGH` par défaut pour une analyse
  indisponible. `UNKNOWN` n'est pas un niveau de sortie. Écart à trancher (point ouvert, cf. `PRODUCTION_READINESS_REPORT.md` §7).
- **Pièces** : la readiness ne tient pas compte de `scan_status` (sauf l'interdiction de valider une
  pièce `INFECTED`). Voir `EVIDENCE_ENGINE_SPEC.md` §3.3.
- **Statut de la parcelle** : déduit de la **dernière** analyse rattachée, pas de la pire. Une
  nouvelle analyse non probante remplace un verdict probant antérieur sur la parcelle (l'historique
  reste dans `parcel_audits`). Politique à valider par la conformité.
- **Fournisseur** : le parcours fournisseur (portail) n'est pas couvert par le parcours E2E
  (aucun compte fournisseur dans le jeu de test).
- **Validité juridique** : non évaluée par un juriste.
