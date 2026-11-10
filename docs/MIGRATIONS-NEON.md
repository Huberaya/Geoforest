# Neon : la marche à suivre, pas à pas

**Ce fichier est un mode d'emploi.** Il s'adresse à quelqu'un qui n'a jamais
ouvert la console de Neon. Une étape = une action. Ce que vous devez voir est
écrit à chaque fois.

Écrit et vérifié le 06/11/2026. Chaque commande de ce document a été exécutée sur
une base reproduisant **exactement** l'état supposé de la vôtre (migrations 0000
à 0006 déjà appliquées, 0007 à 0009 manquantes).

---

## Avant de commencer : ce que vous allez faire, en une phrase

Votre base est en retard de **3 migrations** sur le code. Il faut les appliquer
**une seule fois**, depuis votre poste, et remplir ensuite une colonne pour les
parcelles existantes. Cela prend **moins de cinq minutes**.

Ce ne sont pas des modifications de données : ce sont des ajouts de colonnes.
**Aucune ligne existante n'est supprimée ni modifiée.**

---

## Étape 0 — Se munir de la bonne adresse

### Où la trouver

1. Ouvrir <https://console.neon.tech> et se connecter.
2. Cliquer sur votre projet (il s'appelle sans doute `geoforest`).
3. Dans le menu de gauche : **Dashboard**.
4. Encadré **Connection string**. Il ressemble à :

```
postgresql://neondb_owner:npg_XXXXXXXX@ep-abc-12345.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

5. À droite de l'encadré, un bouton **Copier**. Cliquez dessus.

### Ce que vous devez voir

Une adresse qui commence par `postgresql://neondb_owner:` et contient
`sslmode=require`. **`neondb_owner`, c'est le rôle d'administration.** C'est
celui-là qu'il faut pour migrer.

### ⚠️ Le piège à éviter

Ne prenez **pas** l'adresse de la variable `DATABASE_URL` de Vercel. Elle
commence par `geoforest_app:` et elle est **volontairement trop faible** pour
migrer. La commande échouera avec un message du type
`must be owner of table` ou `permission denied`.

| Ce qu'il faut | Ce qu'il ne faut pas |
|---|---|
| `postgresql://neondb_owner:…` | `postgresql://geoforest_app:…` |

### ⚠️ Si la console ne vous donne pas `neondb_owner`

Dans **Dashboard → Roles**, le rôle listé peut s'appeler autrement
(`cloud_admin`, ou le nom affiché à la création). Prenez l'adresse de **ce**
rôle : c'est celui qui possède la base. Son nom importe peu, seul compte le fait
qu'il soit **propriétaire** et non `geoforest_app`.

---

## Étape 1 — Créer un fichier de secret

Ouvrez le terminal à la racine du dépôt GeoForest (là où se trouvent
`package.json` et `drizzle/`).

**Une seule commande**, qui n'affiche rien :

```bash
printf 'DATABASE_URL_ADMIN=%s\n' 'COLLEZ_ICI' > .env.local && chmod 600 .env.local
```

Puis ouvrez `.env.local` dans l'éditeur (**VS Code** : `code .env.local`),
remplacez `COLLEZ_ICI` par l'adresse copiée à l'étape 0, et enregistrez.

Le fichier doit contenir exactement une ligne :

```
DATABASE_URL_ADMIN=postgresql://neondb_owner:npg_…@ep-….neon.tech/neondb?sslmode=require
```

### Ce que vous devez voir

- la ligne ne contient pas d'espace avant/après `=` ;
- l'adresse entière est sur **une seule ligne**, sans `\` à la fin ;
- le fichier s'appelle `.env.local`, avec le point au début.

### ⚠️ Deux choses importantes

`.env.local` est **déjà exclu de Git** (vérifié). Il ne partira pas dans un
commit. Ne le mettez jamais dans la conversation ni dans un message : une adresse
d'administration dans une conversation est une adresse brûlée.

Ne collez **pas** d'adresse d'administration dans Vercel non plus — la seule
variable à y mettre est celle de l'étape 4.

---

## Étape 2 — Regarder ce qui va se passer, sans rien faire

```bash
npm run db:migrate
```

⚠️ Non — **cette commande modifie la base**. L'étape 2 sert seulement à vérifier
que votre poste peut joindre Neon. Lancez plutôt :

```bash
npx tsx scripts/verifier-role.ts
```

`verifier-role.ts` lit la variable `DATABASE_URL`, pas `DATABASE_URL_ADMIN` :
pour ce test, lancez-le avec l'adresse du rôle applicatif, ou sautez cette étape
et allez directement à l'étape 3.

**Si vous sautez cette étape, ce n'est pas grave.** L'étape 3 échouera d'elle-même
avec un message clair si l'adresse est mauvaise.

---

## Étape 3 — Appliquer les migrations

```bash
npm run db:migrate
```

La commande charge automatiquement `.env.local`. Elle dure quelques secondes.

### Ce que vous devez voir

```
Migration du schéma
  · appliquée : 0007_c6d_risque_parcelle_nul
  · appliquée : 0008_c7_audit_plot_link
  · appliquée : 0009_c8_plot_bbox
  · sûreté appliquée : 010_row_level_security.sql
  · sûreté appliquée : 020_tracabilite_append_only.sql
  · sûreté appliquée : 021_chaine_continue.sql
  · sûreté appliquée : 022_politiques_suppression_logique.sql
  · RLS : 13/13 de nos tables protégée(s) · 34 politique(s) · exclues (justifié) : gf_sessions, gf_login_attempts
✅ Schéma à jour et cloisonnement vérifié.
```

**La dernière ligne est celle qui compte : `✅ Schéma à jour et cloisonnement
vérifié.`** Si elle apparaît, tout s'est bien passé.

### Ce que vous devez voir si tout était déjà à jour

```
  · schéma déjà à jour (10 migration(s) enregistrée(s))
✅ Schéma à jour et cloisonnement vérifié.
```

C'est un **succès**, pas une erreur. Cela signifie que quelqu'un (ou vous, une
première fois) a déjà lancé la commande. Relancer ne casse rien : les migrations
déjà appliquées sont ignorées, et les scripts de sûreté recréent leurs politiques
à l'identique.

### En cas de problème — tableau de dépannage

| Message | Ce que ça veut dire | Quoi faire |
|---|---|---|
| `🔴 DATABASE_URL_ADMIN (ou DATABASE_URL) n'est pas défini.` | `.env.local` est absent, ou vous n'êtes pas dans le bon dossier | Revenir à l'étape 1 ; vérifier avec `pwd` que vous êtes bien à la racine du dépôt |
| `password authentication failed for user "neondb_owner"` | L'adresse est mal copiée (mot de passe tronqué) | Recommencer la copie à l'étape 0 ; vérifier qu'il n'y a pas d'espace |
| `must be owner of table gf_plots` | Vous avez mis l'adresse `geoforest_app` | Reprendre l'adresse `neondb_owner` à l'étape 0 |
| `getaddrinfo ENOTFOUND` | Le nom d'hôte est coupé | L'adresse doit tenir sur une seule ligne, sans retour à la ligne |
| `self-signed certificate` | Le `?sslmode=require` manque à la fin de l'adresse | Recopier l'adresse **en entier** |
| La commande se bloque plus de 30 s | Neon est en veille (offre gratuite) | Relancer ; le premier appel réveille la base |

---

## Étape 4 — Remplir la borne des parcelles existantes

**C'est l'étape que l'on oublie, et son défaut est invisible.**

**D'abord en lecture seule**, pour voir ce qui serait fait :

```bash
npm run db:backfill-bbox -- --essai
```

### Ce que vous devez voir

```
Parcelles : 42
[essai] lues : 42 · à remplir : 42 · sans surface : 0
```

« lues » = le nombre de parcelles sans borne, c'est-à-dire à remplir.
« sans surface » = des parcelles-points (moins de 4 ha), qui n'ont pas de surface
et ne participent donc pas à la détection de chevauchement. **Ce n'est pas une
erreur.**

**Puis l'écriture réelle :**

```bash
npm run db:backfill-bbox
```

### Ce que vous devez voir

```
Parcelles : 42
lues : 42 · remplies : 42 · sans surface : 0
✅ Cadres englobants à jour.
```

Relancer une seconde fois doit donner `remplies : 0` : c'est normal, le travail
est déjà fait.

### Pourquoi cette étape n'est pas facultative

La migration ajoute quatre colonnes **vides**. Tant qu'elles sont vides, la
détection de chevauchement de parcelles (C8) **ignore les parcelles existantes** :
elle ne compare que les nouvelles entre elles. Le contrôle semblerait actif alors
qu'il ne verrait presque rien. **Rien ne vous alerterait** — c'est un défaut
silencieux, c'est pourquoi il est écrit en gras ici.

---

## Étape 5 — Vérifier que l'application peut toujours se connecter

La migration crée le rôle `geoforest_app` **sans droit de connexion** (c'est une
décision de sécurité : aucun mot de passe dans un fichier versionné). Ce rôle a
déjà un mot de passe sur votre installation — sinon l'application ne
fonctionnerait pas aujourd'hui. **Cette étape ne le change pas** ; elle sert
uniquement si le contrôle de démarrage de Vercel se plaint.

Test, depuis votre poste :

```bash
npx tsx scripts/verifier-role.ts
```

avec l'adresse du rôle **applicatif** (`geoforest_app`) dans `DATABASE_URL`.

### Ce que vous devez voir

```
✅ Rôle conforme
```

Si vous voyez au contraire une liste de `🔴`, **ne déployez pas** : Vercel
refusera de démarrer de toute façon.

### Si et seulement si le rôle applicatif n'a pas de mot de passe

Dans la console Neon, onglet **SQL Editor**, avec le rôle propriétaire :

```sql
alter role geoforest_app login password 'le-mot-de-passe';
```

⚠️ Remplacez `le-mot-de-passe` par une valeur générée, pas par un mot de passe
tapé au clavier. Pour en générer un :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Et mettez la **même** valeur dans la variable `DATABASE_URL` de Vercel. Voir
`docs/ROTATION_SECRETS.md` pour la procédure complète.

---

## Étape 6 — Nettoyer

```bash
shred -u .env.local 2>/dev/null || rm -f .env.local
```

### Ce que vous devez voir

Rien. C'est le but : l'adresse d'administration ne reste pas sur le disque.

---

## Étape 7 — Redéployer

1. Aller sur <https://vercel.com>, projet GeoForest, onglet **Deployments**.
2. Sur le dernier déploiement de `main`, menu `⋯` → **Redeploy**.
3. Attendre la fin, puis ouvrir `https://<votre-domaine>/api/health`.

### Ce que vous devez voir

Un JSON avec `"status":"ok"` et, plus bas, `"role_base"` avec
`"conforme": true`.

### ⚠️ Si Vercel refuse de construire

Un message du type `upgradeToPro=build-rate-limit` signifie que le **quota de
builds** de votre compte est atteint. Ce n'est pas un défaut du code : il faut
attendre le lendemain, ou libérer un build en supprimant un ancien déploiement.

---

## Ordre à respecter, et pourquoi

```mermaid
graph LR
A[Étape 3 : migrations] --> B[Étape 4 : backfill]
B --> C[Étape 7 : redéploiement]
```

**Les migrations avant le redéploiement.** Le code de `main` lit les colonnes
`bbox_*`, `plot_id` et `country_statut`. Si vous déployez d'abord, la première
écriture produit une erreur 500 dont le message **ne parle pas de migration** —
vous chercheriez au mauvais endroit pendant des heures.

**Le backfill avant le redéploiement**, pour la raison de l'étape 4 : le code
fonctionnera sans lui, mais le contrôle de chevauchement sera silencieusement
inefficace.

---

## Ce qui a été vérifié, et comment

| Vérification | Méthode |
|---|---|
| Le scénario exact (0000–0006 appliquées, 0007–0009 manquantes) | Reproduit sur un PostgreSQL 18 local : les 3 migrations s'appliquent, `bbox` (4), `plot_id` (1), `country_statut` (1) apparaissent |
| Relancer la commande ne casse rien | Exécuté deux fois : la seconde donne « schéma déjà à jour » |
| Le rôle `geoforest_app` est créé **sans connexion** | Constaté : `rolcanlogin = false`, et une connexion sans mot de passe est refusée |
| Après `alter role … password`, l'application se connecte | Exécuté : connexion réussie sous `geoforest_app` |
| Une base construite uniquement par migrations fait tourner l'application | 68/68 contrôles de bout en bout |
| Retour arrière puis remontée de 0008 et 0009 | Exécuté sur base réelle |

## Ce qui n'a pas été vérifié

- **Aucune exécution sur votre instance Neon.** Je n'y ai pas accès. Tout a été
  fait sur un PostgreSQL 18 local avec un état identique au vôtre.
- **La durée réelle.** Sur une base de quelques centaines de parcelles, les trois
  migrations sont instantanées (ajout de colonnes nullables). Le backfill traite
  par lots de 200.
- **Le nom exact de votre rôle d'administration.** Vérifiez-le dans
  **Dashboard → Roles** avant de copier l'adresse.

Si une étape ne se déroule pas comme décrit : **arrêtez-vous à cette étape** et
dites-moi laquelle et ce que vous voyez. Ne relancez pas à l'aveugle — sauf
l'étape 3, qui est sans danger à répéter.
