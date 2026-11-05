# Rotation des secrets — procédure et registre

**Chantier C2** — 4 novembre 2026
**Statut :** procédure écrite. **Aucune rotation n'a été exécutée** par l'agent (voir §3).

**Référence interne :** `EP-02`, anomalie `AN-18`.

> ⚠️ Un rapport d'audit externe (`AUDIT-GEOFOREST-2026-11-04.md`) était cité ici.
> Ce fichier n'existe pas dans le dépôt : la référence était morte. Les constats
> utiles ont été reportés dans ce document et dans `docs/TEST_REPORT.md`.

**Révisé le 05/11/2026** après les chantiers C5 et C6 :
- deux secrets ne figuraient pas dans cette procédure et le seront désormais
  (`GF_STORAGE_SIGNING_SECRET`, `BACKEND_API_TOKEN`) ;
- un défaut de cache rendait la rotation d'`AUTH_SECRET` **inopérante à chaud** :
  corrigé, et vérifié par `npm run check:rotation-secrets`.

---

## 1. Pourquoi ce document existe

Trois secrets ont été, ou sont encore, exposés. Les traiter « plus tard » est la
manière habituelle de ne jamais les traiter :

| Secret | Nature de l'exposition | Conséquence si non traité |
|---|---|---|
| Mot de passe du rôle **`geoforest_app`** | A figuré **en clair** dans `scripts/sql/post-migrate/010_row_level_security.sql`, dans un **dépôt public**. Retiré du fichier, mais **conservé dans l'historique Git**. | Quiconque a lu le dépôt peut se connecter à la base applicative. La RLS est alors la seule barrière — et elle ne protège pas de la lecture d'une organisation par une connexion légitime. |
| Mot de passe de **démonstration** | Codé en dur (`Trace!Demo2026x`), utilisé par défaut et **affiché** par `scripts/seed-auth.ts`. | Générait des comptes administrateur à mot de passe public sur toute base où le script était lancé. **Corrigé le 04/11** (C2) : valeur refusée nommément, jamais affichée. |
| **`AUTH_SECRET`** | Non exposé à ce jour, mais jamais tourné depuis la mise en service ; sa rotation est la seule réponse à une compromission suspectée (tous les jetons d'accès deviennent invalides). | Un jeton forgé reste valide indéfiniment. |
| **`GF_METRICS_TOKEN`** | Idem : jamais tourné. | `/api/metrics` et `/api/observability/alertes` resteraient accessibles à qui détient l'ancien jeton. |

> ⚠️ **Nettoyer l'historique Git ne remplace pas la rotation.** Une valeur publiée
> est compromise définitivement : la réécrire dans le passé ne la retire pas des
> clones, des caches, des forks ni des journaux de CI. La rotation est la seule
> mesure qui rend la fuite sans effet.

---

## 1 bis — Trois précautions avant de toucher à quoi que ce soit

Elles ne sont pas de la prudence de principe : chacune correspond à une façon
documentée de casser le service pendant une rotation.

**1. Pas de `&`, `?`, `#`, `%` ni `@` dans un mot de passe de rôle.** Il voyage
dans une URL (`postgresql://role:motdepasse@hôte/base`). Un `@` coupe l'URL au
mauvais endroit, un `?` ouvre une fausse chaîne de paramètres. Le symptôme est
trompeur : l'application démarre puis échoue à l'authentification, parce que le
rôle lu n'est plus `geoforest_app` mais un fragment de la chaîne. Utiliser
`openssl rand -hex 32` (chiffres et `a`–`f` uniquement) plutôt que `-base64`.

**2. Les deux URLs Neon sont distinctes, et le restent.** Une URL Neon sans
utilisateur explicite (celle qu'on copie depuis la console) se connecte en
`neondb_owner` — rôle qui porte `BYPASSRLS`, donc qui **voit toutes les
organisations**. Construire celle du produit à la main en remplaçant le nom
d'utilisateur, et vérifier avec `verifier-role.ts` qu'elle répond bien
`Rôle « geoforest_app »`.

**3. Le nom du rôle n'est pas imposé nominativement par le code** : le contrôle
se fonde sur les attributs (superutilisateur, `BYPASSRLS`, propriété des tables,
droits de `DELETE`), pas sur le nom. Renommer le rôle ne casse donc pas le
contrôle — mais toute la documentation, les scripts et les `grant` nomment
`geoforest_app`. S'en tenir à ce nom évite de rendre la procédure fausse.

**Le vrai piège de la rotation ratée** n'est pas la valeur oubliée : c'est le
changement appliqué **à un seul endroit**. Poste de travail roté et Vercel non,
ou l'inverse. Le symptôme est une authentification qui échoue de façon
intermittente selon l'environnement, donc difficile à attribuer. Règle : on
note l'ancienne valeur, on fait le changement partout **dans la même fenêtre**,
et on ne la jette qu'après vérification aux deux endroits.

## 2. Procédure, secret par secret

### 2.1 — Rôle applicatif `geoforest_app` *(priorité la plus haute)*

**Générer** un mot de passe de 32 octets, jamais réutilisé :

```bash
openssl rand -base64 32
```

**Poser** le mot de passe sur chaque environnement, avec le rôle propriétaire
(console SQL de Neon, ou `psql` en `DATABASE_URL_ADMIN`) :

```sql
alter role geoforest_app login password '<nouveau mot de passe>';
```

**Mettre à jour** `DATABASE_URL` (le rôle applicatif) — **pas** `DATABASE_URL_ADMIN`,
qui doit rester le rôle propriétaire. Confondre les deux fait perdre le
cloisonnement (cf. `docs/DEPLOYMENT_VERCEL.md` §3).

**Vérifier** immédiatement :

```bash
DATABASE_URL='postgresql://geoforest_app:NOUVEAU@…/neondb?sslmode=require' \
DATABASE_URL_ADMIN='postgresql://neondb_owner:…@…/neondb?sslmode=require' \
  npx tsx scripts/verifier-role.ts      # doit afficher « Rôle conforme », code 0
```

⚠️ **Les deux variables sont obligatoires**, et c'est un piège que ce document
contenait : `verifier-role.ts` ne contrôle pas seulement le rôle applicatif, il
contrôle aussi que les deux connexions sont **distinctes**. Sans
`DATABASE_URL_ADMIN`, `src/db/admin.ts` se replie sur `DATABASE_URL`, les deux
rôles deviennent identiques et le script sort en **code 1 « Rôle non conforme »**
sur un environnement parfaitement sain. Une commande de vérification qui échoue
toujours est pire qu'aucune commande : elle apprend à ignorer le rouge.

**En cas de doute :** ne pas supprimer ce contrôle, corriger les variables.

Puis redémarrer l'application et contrôler `/api/health` : le composant
`role_base` doit être `ok`. Si le serveur refuse de démarrer, c'est que le rôle
ne convient pas — ne pas mettre `GF_CONTROLE_ROLE=off` pour passer outre.

**Procédure pas à pas (Neon) :**

1. **Choisir une fenêtre courte mais réelle.** Les connexions ouvertes par
   l'ancien pool ne sont pas invalidées par `alter role` : elles continuent
   jusqu'à leur fermeture. Sur Neon, la coupure est donc progressive, et c'est
   une bonne raison de redéployer juste après plutôt que d'attendre.
2. **Générer une valeur compatible URL** : `openssl rand -hex 32` (§1 bis,
   précaution 1).
3. Neon → *SQL Editor*, en tant que `neondb_owner` :
   ```sql
   alter role geoforest_app login password '<nouvelle valeur>';
   ```
   La même commande fonctionne en `psql` avec `DATABASE_URL_ADMIN`.
4. Reporter la nouvelle valeur dans `DATABASE_URL` sur Vercel — **et seulement
   dans celle-là**. `DATABASE_URL_ADMIN` garde le mot de passe du propriétaire.
5. Si l'URL passe par le *pooler* Neon (`-pooler` dans l'hôte), vérifier que le
   nom d'utilisateur reste `geoforest_app` : le pooler exige parfois la forme
   `role.base`, et une faute de frappe ici produit une erreur d'authentification
   qui ne dit pas son nom.
6. Redéployer, puis vérifier `verifier-role.ts` (§2.1) **et** `/api/health`.
7. Remplir le registre §4.

**Ne jamais** exécuter `alter role geoforest_app ... ` puis oublier Vercel : la
base accepte le nouveau mot de passe, l'application présente l'ancien. Le
symptôme est une authentification impossible pour tous les utilisateurs, alors
que la base est parfaitement saine — et le message d'erreur côté produit
(`rôle ou mot de passe invalide`) n'indique pas laquelle des deux valeurs est
périmée.

### 2.2 — `AUTH_SECRET`

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Effet de bord **attendu** : tous les jetons d'accès et de rafraîchissement
deviennent invalides. Toutes les sessions actives sont déconnectées. À planifier
hors heures ouvrées, et à annoncer.

⚠️ **Ce que la déconnexion ne fait pas.** Les cookies de session déjà posés chez
les visiteurs portent un jeton signé avec l'ancienne clé. Ils sont rejetés à la
vérification suivante — c'est le comportement voulu — mais ils restent dans le
navigateur jusqu'à expiration. Ce n'est pas un problème de sécurité : un jeton
invalide est un jeton invalide. C'est un problème de **support** : les
utilisateurs voient une déconnexion sans explication, au moment où ils
travaillaient. Prévenir avant vaut mieux que de répondre après.

**Procédure pas à pas :**

1. Noter l'ancienne valeur quelque part de sûr (gestionnaire de mots de passe),
   pas dans un fichier du dépôt. Elle servira uniquement à revenir en arrière.
2. Générer la nouvelle valeur (commande ci-dessus).
3. **Production** sur Vercel : *Settings → Environment Variables → `AUTH_SECRET`
   → Edit*. Choisir `openssl rand -base64url 48` — l'alphabet `base64url` évite
   `+`, `/` et `=`, qui n'ont pas de sens particulier ici mais compliquent la
   copie manuelle.
4. Poser la **même** valeur sur l'environnement *Preview* si des avant-premières
   sont utilisées pour tester l'authentification. Une avant-première avec
   l'ancien secret ne peut pas lire les jetons de production : ce n'est pas une
   panne, c'est une configuration à connaître.
5. **Redéployer** (*Deployments → Redeploy*). Depuis le 05/11/2026, le cache est
   invalidé dès que la variable change, donc un redémarrage ordinaire suffit —
   mais un redéploiement reste la façon la plus simple de n'avoir aucun doute.
6. Vérifier : se connecter, puis `GET /api/health` → 200. Une tentative avec
   l'**ancienne** valeur de secret doit échouer, c'est ce que prouve
   `check:rotation-secrets` avant l'opération.
7. Remplir la ligne correspondante du registre §4, et **seulement alors** jeter
   l'ancienne valeur.

**Revenir en arrière** : remettre l'ancienne valeur et redéployer. Cela rétablit
les jetons encore valides — ce qui est précisément pourquoi on ne fait pas cette
rotation « pour voir », et pourquoi un retour arrière après une compromission
avérée annule la mesure.

⚠️ **Ce qui a changé (05/11/2026).** La valeur du secret était mise en cache au
premier accès, définitivement. Après rotation, le processus continuait de
signer et de vérifier avec l'**ancienne** valeur jusqu'à son redémarrage. La
rotation ne prenait donc effet que par le redémarrage — et une rotation ratée
(variable posée sur un seul environnement, faute de frappe, déploiement
partiel) restait invisible.

Le cache est désormais invalidé dès que `AUTH_SECRET` change. Redémarrer reste
**recommandé** : c'est plus sûr, et cela vide aussi les autres caches de
processus. Ce n'est plus ce qui fait la rotation.

### 2.3 — `GF_METRICS_TOKEN`

```bash
openssl rand -hex 32
```

Mettre à jour les collecteurs de supervision **avant** l'application, sinon
`/api/metrics` répond 401 et la supervision se tait — une panne silencieuse.

### 2.5 — `GF_STORAGE_SIGNING_SECRET` *(ajouté le 05/11/2026)*

Signe les URLs de téléchargement des pièces justificatives. Refusé au démarrage
s'il fait moins de 32 caractères ou s'il porte la valeur de développement
(`src/lib/storage/url-signee.ts`).

```bash
openssl rand -base64 48
```

⚠️ **Effet de bord : tous les liens de téléchargement déjà émis deviennent
invalides.** C'est le comportement voulu — un lien signé qui survivrait à la
rotation du secret serait un lien qui ne dépend pas de lui. À annoncer aux
utilisateurs ayant des téléchargements en cours.

### 2.6 — `BACKEND_API_TOKEN` *(ajouté le 05/11/2026, chantier C5)*

Ferme le backend FastAPI. Sans lui, toutes les routes métier répondent `503` —
voir `docs/SECURITE-BACKEND.md`.

```bash
openssl rand -base64 48
```

Mettre à jour l'appelant **avant** le backend si un client automatisé existe,
sinon ses appels passent en `503`. Aucun client navigateur ne doit le porter :
une variable `NEXT_PUBLIC_*` finit dans le bundle public.

### 2.4 — `SEED_DEMO_PASSWORD`

Aucune rotation : la valeur n'existe plus dans le code. Elle est désormais
**fournie à l'exécution** et **refusée** si elle est trop courte, si elle
correspond à l'ancienne valeur publiée, ou si la base cible n'est pas locale.
Vérification : `npm run check:seed` (10 contrôles, dont 6 exécutent réellement
le script en sous-processus).

---

## 3. Ce que l'agent n'a pas fait, et pourquoi

- **Aucune variable d'environnement n'a été modifiée**, ni sur Vercel, ni sur
  Neon : la consigne de l'audit l'interdit explicitement, et l'accès Vercel est
  refusé depuis cet environnement (`list_projects` → *access denied*).
- **Aucun secret n'est consigné dans ce dépôt** — ni en clair, ni haché, ni
  « pour exemple ». Les commandes de génération sont données ; les valeurs sont
  à produire sur le poste de l'exploitant.

---

## 4. Registre — à remplir par l'exploitant

Chaque ligne doit être **datée et signée**. Une rotation non tracée est
indiscernable d'une rotation non faite.

| Secret | Environnement | Roté le | Par | Vérification (`verifier-role.ts` / `/api/health`) | Incident déclenché |
|---|---|---|---|---|---|
| `DATABASE_URL` (rôle `geoforest_app`) | Neon — production | _à remplir_ | | | |
| `DATABASE_URL` (rôle `geoforest_app`) | Neon — préproduction | _à remplir_ | | | |
| `AUTH_SECRET` | Vercel — production | _à remplir_ | | déconnexion globale constatée ☐ | |
| `AUTH_SECRET` | Vercel — preview | _à remplir_ | | | |
| `GF_METRICS_TOKEN` | Vercel — production | _à remplir_ | | `/api/metrics` → 200 ☐ | |
| `GF_STORAGE_SIGNING_SECRET` | Vercel — production | _à remplir_ | | téléchargement d'une pièce → 200 ☐ | |
| `BACKEND_API_TOKEN` | Vercel — production | _à remplir_ | | `/fastapi/api/v1/health` → 200 ☐ ; `/fastapi/api/v1/audits` → 410 ☐ | |

---

## 4 bis — Vérification avant rotation

```bash
npm run check:rotation-secrets
```

Treize contrôles, qui prouvent **avant** la rotation qu'elle aura l'effet
attendu :

| Ce qui est prouvé | Pourquoi ça compte |
|---|---|
| Un jeton signé avec l'ancien secret est **rejeté** après rotation | Sans cela, la rotation change une variable sans fermer les sessions |
| Un jeton signé avec le nouveau secret est accepté | La rotation ne doit pas casser l'application |
| Un secret de moins de 32 caractères est refusé en production | Une valeur faible passerait pour une rotation |
| La valeur de développement est refusée en production | Idem, avec une valeur connue de tous |
| La procédure cite des fichiers qui existent | Elle renvoyait vers un rapport supprimé |
| Tout secret en service est couvert par la procédure | Deux manquaient |

⚠️ Ce contrôle **ne fait pas** la rotation et ne lit aucun secret réel. Il
empêche de découvrir la procédure inopérante le jour où on l'applique.

## 5. Critère de clôture du chantier C2

| # | Critère | Vérifiable par | État |
|---|---|---|---|
| 1 | `next` ≥ 16.4.5 (CVE critique fermée) | `node -p "require('./node_modules/next/package.json').version"` | ✅ 16.4.5 |
| 2 | 0 vulnérabilité sur les dépendances de **production** | `npm run audit:prod` | ✅ « found 0 vulnerabilities » |
| 3 | 0 vulnérabilité **haute ou critique** toutes dépendances confondues | `npm audit --audit-level=high` | ✅ code 0 (16 modérées restantes, toutes dans la chaîne ESLint de développement) |
| 4 | Mot de passe de démonstration : aucune valeur par défaut, jamais affiché | `npm run check:seed` | ✅ 10/10 |
| 5 | Le banc **échoue** sur l'ancienne version fautive | substitution du fichier `HEAD` → 8 échecs / 10 | ✅ mesuré |
| 6 | `AUTH_SECRET` tourné en production | registre §4 | ⛔ **en attente de l'exploitant** |
| 7 | Mot de passe `geoforest_app` tourné sur Neon | `verifier-role.ts` + registre §4 | ⛔ **en attente de l'exploitant** (dépend du chantier C4) |

**C2 n'est donc pas clos :** les critères 1 à 5 sont remplis et prouvés, les
critères 6 et 7 exigent un accès Neon/Vercel qui n'est pas disponible ici. Un
chantier de sécurité qui se déclarerait terminé sans la rotation effective
serait exactement le genre de fausse assurance que cet audit reproche au produit.
