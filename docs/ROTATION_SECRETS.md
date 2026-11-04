# Rotation des secrets — procédure et registre

**Chantier C2** — 4 novembre 2026
**Statut :** procédure écrite. **Aucune rotation n'a été exécutée** par l'agent (voir §3).

**Référence :** `EP-02` du registre d'anomalies (`AUDIT-GEOFOREST-2026-11-04.md`, AN-18).

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
DATABASE_URL='postgresql://geoforest_app:…@…/neondb?sslmode=require' \
  npx tsx scripts/verifier-role.ts      # doit afficher « Rôle conforme », code 0
```

Puis redémarrer l'application et contrôler `/api/health` : le composant
`role_base` doit être `ok`. Si le serveur refuse de démarrer, c'est que le rôle
ne convient pas — ne pas mettre `GF_CONTROLE_ROLE=off` pour passer outre.

### 2.2 — `AUTH_SECRET`

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Effet de bord **attendu** : tous les jetons d'accès et de rafraîchissement
deviennent invalides. Toutes les sessions actives sont déconnectées. À planifier
hors heures ouvrées, et à annoncer.

### 2.3 — `GF_METRICS_TOKEN`

```bash
openssl rand -hex 32
```

Mettre à jour les collecteurs de supervision **avant** l'application, sinon
`/api/metrics` répond 401 et la supervision se tait — une panne silencieuse.

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

---

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
