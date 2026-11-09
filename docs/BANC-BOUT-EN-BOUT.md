# Le banc de bout en bout — ce qu'il prouve, et ce qu'il ne prouve pas

**Fichier :** `scripts/check-bout-en-bout.ts` · **commande :** `npm run check:e2e:complet`
**job CI :** `Bout en bout (application démarrée, PostgreSQL)`

---

## 1. Pourquoi il existe

Avant ce banc, la CI savait trois choses :

1. le code **compile** (`next build`) ;
2. les **règles métier pures** tiennent (`check:eudr`, `check:topologie`, `check:regles`, `check:csv`) ;
3. les **migrations** s'appliquent (`db:migrate`).

Elle ne savait pas répondre à la seule question qui compte avant une mise en production : **l'application démarre-t-elle, et fait-elle ce qu'elle prétend ?**

Ce n'est pas une hypothèse. Le 04/11/2026, sur une base migrée et un build valide, le serveur a refusé **toutes** ses requêtes en 500 : le contrôle de rôle au démarrage jugeait la connexion non conforme. `tsc`, `eslint`, `next build`, `db:migrate` et les cinq `check:*` étaient verts. Le défaut était dans le produit, et **invisible de la CI**.

---

## 2. Les 38 contrôles

| Bloc | Ce qui est mesuré |
|---|---|
| **Sondes** (8) | `/api/health` et `/api/ready` répondent ; base joignable ; stockage vérifié par **aller-retour réel** ; composant `role_base` **présent et vert** ; version identifiée ; aucun chemin de fichier exposé |
| **RLS en base** (2) | RLS activée **et forcée** sur les 13 tables métier, lues dans `pg_class` — hors de portée de toute couche applicative |
| **Authentification** (3) | route métier refusée sans session ; mot de passe erroné refusé ; le refus ne révèle pas l'existence du compte |
| **Connexion MFA** (8) | login + activation TOTP au premier passage + 8 codes de secours + session immédiatement utilisable, pour **deux** comptes distincts |
| **Parcours métier** (7) | `/auth/me` porte une organisation ; parcelle sans géométrie refusée (422) ; parcelle géolocalisée créée (201) ; relecture ; surface conforme ; présence en liste |
| **Isolation multi-tenant** (5) | B ne **lit**, ne **modifie**, ne **supprime** pas la parcelle de A (404 dans les trois cas) ; la liste de B n'en contient aucune ; A voit toujours la sienne |

Le code TOTP est **recalculé indépendamment** du produit : un banc qui réutiliserait la fonction de vérification de l'application validerait une erreur de cette fonction avec elle-même.

---

## 3. Le banc est auto-testé — trois falsifications, trois échecs

Un contrôle dont on n'a jamais vu l'échec n'est pas un contrôle. Chaque barrière a été cassée volontairement :

| Falsification | Résultat attendu | Mesuré |
|---|---|---|
| `alter table gf_plots disable row level security` | le banc échoue | **🔴 échec**, `sans RLS : gf_plots` |
| `next.config.ts` : version vidée, sonde revenue à `npm_package_version` | le banc échoue | ✅ *voir la note ci-dessous* |
| `src/lib/version.ts` ≠ `package.json` | `check:version` échoue | **🔴 échec**, 4/5 |

### Note d'honnêteté sur la version

La **première** correction de la version — une variable `env` dans `next.config.ts` — n'a **rien fait** : le bundle compilé contenait toujours l'ancienne expression, et le contrôle ne bronchait pas. Vérifié en inspectant `.next/server/chunks/`.

La correction retenue est donc une constante versionnée (`src/lib/version.ts`), comparée à `package.json` par `check:version`, et dont la valeur est vérifiée **en exécution** par le banc. Trois contrôles pour un champ, et c'est justifié : « plausible mais inopérant » est exactement le défaut que cet audit reproche au produit.

---

## 4. Une leçon qui vaut d'être écrite

Avec la RLS **désactivée** sur `gf_plots`, les cinq contrôles d'isolation passaient **au vert**.

Ce n'est pas un défaut du produit : les routes filtrent explicitement sur `organization_id`, et c'est heureux. C'est une limite du banc de bout en bout — il mesure le comportement de l'API, pas l'état de la base. D'où la séparation :

- **isolation à l'API** → prouve que le produit ne fuit pas à travers ses routes ;
- **RLS en base** → prouve que le filet existe encore quand une route oubliera son filtre.

Une défense en profondeur dont la seconde couche tombe sans bruit n'est plus qu'une couche. Les deux mesures sont nécessaires, et aucune ne remplace l'autre.

---

## 5. Ce que ce banc ne prouve pas

- **Il ne remplace ni une revue de code, ni un test unitaire.** Il vérifie des comportements observables, pas des cas limites.
- **Il ne teste pas l'analyse satellite.** Le fournisseur n'est pas joignable depuis la CI — analyse live **NON VÉRIFIÉE**, cf. chantier C9.
- **Il ne prouve pas que l'application déployée fonctionne.** Il exécute `next start` sur un runner, avec une base jetable. Une panne de configuration Vercel, de réseau ou de DNS reste invisible d'ici.
- **Il ne teste pas le rendu des pages.** Il interroge l'API et les sondes ; les 18 pages ne sont pas parcourues par un navigateur. Un composant cassé à l'hydratation passerait.
- **Il écrit et ne nettoie pas.** Il est prévu pour une base jetable.

---

## 6. Les trois petits défauts corrigés au passage

Relevés en démarrant réellement l'application, aucun n'était visible en CI :

| Défaut | Correction |
|---|---|
| `/api/health` renvoyait `version: "inconnue"` en production (`npm_package_version` n'existe pas sous `next start`) | constante `src/lib/version.ts` + `check:version` + contrôle en exécution |
| Aucun `.nvmrc`, aucun `engines` : la CI épingle Node 20, un poste peut être en 22 | `.nvmrc`, `engines.node`, `check:version` compare les deux |
| Rien ne détectait une dérive entre `schema.ts` et `drizzle/` | `npm run check:schema`, en CI sur la base ; falsifié (colonne fantôme → exit 1) |
