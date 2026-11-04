# Protéger `main` — la dernière étape de C1

**État constaté le 04/11/2026 (après fusion de la PR #12) :**
`gh api repos/Huberaya/Geoforest/branches/main --jq .protected` → **`false`**
**Aucun ruleset actif :** `gh api repos/Huberaya/Geoforest/rulesets` → **`[]`**

Tant que ce n'est pas fait, **tout le travail de C1 est contournable** : n'importe
qui avec un droit d'écriture peut pousser directement sur `main` et fusionner du
code sans qu'aucun des quatre jobs ne tourne. La CI redevient une barrière
seulement si la branche l'exige.

---

## 0. La PR #12 a été fusionnée — ce qui est fait, et ce qui ne l'est pas

| Geste | État |
|---|---|
| Fusionner la PR #12 | ✅ faite (`1c97a88`, 04/11/2026 15:40 UTC) |
| `main` verte sur son dernier commit | ✅ **oui** — 4 jobs verts sur `1c97a88`, premier succès depuis le 30/09/2026 |
| Protéger `main` | ❌ **non** — refusée par GitHub, voir §1 |

Le critère « `main` affiche un ✅ sur le dernier commit » de C1 est donc **rempli**. Il
reste les trois autres, qui dépendent tous de cette page de réglages.

## 1. Pourquoi l'agent n'a pas pu le faire

Trois tentatives (deux avant la fusion, une après), trois refus, avec un jeton
pourtant `admin: true` sur le dépôt :

```
PUT  /repos/Huberaya/Geoforest/branches/main/protection   → 403 Resource not accessible by integration
POST /repos/Huberaya/Geoforest/rulesets                   → 403 Resource not accessible by integration
```

Tentative 3, après la fusion, en formulaire plutôt qu'en JSON — même refus :

```
PUT  /repos/Huberaya/Geoforest/branches/main/protection   → 403 Resource not accessible by integration
```

Le jeton utilisé est une **intégration GitHub**, à laquelle il manque la
permission « Administration » — celle qui gouverne précisément la protection de
branche. Ce n'est pas un défaut du dépôt : c'est une limite du jeton, et elle
est saine (un agent ne devrait pas pouvoir modifier les règles qui le
contraignent).

---

## 2. La marche à suivre — interface web (2 minutes)

`https://github.com/Huberaya/Geoforest/settings/branches` → **Add branch
protection rule** (ou *Add classic branch protection rule*) → nom de motif : `main`.

| Réglage | Valeur | Pourquoi |
|---|---|---|
| **Require a pull request before merging** | ✅ | sans cela, un `git push` direct contourne tout |
| ↳ Required approvals | **1** | une relecture humaine, même minimale |
| ↳ Dismiss stale pull request approvals when new commits are pushed | ✅ | une approbation ne doit pas couvrir du code ajouté après elle |
| ↳ Require conversation resolution before merging | ✅ | une remarque non traitée ne doit pas être enterrée par un merge |
| **Require status checks to pass before merging** | ✅ | la CI devient une condition, pas un avis |
| ↳ Require branches to be up to date before merging | ✅ | évite qu'une PR verte le soit sur un `main` périmé |
| ↳ Checks (les quatre, nommés exactement) | voir §3 | |
| **Do not allow bypassing the above settings** | ⬜ *(à votre main)* | coché : vous ne pouvez plus forcer, même en tant qu'admin. Utile en équipe, gênant en solo. |
| **Restrict who can push** | facultatif | |
| **Allow force pushes** | ❌ | un `force-push` réécrit l'historique : ce qui est signé ne l'est plus |
| **Allow deletions** | ❌ | supprimer `main` d'un dépôt de conformité n'a aucune excuse |

---

## 3. Les quatre checks à exiger — noms exacts

Ils doivent correspondre **caractère pour caractère** au champ `name` de chaque
job dans `.github/workflows/ci.yml` :

```
Qualité (types, lint, règles EUDR, dépendances)
Backend (pytest)
Contrôles SQL (PostgreSQL)
Bout en bout (application démarrée, PostgreSQL)
```

⚠️ Le quatrième n'apparaît dans la liste déroulante GitHub qu'après avoir tourné
**au moins une fois**. Il a tourné le 04/11/2026 (run `41856355341`, vert en
54 s) : il doit donc être proposé.

---

## 4. Variante API, si vous préférez la ligne de commande

Avec un jeton personnel disposant du scope `repo` **et** de la permission
d'administration :

```bash
gh api -X PUT repos/Huberaya/Geoforest/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Qualité (types, lint, règles EUDR, dépendances)",
      "Backend (pytest)",
      "Contrôles SQL (PostgreSQL)",
      "Bout en bout (application démarrée, PostgreSQL)"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
```

---

## 5. Vérifier que c'est réellement actif

Ne pas se contenter de l'écran de réglage : le mesurer.

```bash
gh api repos/Huberaya/Geoforest/branches/main --jq .protected          # attendu : true
gh api repos/Huberaya/Geoforest/branches/main/protection \
  --jq '.required_status_checks.contexts'                              # attendu : les 4 checks
```

Puis le test qui compte vraiment — **casser une règle et constater le refus** :

1. ouvrir une PR qui modifie `EUDR_POLYGON_THRESHOLD_HA` de 4 à 5 dans
   `scripts/check-eudr-rules.ts` ;
2. le job *Qualité* doit échouer (`check:eudr` sort en code 1) ;
3. le bouton **Merge** doit être **désactivé**, avec le message
   *« Required status check "Qualité (…)" is expected »* ;
4. fermer la PR sans la fusionner.

C'est cette capture-là qui vaut preuve, pas la case cochée.

---

## 6. Après la protection : les deux mesures qui closent C1

```bash
gh api repos/Huberaya/Geoforest/branches/main --jq .protected     # attendu : true
gh run list --branch main --limit 1 --json conclusion             # attendu : success
```

Puis le test de §5 (une PR qui casse `EUDR_POLYGON_THRESHOLD_HA` doit voir son
bouton **Merge** désactivé). C'est cette capture qui vaut preuve.

---

## 7. Ce qui reste ouvert après cette étape

| Point | État |
|---|---|
| `main` verte sur son dernier commit | ✅ **oui** — `1c97a88`, 4 jobs verts |
| PR cassant un `check-*` refusée | ⚠️ mécanisme en place, refus **non encore constaté** (cf. §5) |
| PR sans revue non fusionnable | ❌ dépend de cette page de réglages |
| `protected: true` | ❌ dépend de cette page de réglages |
