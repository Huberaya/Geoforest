# GeoForest — Runbook de production

Date : 14/10/2026 · Branche : `arena/c73246d2-geoforest`.

Statut du document : **projet, à valider par l'exploitant.** Il décrit les procédures réellement exécutées dans
l'environnement de test, et les prérequis non résolus. Il ne constitue pas une autorisation de mise en production
(voir le verdict dans `docs/BLOCKERS_RESOLUTION_REPORT.md`).

Documents liés : `docs/DEPLOYMENT_VERCEL.md` (hébergement), `docs/BACKUP_RESTORE_TEST.md` (preuves de sauvegarde),
`docs/EVIDENCE_ENGINE_SPEC.md` (pack de preuves), `docs/TRACES_SCOPE.md` (périmètre TRACES).

---

## 1. Secrets et variables obligatoires

Aucune valeur ne figure dans le dépôt. Chaque valeur se gère dans le coffre de l'exploitant. Le modèle est
`.env.example`. Le fichier `.env.local` n'est jamais versionné.

| Variable | Rôle | Obligatoire en production | Conséquence d'une absence |
|---|---|---|---|
| `DATABASE_URL` | connexion **applicative** (rôle `geoforest_app`, soumis à la RLS) | oui | le produit ne démarre pas |
| `DATABASE_URL_ADMIN` | connexion d'administration (migrations, amorçage, purge) | oui | migrations et sauvegardes impossibles |
| `AUTH_SECRET` | signature des jetons de session, ≥ 32 caractères | oui | refus de démarrer ; **sans la valeur d'origine, les sessions restaurées sont invalides** |
| `GF_STORAGE_SIGNING_SECRET` | signature des URLs de téléchargement, ≥ 32 caractères, distinct d'`AUTH_SECRET` | oui | **tout téléchargement de pièce renvoie HTTP 500** |
| `GFW_API_KEY` | analyse satellite Global Forest Watch | pour B1 | analyse refusée explicitement (pas de simulation) |
| `POSTGRES_PASSWORD`, `GF_APP_DB_PASSWORD` | mots de passe Docker Compose | oui (compose) | compose refuse de démarrer |

**Pièges connus.**
- `DATABASE_URL` doit pointer vers `geoforest_app`. L'URL fournie par l'hébergeur est souvent celle du propriétaire, qui
  contourne la RLS sans erreur visible. Le contrôle de démarrage (`src/instrumentation.ts`) refuse en production, et
  `/api/health` signale l'anomalie (composant `role_base`).
- Générer un secret : `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
- Une rotation de `GF_STORAGE_SIGNING_SECRET` invalide les liens en cours, sans autre conséquence.

## 2. Démarrage et contrôles

1. Définir les variables de la section 1. Vérifier qu'aucune valeur de développement n'est utilisée : en production,
   l'application refuse de démarrer avec la valeur de développement d'`AUTH_SECRET`, et refuse de signer des URLs avec
   celle de `GF_STORAGE_SIGNING_SECRET`.
2. Appliquer les migrations avec le rôle d'administration (`npm run db:migrate` ou procédure de `DEPLOYMENT_VERCEL.md`).
3. Démarrer l'application, puis vérifier :
   - `GET /api/health` : composant `role_base` conforme ;
   - `npx tsx scripts/verifier-chaine.ts` : chaîne du journal intacte pour chaque organisation.
4. Vérifier qu'un téléchargement de pièce renvoie HTTP 200. Une erreur 500 sur `/api/v1/documents/{id}/url` signale presque
   toujours `GF_STORAGE_SIGNING_SECRET` absent.

**Limite.** Docker Compose n'a pas été exécuté dans l'environnement de test (B3). Les variables sont obligatoires dans
`docker-compose.yml`, mais leur effet réel au démarrage n'est pas prouvé.

## 3. Sauvegarde

### 3.1 Procédure

```bash
# Variables : BACKUP_DATABASE_URL (ou DATABASE_URL_ADMIN), GF_STORAGE_DIR, PG_BIN_DIR si pg_dump n'est pas dans le PATH.
scripts/sauvegarde.sh /chemin/vers/sauvegardes
```

Produit `<horodatage>/` avec `base.dump`, `stockage.tar.gz`, `sauvegarde.json` et `MANIFEST.sha256`.

Règles :
- le `pg_dump` doit être de la même version majeure que le serveur, ou plus récent ; sinon le script refuse ;
- la base est dumpée **avant** l'archive du stockage. Pour un instantané cohérent, arrêter l'application pendant
  l'opération ;
- le mot de passe transite par l'URL (visible dans la liste des processus). En production, préférer `~/.pgpass`.

### 3.2 Ce qui n'est pas sauvegardé

`.env.local`, `AUTH_SECRET`, `GF_STORAGE_SIGNING_SECRET`, les mots de passe. Ils se conservent à part, dans le coffre.

### 3.3 Cadence et conservation : non définies

Aucune cadence ni rétention n'est implémentée. Avant tout pilote, l'exploitant doit fixer :
- le RPO (fréquence maximale de perte acceptable) et la cadence qui le respecte ;
- la rétention ;
- la copie hors site, et le chiffrement des sauvegardes (elles contiennent des données personnelles).

## 4. Restauration

### 4.1 Règles absolues

- **Ne jamais restaurer sur la base de production.** `restauration.sh` crée une base neuve et refuse `app_db`, mais la
  garantie reste procédurale : la variable `RESTORE_ADMIN_URL` doit pointer vers un cluster de test ou de reprise.
- Une restauration se fait toujours vers un dossier de stockage **vide**.
- Une base restaurée qui échoue au contrôle d'intégrité est laissée en place pour inspection. Elle n'est jamais réutilisée
  automatiquement : la supprimer ou la renommer est une décision d'exploitation.

### 4.2 Procédure

```bash
RESTORE_ADMIN_URL=postgresql://postgres:…@hote:5432/postgres \
scripts/restauration.sh /chemin/vers/sauvegardes/<horodatage> <nom_base_neuve> /chemin/vers/stockage_neuf
```

Étapes, dans l'ordre. Chacune peut arrêter la restauration :
1. vérification du `MANIFEST.sha256` — une sauvegarde altérée n'est jamais restaurée ;
2. refus si la base cible existe, si son nom est `app_db`, ou si le stockage cible n'est pas vide ;
3. création de la base, puis `pg_restore --no-owner --exit-on-error` ;
4. extraction du stockage ;
5. contrôle d'intégrité : `scripts/empreinte-sauvegarde.ts` (lignes, chaîne du journal, condensats des pièces, stockage).

### 4.3 Contrôle de service après restauration

Démarrer l'application sur la base restaurée (sur un port de test, jamais sur le port de production), puis :

```bash
E2E_BASE_URL=http://127.0.0.1:<port> E2E_PASSWORD=<mot de passe de test> \
REFERENCE_DATABASE_URL=<URL admin de la base d'origine> \
npx tsx --conditions=react-server scripts/check-restauration-app.ts
```

Le contrôle vérifie la connexion, le nombre de dossiers, et que chaque pièce est servie avec les mêmes octets que la
référence. Il ne fait que des lectures.

### 4.4 Après une restauration en production

1. Réinitialiser les sessions si `AUTH_SECRET` a changé (les sessions restaurées sont invalides sans la valeur d'origine).
2. Relancer `scripts/verifier-chaine.ts` sur la base restaurée.
3. Vérifier que le téléchargement d'une pièce renvoie HTTP 200.
4. Consigner la restauration : date, sauvegarde utilisée, résultat des contrôles, auteur.

## 5. Incidents et diagnostic

| Symptôme | Cause probable | Action |
|---|---|---|
| Téléchargement de pièce : HTTP 500, journal `GF_STORAGE_SIGNING_SECRET est absent` | variable non définie en production | définir la variable et redémarrer |
| Pack de preuves : HTTP 500 avec `{detail, piece}` | pièce absente du stockage, ou condensat différent | ne pas exporter ; comparer avec la sauvegarde ; l'export est refusé volontairement |
| Restauration refusée : `MANIFEST.sha256 absent` ou condensats différents | sauvegarde altérée ou incomplète | utiliser une autre sauvegarde ; ne pas recalculer le manifeste |
| Restauration refusée : base existante, ou stockage non vide | cible non vierge | choisir un nom ou un dossier neufs |
| `/api/health` signale `role_base` | connexion avec un rôle non conforme | corriger `DATABASE_URL`, redémarrer |
| `verifier-chaine.ts` en échec | modification directe du journal, ou base restaurée incomplète | ne pas poursuivre ; ouvrir un incident de sécurité |

Vérifier une archive de preuves hors ligne : `npx tsx scripts/verifier-pack.ts <archive.zip>` (code 0 : intacte ; 1 : anomalie).

## 6. Limites connues

Voir `docs/BACKUP_RESTORE_TEST.md`, section « Limites connues ». En résumé, pour la production :

- sauvegarde manuelle, sur un seul hôte, sans copie hors site, sans chiffrement, sans rétention ;
- RTO non mesuré ;
- stockage S3 (B6) non testé : le chemin n'a jamais été exécuté ;
- Docker Compose non exécuté (B3) ;
- la CSP est en mode « report-only » (B5) ;
- l'antivirus n'est pas branché : les pièces restent `NOT_SCANNED` (B4) ;
- la signature externe et l'horodatage qualifié des preuves ne sont pas en place : une archive peut être refaite par
  quiconque contrôle la base.

## 7. Journal des opérations

À tenir à jour par l'exploitant. Modèle :

| Date | Opération | Sauvegarde utilisée | Résultat | Auteur |
|---|---|---|---|---|
| 14/10/2026 | sauvegarde et restauration de test (environnement local) | `20261014T142534Z` | empreinte identique ; 25/25 contrôle applicatif | agent, chantier 5 |
