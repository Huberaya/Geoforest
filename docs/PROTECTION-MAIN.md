# Protéger `main` — diagnostic mesuré et marche à suivre

**Dernière mesure : 04/11/2026, 22 h 20 UTC.**

| Mesure | Valeur |
|---|---|
| Ruleset existant | ✅ `main`, id `26568220` |
| Son état d'application | ❌ **`enforcement: "disabled"`** |
| Ses branches ciblées | ❌ **aucune** (`include: []`) |
| Checks enregistrés | ⚠️ **3 sur 5 n'existent pas** |
| Fusion d'une PR à check rouge | ❌ **acceptée** (PR #13, mesuré) |

---

## 0. Ce qui s'est passé — et ce que ça a coûté

Un test de barrière a été mené : une PR cassant volontairement une règle
réglementaire (`EUDR_POLYGON_THRESHOLD_HA` 4 → 5), avec un job **Qualité**
rouge. Elle a été **fusionnée dans `main`** par `gh pr merge 13 --merge`, sans
erreur, alors que le check avait échoué.

`main` a donc porté un seuil EUDR de **5 ha au lieu de 4** — un écart à
l'article 9(1)(d) du règlement (UE) 2023/1115 — pendant environ 40 minutes.

Restauré par la PR #14, fusionnée dans `21b8b83`. `main` est verte sur ce
commit, 4 jobs sur 4.

⚠️ Cette erreur est assumée : un test de barrière qui ne casse rien ne teste
rien. Mais le coût est réel, et il vaut mieux le dire que le passer sous
silence.

---

## 1. Le diagnostic — deux défauts, pas un

`gh api repos/Huberaya/Geoforest/rulesets/26568220` donne :

```json
{
  "name": "main",
  "enforcement": "disabled",
  "conditions": { "ref_name": { "include": [], "exclude": [] } },
  "rules": [ "deletion", "pull_request", "required_status_checks" ]
}
```

### Défaut 1 — le ruleset n'est pas appliqué

`enforcement: "disabled"` : le ruleset existe, il contient les bonnes règles,
et **il ne s'applique à rien**. C'est l'état « brouillon » de l'interface.

### Défaut 2 — il ne cible aucune branche

`conditions.ref_name.include` est **vide**. Un ruleset sans motif de branche ne
vise aucune référence, même actif.

**Le défaut 1 annule le défaut 2** : inutile de chercher lequel a causé la
fusion, aucun des deux ne laisse la moindre chance aux règles.

### Défaut 3 — trois checks sur cinq n'existent pas

| Enregistré | Nom réel produit par la CI |
|---|---|
| `qualité` | `Qualité (types, lint, règles EUDR, dépendances)` |
| `backend` | `Backend (pytest)` |
| `contrôles` | *(aucun)* |
| `Contrôles SQL (PostgreSQL)` | ✅ correct |
| `Bout en bout (application démarrée, PostgreSQL)` | ✅ correct |

Cause probable : les trois premiers ont été saisis au clavier dans le champ de
recherche, et une entrée en surbrillance a été validée au lieu de la vraie
ligne. Les entrées correctes sont **longues** ; celles-ci sont des mots uniques.

**Pourquoi c'est grave même après activation** : un check exigé qui ne tourne
jamais reste « en attente » indéfiniment. GitHub refuserait alors **toutes** les
fusions, y compris les légitimes. On passerait d'un trou à un mur.

⚠️ Les trois corrections sont **indissociables**. Activer sans renommer bloque
tout ; renommer sans activer ne protège rien.

---

## 2. La marche à suivre — interface web

### A. Ouvrir le bon objet

`https://github.com/Huberaya/Geoforest/rules/26568220`

(ou : **Settings** → **Rules** → **Rulesets** → cliquer sur `main`)

⚠️ Ne pas confondre avec *Settings → Branches* : le règleset a été créé dans
l'interface **Rulesets**, c'est donc là qu'il faut le modifier.

### B. Activer

En haut de la page, à côté de **Enforcement status**, sélectionner **Active**
(aujourd'hui : *Disabled*).

### C. Cibler la branche

Section **Target branches** → **Add target** → **Include default branch**
(ou *Include by pattern* → `main`).

Sans cette étape, tout le reste est décoratif.

### D. Corriger les trois checks

Section **Require status checks to pass** → **Add checks**. Supprimer
`qualité`, `backend` et `contrôles` (icône corbeille), puis **sélectionner dans
la liste** — sans taper au clavier — les quatre lignes :

```
Qualité (types, lint, règles EUDR, dépendances)
Backend (pytest)
Contrôles SQL (PostgreSQL)
Bout en bout (application démarrée, PostgreSQL)
```

Ces quatre noms sont ceux qui se rapportent réellement sur `main`
(vérifié sur le commit `21b8b83` via l'API check-runs).

### E. Vérifier le reste

| Réglage | Valeur attendue |
|---|---|
| Require a pull request before merging | ✅ activé, **1** approbation |
| Dismiss stale pull request approvals | ✅ |
| Require conversation resolution | ✅ |
| Require branches to be up to date | ✅ |
| Restrict deletions | ✅ |
| Block force pushes | ✅ **à cocher — actuellement absent des règles** |
| Bypass list | vide |

### F. Enregistrer

Bouton **Save changes** en haut à droite.

---

## 3. La vérification — ne pas se contenter de l'écran

```bash
# 1. le ruleset est-il actif et ciblé ?
gh api repos/Huberaya/Geoforest/rulesets/26568220 \
  --jq '{etat:.enforcement, cibles:.conditions.ref_name.include}'
# attendu : {"etat":"active","cibles":["refs/heads/main"]}

# 2. les quatre checks sont-ils les bons ?
gh api repos/Huberaya/Geoforest/rulesets/26568220 \
  --jq '.rules[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context'
```

### Le test qui vaut preuve — à rejouer

Le précédent a échoué ; il faut le refaire, et cette fois **sur une PR jetable
dont la modification n'a aucune conséquence réglementaire**. Ne plus jamais
utiliser le seuil EUDR comme cobaye.

1. brancher depuis `main`, modifier un commentaire dans
   `scripts/check-eudr-rules.ts` **et** y glisser une erreur qui fait échouer
   `check:eudr` (par exemple retirer un cas de test) ;
2. ouvrir la PR, attendre le job **Qualité** rouge ;
3. `gh pr merge <n> --merge` doit répondre **par une erreur**, pas fusionner :

```
GraphQL: Pull request is not mergeable ... required status check "Qualité (…)" is expected
```

4. si la fusion passe encore, le problème n'est pas résolu — revenir en §1.

C'est cette réponse-là qui prouve la protection. Pas la case cochée.

---

## 4. Où en est C1

| Critère | État |
|---|---|
| `main` verte sur son dernier commit | ✅ `21b8b83`, 4/4 |
| Un job de CI bloque réellement une fusion | ❌ **mesuré faux le 04/11/2026** |
| PR sans revue non fusionnable | ❌ dépend du §2 |
| `protected: true` | ❌ dépend du §2 |

**C1 n'est pas clos.** Le test de barrière a produit un résultat négatif, et un
résultat négatif mesuré vaut mieux qu'une case cochée qu'on n'a jamais vérifiée.
