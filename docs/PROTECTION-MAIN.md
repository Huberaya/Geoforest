# Protéger `main` — état, preuve, et dette restante

**Dernière mesure : 05/11/2026. Protection vérifiée, C1 clos.**

| Mesure | Valeur |
|---|---|
| Ruleset | ✅ `main`, id `26568220` |
| État d'application | ✅ **`enforcement: "active"`** |
| Branches ciblées | ✅ **`["~DEFAULT_BRANCH"]`** (soit `main`) |
| Bypass | ✅ aucun |
| Règles actives | `deletion`, `non_fast_forward`, `pull_request`, `required_status_checks` |
| Fusion d'une PR à check rouge | ✅ **refusée** (PR #16, mesuré) |
| Checks fantômes subsistants | ⚠️ `contrôles`, `Verify Frontend & Backend` |

---

## 1. La preuve — deux tentatives, deux refus

Test mené sur la PR #16 : une **assertion de test volontairement fausse** dans
`scripts/check-eudr-rules.ts`. Contrairement au test précédent, **aucune valeur
réglementaire n'était touchée** : le seuil reste 4 ha, le validateur est intact.

| Tentative | État de la CI | Réponse de GitHub |
|---|---|---|
| 1 | en cours | `X Pull request #16 is not mergeable: the base branch policy prohibits the merge.` |
| 2 | **Qualité ROUGE** | même refus |

`mergeStateStatus` : `BLOCKED` dans les deux cas. Après la seconde :
`state: OPEN`, `mergedAt: null`. **Rien n'a atteint `main`.** La PR a été fermée
sans fusion, et sa branche abandonnée.

---

## 2. L'échec précédent — ce qu'il a coûté, et pourquoi il valait mieux le savoir

Le 04/11/2026, un premier test avait été mené sur la PR #13, avec le seuil EUDR
porté de 4 à 5 ha. Elle a été **fusionnée dans `main` alors que le job Qualité
était rouge**. `main` a donc porté un seuil non conforme à l'article 9(1)(d) du
règlement (UE) 2023/1115 pendant environ 40 minutes.

Restauré par la PR #14 (`21b8b83`).

### Le diagnostic, mesuré sur le ruleset `26568220`

```json
{
  "enforcement": "disabled",
  "conditions": { "ref_name": { "include": [], "exclude": [] } }
}
```

- **`enforcement: disabled`** — le ruleset existait mais n'était pas appliqué ;
- **`include: []`** — il ne ciblait aucune branche.

Les deux défauts s'annulaient : inutile de chercher lequel avait causé la
fusion, aucun des deux ne laissait la moindre chance aux règles.

### Deuxième défaut, qui aurait bloqué même une fois activé

Trois des cinq checks enregistrés n'existaient pas :

| Enregistré | Nom réel du check |
|---|---|
| `qualité` | `Qualité (types, lint, règles EUDR, dépendances)` |
| `backend` | `Backend (pytest)` |
| `contrôles` | *(aucun)* |

Cause probable : saisie au clavier dans le champ de recherche, avec validation
d'une entrée en surbrillance au lieu de la vraie ligne. Les entrées correctes
sont **longues** ; celles-ci étaient des mots uniques.

**Pourquoi c'était grave** : un check exigé qui ne tourne jamais reste en
attente indéfiniment. Activer sans renommer aurait transformé un trou en mur —
plus aucune PR n'aurait pu être fusionnée.

Les trois corrections étaient **indissociables**. C'est ce qui a été fait.

---

## 3. La dette qui subsiste : deux checks fantômes

Le ruleset exige six contextes, dont **deux qu'aucun job ne produit** :

| Contexte exigé | Produit par un job ? |
|---|---|
| `Qualité (types, lint, règles EUDR, dépendances)` | ✅ |
| `Backend (pytest)` | ✅ |
| `Contrôles SQL (PostgreSQL)` | ✅ |
| `Bout en bout (application démarrée, PostgreSQL)` | ✅ |
| `contrôles` | ❌ **aucun job** |
| `Verify Frontend & Backend` | ❌ **aucun job** (workflow supprimé à la réécriture de la CI) |

**Pourquoi ce n'est pas bloquant aujourd'hui** : GitHub ignore un contexte exigé
qui n'a jamais été produit sur aucune branche. Sans cette tolérance, le dépôt
serait déjà figé — et c'est exactement le risque.

**Pourquoi il faut les retirer quand même** : le jour où un workflow nommerait
un job `contrôles` ou `Verify Frontend & Backend`, ce contexte se mettrait à
exister, et à bloquer selon des critères que personne n'a choisis. La règle
deviendrait active sans que quiconque l'ait décidée.

### Correction

`https://github.com/Huberaya/Geoforest/rules/26568220` → section *Require
status checks to pass* → supprimer `contrôles` et `Verify Frontend & Backend`
→ **Save changes**.

### Vérification

```bash
gh api repos/Huberaya/Geoforest/rulesets/26568220 \
  --jq '.rules[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context'
```

Doit renvoyer exactement ces quatre lignes, et rien d'autre :

```
Qualité (types, lint, règles EUDR, dépendances)
Backend (pytest)
Contrôles SQL (PostgreSQL)
Bout en bout (application démarrée, PostgreSQL)
```

---

## 4. Lire l'état réel — les commandes

```bash
# le ruleset est-il actif et ciblé ?
gh api repos/Huberaya/Geoforest/rulesets/26568220 \
  --jq '{etat:.enforcement, cibles:.conditions.ref_name.include}'
# attendu : {"etat":"active","cibles":["~DEFAULT_BRANCH"]}

# quelles règles ?
gh api repos/Huberaya/Geoforest/rulesets/26568220 --jq '[.rules[].type]'

# quels checks ?
gh api repos/Huberaya/Geoforest/rulesets/26568220 \
  --jq '.rules[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context'

# quels checks existent vraiment sur main ?
SHA=$(gh api repos/Huberaya/Geoforest/commits/main --jq .sha)
gh api "repos/Huberaya/Geoforest/commits/$SHA/check-runs?per_page=50" \
  --jq '.check_runs[].name' | sort -u
```

⚠️ **`gh api repos/.../branches/main --jq .protected` reste `false`, et ce n'est
pas une anomalie.** Le dépôt utilise un *ruleset*, mécanisme distinct de la
protection de branche historique. L'absence du second ne dit rien du premier.
La mesure qui compte est celle du ruleset.

⚠️ **Le jeton de l'agent ne peut pas lire ces réglages** (403 « Resource not
accessible by integration » sur `/protection`, `/rulesets` en écriture et sur
`branchProtectionRules` en GraphQL). Les mesures ci-dessus ont été obtenues en
**lecture** des rulesets ; l'écriture reste à la main de l'exploitant, ce qui
est sain : un agent ne devrait pas modifier les règles qui le contraignent.

---

## 5. Où en est C1 — clos

| Critère | État | Preuve |
|---|---|---|
| `main` verte sur son dernier commit | ✅ | `21b8b83`, 4 jobs verts |
| Un job de CI bloque réellement une fusion | ✅ | PR #16, deux refus, `mergedAt: null` |
| PR sans revue non fusionnable | ✅ | règle `pull_request`, 1 approbation |
| Protections actives et ciblées | ✅ | `enforcement: active`, `~DEFAULT_BRANCH` |

---

## 6. Ce que ce test a appris sur la méthode

Le premier test a coûté quarante minutes de règle EUDR fausse sur `main`. Le
second n'a rien coûté.

La différence n'est pas dans le soin apporté : elle est dans **ce qu'on casse**.
Casser une valeur réglementaire pour éprouver une barrière met en danger la
chose même que la barrière protège. Casser **une assertion de test** laisse le
produit intact et éprouve exactement le même mécanisme.

Corollaire : avant de vérifier un dispositif, mesurer **qu'il est dans l'état
qu'on croit**. Le contrôle des noms de checks était utile, mais il portait sur
un ruleset que `enforcement: disabled` rendait inopérant. Vérifier un détail
avec soin ne dispense pas de vérifier que l'ensemble est allumé.
