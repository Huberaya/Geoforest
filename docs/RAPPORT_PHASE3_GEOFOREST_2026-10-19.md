# Geoforest — Agent C, phase 3 : consolidation, preuves distantes, préparation à l'intégration

**Rapport :** « Geoforest — Agent C, phase 3 : consolidation, preuves distantes et préparation à l'intégration »
**Auteur :** Agent Arena.ai (Arena.ai — Agent Mode)
**Date :** 2026-10-19
**Branche :** `arena/837c5c36-geoforest`

---

## 1. Branche et SHA exacts

| Élément | Valeur |
|---|---|
| Branche de travail | `arena/837c5c36-geoforest` |
| Base `main` | `1c95f4c585ed8303f887089ae7450c9235523fd0` — **inchangée** |
| Commit de code de la phase 3 | `a26721c7b2cda9236adc3ecd56305cc26edf733c` |
| Commit de CI (audit bloquant) | `295f0f7e221325aaa70f510d9c21841f48b81b33` |
| Branche distante | `origin/arena/837c5c36-geoforest` = `295f0f7` |
| PR | [#7](https://github.com/Huberaya/Geoforest/pull/7) — **ouverte, non fusionnée** |

Historique :

```
295f0f7  ci: remplacer un audit de développement vert par un contrôle de régression bloquant
a26721c  fix: consolider les garde-fous et corriger quatre défauts reproductibles
4dc4417  docs(validation): rapport final par chantier de la phase 2
fb99eb2  docs(validation): consigner le SHA validé et le re-run post-push
eacab9b  fix(eudr): corriger le build, l'identité opérateur et l'attribution des pays
1c95f4c  (main) Retrait d'une marque de sondage laissée dans le résumé d'audit
```

---

## 2. État du dépôt avant / après

### Avant — un écart réel, et une fausse alerte

Le rapport de phase 2 annonçait `4dc4417` comme dernier commit. Le poste de
travail, lui, affichait :

```
HEAD           1c95f4c   (le commit de base)
origin/main    1c95f4c
branche locale arena/837c5c36-geoforest  1c95f4c
```

Le dépôt local était un **clone superficiel** (`.git/shallow`) : seuls
`refs/heads/main` et `refs/remotes/origin/main` étaient connus. La branche
distante interrogée par `git ls-remote` était bien à `4dc4417`.

**Vérification avant d'écrire quoi que ce soit.** Plutôt que de conclure à une
divergence de contenu, chaque fichier de `4dc4417` a été comparé octet par
octet à l'arbre de travail (`git ls-tree` + `git hash-object`) :

```
$ git ls-tree -r 4dc4417 | (comparer chaque blob au fichier local)
(résultat vide — aucun écart)
```

Le contenu était **identique**. Seule la référence locale était en retard. Le
réalignement (`git reset --mixed 4dc4417`) n'a donc modifié aucun fichier :
`git status` est ressorti propre immédiatement après.

⚠️ Cette manipulation n'a **pas** été faite à l'aveugle : elle a suivi la
comparaison, jamais précédé. Un `reset --hard` sur la foi du rapport aurait
détruit le travail en cours si le contenu avait différé.

### Après

| Élément | Valeur |
|---|---|
| `HEAD` local | `295f0f7` |
| Parent | `a26721c` |
| Branche distante | `295f0f7` (identique) |
| `git status` | propre |
| `next-env.d.ts` | **non modifié** (réécrit par `next build`, restauré avant chaque commit) |
| `git diff --check` | propre |

### Suivi des données géographiques

`data/frontieres/` était **ignoré** par Git : `.gitignore` contient `data/`
et `/data`. La phase 2 avait ajouté une exception, mais la règle
`/data` (avec `git check-ignore` le confirmant) l'emportait encore sur le
premier niveau. Correction en `data/*` + `/data/*` avec réinclusion explicite.

Vérifié sur le commit :

```
$ git ls-tree -r --name-only HEAD data/frontieres
data/frontieres/LICENSE-world-atlas.txt
data/frontieres/PROVENANCE.md
data/frontieres/countries-50m.json
data/frontieres/iso-numerique-alpha2.json
data/frontieres/points-de-controle.json
```

---

## 3. Commits poussés

| SHA | Nature | Contenu |
|---|---|---|
| `eacab9b` | code (phase 2) | build, identité opérateur, frontières réelles |
| `fb99eb2` | documentation | SHA validé |
| `4dc4417` | documentation | rapport final phase 2 |
| `a26721c` | code (phase 3) | P3-01 à P3-04, licence, points de contrôle, audits |
| `295f0f7` | CI | audit de développement remplacé par un contrôle bloquant |

Aucun commit sur `main`. Aucun merge. Aucun force push. Aucun reset destructif.

---

## 4. Défauts corrigés — cause racine et preuve

### P3-01 — Le proxy `dbAdmin` / `adminPool` n'était pas transparent

**Constat mesuré.** Le proxy ne piégeait que `get` et `has` :

| Expression | Résultat avant | Attendu |
|---|---|---|
| `Object.keys(adminPool)` | `[]` | les propriétés du pool |
| `Object.getOwnPropertyNames(adminPool)` | `[]` | idem |
| `{ ...adminPool }` | `{}` | idem |
| `adminPool instanceof Pool` | `false` | `true` |
| `adminPool.query === adminPool.query` | `false` | `true` |

**Pourquoi ce n'est pas théorique.** Le rapport de phase 2 justifiait la
compatibilité par « aucun appelant n'utilise `Object.keys` ». C'est une
observation sur un instant, pas une propriété : un utilitaire de sérialisation,
un `Promise`-like ou un futur test aurait rencontré un objet qui **ment** sur
son contenu.

**Correction.** Trapes `ownKeys`, `getOwnPropertyDescriptor`, `getPrototypeOf`,
`set`, `defineProperty`, `deleteProperty` ; méthodes liées mémorisées par
instance pour que l'identité soit stable. `getOwnPropertyDescriptor` force
`configurable: true`, contrainte du langage : la cible du proxy est un objet
vide.

**Fail-closed conservé et étendu.** Non configuré, le proxy **lève** sur la
réflexion (`DATABASE_URL_ADMIN est requis…`) au lieu de renvoyer un objet vide.
Énumérer un pool non configuré n'est pas une information neutre.

**Preuve.** `npm run test:demarrage` : **22/22** (7 avant).

### P3-02 — Le retour arrière de 0007 inventait une identité

```sql
-- avant
UPDATE "parcel_audits" SET "operator_country" = 'FR' WHERE "operator_country" IS NULL;
```

Le commentaire du même fichier annonçait : « Il échouera si des lignes ont été
enregistrées sans identité : c'est volontaire. » Il **ne pouvait pas** échouer :
il fabriquait `'FR'` pour réussir. Contradiction entre l'intention écrite et le
comportement.

**Correction.** Bloc `DO` qui compte les dossiers incomplets et `RAISE
EXCEPTION` en les nommant. Un rollback qui invente une donnée est pire qu'un
rollback qui refuse.

**Preuve.** `npm run test:migration` — 13/13 : échec du retour arrière avec
message nommant « 1 dossier(s) sans pays », aucune ligne détruite, puis succès
une fois les dossiers explicitement repris.

### P3-03 — La reconstruction SQLite perdait les données en cas d'échec

**Mesure, avant correction**, sur une base dont la table portait
`operator_address`, colonne absente du schéma cible :

```
OperationalError: table parcel_audits has no column named operator_address
tables après l'échec :
  parcel_audits_avant_p2_15 → 1 ligne
  parcel_audits             → 0 ligne
```

La table vivante restait **vide**, les données orphelines dans la table
renommée. Au démarrage suivant, la migration ne regardait que le schéma de
`parcel_audits` — déjà au nouveau schéma — et **ne repassait jamais**. Perte
silencieuse du point de vue de l'application.

**Trois corrections.**

1. copie sur l'**intersection** des colonnes anciennes et cibles ;
2. transaction explicite avec `ROLLBACK` : la base revient exactement à son état
   d'avant ;
3. comparaison du **nombre de lignes** avant de supprimer l'ancienne table.

**Défaut secondaire découvert en corrigeant.** `executescript()` émet un
`COMMIT` implicite avant d'exécuter un script : il fermait la transaction
ouverte, et le `ROLLBACK` échouait avec « cannot rollback - no transaction is
active ». Les instructions sont désormais exécutées une à une via
`sqlite3.complete_statement`.

**Preuve.** 3 nouveaux tests, dont un échec **forcé** par déclencheur : après
l'échec, `parcel_audits_avant_p2_15` n'existe pas, `operator_eori` est présent,
et la ligne est toujours là.

### P3-04 — Le seed exposait un mot de passe et n'avait aucune garde

| Défaut | Avant | Après |
|---|---|---|
| Valeur de repli | constante littérale en dur | `SEED_DEMO_PASSWORD` exigé, minimum 12 caractères |
| Affichage | « Mot de passe commun : … » sur stdout | seule la longueur est journalisée |
| Production | aucune garde | `NODE_ENV=production` refusé sauf `SEED_ALLOW_PRODUCTION=1` |
| Occurrences du littéral | 2 (seed + fixture) | **0** |

**Preuve.** `npm run test:securite` → `check-seed-securite` **7/7**, qui
**exécute** le seed en sous-processus (aucune base contactée : chaque cas
échoue avant l'ouverture du pool).

### Dépendances — une vulnérabilité de production

`npm audit --omit=dev` **n'était pas à zéro** :

```
source-map-js  1.0.0 - 1.2.1   High   GHSA-68fv-2mgg-jv7q
1 high severity vulnerability
```

Chaîne : `next@16.3.8 → postcss → source-map-js` et
`@tailwindcss/postcss → @tailwindcss/node → source-map-js`. Dépendance de
**production**. Corrigé par `overrides: source-map-js ^1.2.2` ; les trois
occurrences résolvent en `1.2.2` ; `npm run audit:sec` → **0**.

### Le premier montage de la CI était un masquage

L'étape d'audit de développement avait `continue-on-error: true` : elle
s'affichait **verte** alors que `npm audit` sortait en code **1**. Le run
[`39323809934`](https://github.com/Huberaya/Geoforest/actions/runs/39323809934)
en porte la trace (étape 10 `success`).

Remplacée par `scripts/check-audit-dependances.ts`, **bloquante** et
significative : 0 vulnérabilité de production exigée ; en développement, seul
le lot `braces` connu est accepté ; chaque entrée doit remonter au **même**
avis ; **échec si `braces` reçoit un correctif**, pour que l'exception ne
survive pas à sa justification. 7/7.

---

## 5. Étape C — identité de l'opérateur, vérifiée point par point

| Exigence | État | Preuve |
|---|---|---|
| Une identité manquante reste absente | ✅ | `NULL` en base, `operator_identity = "missing"` |
| Jamais transformée en identité plausible | ✅ | aucune valeur de remplissage dans le code |
| Export sans identité → `422 OPERATOR_IDENTITY_MISSING` | ✅ | `test_export_refuse_sans_identite` |
| Trois états cohérents | ✅ | `declared` / `legacy_placeholder` / `missing` — vérifié sur PGlite |
| Vue `security_invoker = true` | ✅ | `pg_class.reloptions` sur PGlite, option présente |
| Migrations reproductibles | ✅ | aller rejoué deux fois sans erreur |
| Idempotence | ✅ | `test_migration_idempotente` |
| Reconstruction : lignes conservées | ✅ | compte comparé avant suppression |
| Champs conservés | ✅ | valeurs comparées par marqueur, pas par position |
| Dossiers historiques ni réécrits ni supprimés | ✅ | valeur héritée intacte en base |

**Décisions produit nécessaires** (séparées des défauts de code) :

1. Que faire des dossiers `legacy_placeholder` : les considérer comme « identité
   inconnue » (comportement actuel : export refusé) ou engager une reprise
   manuelle documentée ?
2. Le retour arrière de 0007 est désormais bloquant tant que des dossiers sans
   identité existent : c'est voulu, mais il faut une procédure de reprise avant
   tout rollback.

---

## 6. Étape D — données géographiques

| Vérification | Résultat |
|---|---|
| Référentiel versionné | ✅ `countries-50m.json`, 756 420 octets |
| Provenance | ✅ `world-atlas@2.0.2`, Natural Earth 1:50m, copie du 2026-10-19 |
| **Licence** | ✅ ajoutée : `ISC` (notice jointe) + domaine public Natural Earth |
| Empreintes | ✅ SHA-256 consignées et recalculables |
| Table ISO | ✅ `pycountry 26.2.16`, 249 codes |
| Même référentiel TS/Python | ✅ même fichier, même algorithme |
| Points de contrôle | ✅ **18**, dans un fichier **lu par les deux suites** |
| Parité mesurée | ✅ 15/15 points, accord total |
| Hors couverture → `XX` | ✅ Pristina, haute mer |
| `verified: false` maintenu | ✅ aucune classification promue |

**Rattachements contestés — rapportés, non endossés.** Mesuré sur le jeu :
Crimée → `RU`, Cachemire → `IN`, Sahara occidental → `MA`, Abyei → `SD`. Ces
points sont désormais dans le référentiel de contrôle avec la mention
explicite « rattachement du jeu Natural Earth, rapporté et non endossé ». Aucun
rattachement n'a été modifié.

**Limites de précision.** Généralisation 1:50m : quelques centaines de mètres
autour d'une frontière. Aucun découpage maritime. Le cas « Strasbourg,
8,2 / 48,9 » est dans le référentiel pour que cette limite soit testée, pas
seulement écrite.

---

## 7. État des quatre risques résiduels

Détail complet : `docs/SECURITE_RISQUES_RESIDUELS_2026-10-19.md`.

| Risque | Statut | Preuve / blocage |
|---|---|---|
| **E1** — PostgreSQL serveur et RLS | `NON VÉRIFIÉ` | Aucun binaire PostgreSQL disponible. PGlite a exercé la **migration** (rôles, RLS, privilèges non exercés). Recette de 11 contrôles prête, non exécutée. |
| **E2** — `braces` | `ATTÉNUÉ — RISQUE RÉSIDUEL` | `<= 3.0.3`, `Patched versions: None`. Développement seulement. Production : 0 vulnérabilité. `audit:controle` 7/7. |
| **E3** — comptes de démonstration | `ATTÉNUÉ — RISQUE RÉSIDUEL` | Code corrigé et testé (7/7). **Inventaire impossible depuis le dépôt** : aucun accès aux bases. Requête fournie pour l'exploitant. |
| **E4a** — limitation en mémoire | `ATTÉNUÉ — RISQUE RÉSIDUEL` | Inventaire fait : toutes les limites sont dans la `Map` du module. Redémarrage et multi-instance **démontrés** par test. Magasin partagé **non implémenté**. |
| **E4b** — rotation des secrets | `NON VÉRIFIÉ` | Procédure écrite (ordre, vérification, retour arrière, non-divulgation). Aucune rotation exécutée. |
| **E4c** — chaîne d'audit | `BLOQUÉ` | ⚠️ **La chaîne n'existe pas.** `audit-log.ts` écrit sans chaînage ; une altération ne laisse aucune trace. Vérification périodique impossible faute d'objet. Schéma minimal et procédure d'alerte décrits. |

⚠️ `docs/rapport-securite-agent-b.md`, cité par la mission, **n'existe pas** dans
le dépôt. Ce rapport ne s'appuie donc sur aucun de ses chiffres.

---

## 8. État des 14 validations externes

`docs/RECETTE_VALIDATION_EXTERNE_2026-10-19.md` — **aucun cas exécuté**.

| Cas | Sujet | Statut |
|---|---|---|
| G1–G7 | GFW (nominal, perte, absence, hors couverture, panne, version, cohérence) | **non exécuté** — aucune clé autorisée, hôte injoignable |
| E1–E3 | SI EUDR (conforme, trous, règle des 4 ha) | **non exécuté** — aucun accès ACCEPTANCE |
| F1–F3 | Frontières (points, zone frontalière, contestés) | **partiellement couvert** en test logiciel (F1) ; F2/F3 non exécutés |
| T1 | Terrain (relevé GPS indépendant) | **non exécuté** — aucune donnée de terrain |

Aucun de ces cas n'est présenté comme validé.

---

## 9. Décisions produit et juridiques en attente

1. **Reprise des dossiers `legacy_placeholder`** — décision produit. Aucune
   réécriture automatique n'a eu lieu.
2. **Date de récolte** — question juridique **non tranchée**. Divergence
   assumée entre moteur live (refus) et démonstration (« hors champ
   temporel »).
3. **Benchmark pays** — table interne `verified: false`, sans version ni date
   d'application.
4. **Chaîne d'audit** — périmètre, rétention, coût de sérialisation par
   organisation.
5. **Limitation partagée** — choix d'infrastructure (Redis ou PostgreSQL).

---

## 10. Commandes exécutées, résultats et environnement

Environnement : Node.js 22.22.3, npm 10.9.8, Python 3.12 (venv), PGlite
0.3.14, Ubuntu 24.04.

| Commande | Résultat | Code de sortie |
|---|---|---|
| `npm run build` | 18/18 pages, 0 erreur | **0** |
| `npm run test:gis` | 24/24 + 66/66 + 16/16 + 22/22 = **128/128** | **0** |
| `npm run test:securite` | 22/22 + 13/13 + 7/7 + 6/6 = **48/48** | **0** |
| `npm run audit:controle` | **7/7** | **0** |
| `npx tsc --noEmit` | aucune erreur | **0** |
| `npm run lint` | 0 erreur, 5 avertissements préexistants | **0** |
| `cd backend && pytest -q` | **121 passed, 3 xfailed** | **0** |
| `npm run audit:sec` | `found 0 vulnerabilities` | **0** |
| `npm run audit:dev` | 5 vulnérabilités high (`braces`) | **1** — attendu, documenté |

**Tests ignorés.** Les 3 `xfail` sont `strict=True` et documentés au §5.2 du
rapport de validation : ils portent sur des endpoints géospatiaux absents du
backend. Un `xfail` qui passerait inopinément ferait échouer la suite.

---

## 11. CI distante vérifiée

| Run | SHA | Événement | Statut |
|---|---|---|---|
| [`39323809934`](https://github.com/Huberaya/Geoforest/actions/runs/39323809934) | `a26721c` | `pull_request` | ✅ vert — mais **étape 10 verte à tort** (masquage, corrigé ensuite) |
| [`39324186614`](https://github.com/Huberaya/Geoforest/actions/runs/39324186614) | `295f0f7` | `pull_request` | ✅ **vert, 11/11 étapes** |

Détail du run `39324186614` :

```
 4. Install backend dependencies & test                success
 7. Frontend EUDR & GIS checks                         success
 8. Sécurité des garde-fous                            success
 9. Audit des dépendances de production                success
10. Audit des dépendances (contrôle de régression)     success
11. Build frontend                                     success
```

⚠️ **Le journal brut n'est pas lisible depuis cet environnement** : GitHub
redirige les logs vers `productionresultssa6.blob.core.windows.net`, qui n'est
pas dans la liste des hôtes autorisés. Le statut par étape provient de l'API
GitHub, pas d'une lecture du journal.

---

## 12. Bilan : corrigé, préparé, bloqué, non vérifié

| Élément | Statut |
|---|---|
| Build sans base de données | **CORRIGÉ ET VÉRIFIÉ** |
| Proxy transparent (réflexion) | **CORRIGÉ ET VÉRIFIÉ** |
| Identité absente jamais fabriquée | **CORRIGÉ ET VÉRIFIÉ** |
| Export sans identité → 422 | **CORRIGÉ ET VÉRIFIÉ** |
| Retour arrière 0007 n'invente rien | **CORRIGÉ ET VÉRIFIÉ** |
| Reconstruction SQLite atomique | **CORRIGÉ ET VÉRIFIÉ** |
| Attribution pays par frontières réelles | **CORRIGÉ ET VÉRIFIÉ** (test logiciel) |
| Seed sans mot de passe en dur | **CORRIGÉ ET VÉRIFIÉ** |
| `source-map-js` en production | **CORRIGÉ ET VÉRIFIÉ** |
| `braces` en développement | **ATTÉNUÉ — RISQUE RÉSIDUEL** |
| Comptes de démonstration existants | **ATTÉNUÉ — RISQUE RÉSIDUEL** (inventaire hors dépôt) |
| Limitation en mémoire | **ATTÉNUÉ — RISQUE RÉSIDUEL** |
| PostgreSQL serveur et RLS | **NON VÉRIFIÉ** |
| Rotation des secrets | **NON VÉRIFIÉ** |
| Chaîne d'audit | **BLOQUÉ** |
| GFW / SI EUDR / terrain | **BLOQUÉ** — accès absent |
| Date de récolte | **BLOQUÉ** — question juridique |
| Reprise des dossiers historiques | **BLOQUÉ** — décision produit |

---

## 13. Confirmation d'absence d'opération interdite

- `main` : `1c95f4c`, identique à `origin/main`, **aucun commit ajouté**.
- Aucun merge, aucune fusion de PR.
- Aucun force push, aucun reset destructif.
- Aucune migration lancée sur une base réelle.
- Aucun compte créé, modifié ou supprimé.
- Aucun secret dans le dépôt, les rapports ou les messages.
- Aucun déploiement.

---

## 14. Verdict

### `PRÊT POUR REVUE` — pour le périmètre **code**.

Les corrections sont présentes sur la branche distante, les suites applicables
passent, et la CI est **verte sur le SHA exact** `295f0f7`.

**Ce verdict ne vaut pas pour la mise en production.** PostgreSQL serveur,
GFW, SI EUDR, terrain, juridique et chaîne d'audit restent ouverts. Aucun de ces
risques n'est clos, et aucun ne doit être présenté comme tel.

---

*Rapport « Geoforest — Agent C, phase 3 : consolidation, preuves distantes et
préparation à l'intégration » établi par **Agent Arena.ai** (Arena.ai — Agent
Mode).*
