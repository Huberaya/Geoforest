# Rotation des secrets et intégrité de la chaîne d'audit

**Document :** « Rotation des secrets et intégrité de la chaîne d'audit (Geoforest, 2026-10-19) »
**Auteur :** Agent Arena.ai (Arena.ai — Agent Mode)
**Statut :** procédure **écrite, non exécutée**. Aucun secret n'a été changé.

> ⚠️ Ce document ne contient **aucune valeur de secret**, ni actuelle ni
> historique. Les commandes ci-dessous lisent les secrets depuis
> l'environnement ; elles ne les affichent jamais.

---

## 1. Rotation des secrets

### 1.1 Inventaire à traiter

| Secret | Où il est lu | Portée d'une fuite |
|---|---|---|
| Mot de passe du rôle PostgreSQL applicatif | `DATABASE_URL` | accès aux données de toutes les organisations, sous réserve de la RLS |
| Mot de passe du rôle administratif | `DATABASE_URL_ADMIN` | accès total, **contourne la RLS** |
| Clé de signature des jetons | variable d'environnement d'authentification | forge de jetons, donc usurpation |
| Clé GFW | variable d'environnement d'analyse | quota consommé, coût |
| Mot de passe des comptes de démonstration | `SEED_DEMO_PASSWORD` | connexion aux comptes de démonstration |

Les secrets historiquement présents dans le dépôt — mot de passe du rôle
applicatif (cf. `scripts/sql/post-migrate/010_row_level_security.sql`,
§ P1-10b) et mot de passe de démonstration (cf. `scripts/seed-auth.ts`,
§ P3-04) — sont à considérer comme **publics**. Les retirer du dépôt ne les
retire pas de l'historique Git : seule une rotation les neutralise.

### 1.2 Ordre d'exécution

1. **Geler** : noter l'heure de début, interdire tout déploiement pendant
   l'opération.
2. **Créer la nouvelle valeur** sans supprimer l'ancienne (coexistence).
3. **Déployer** la nouvelle valeur sur l'environnement.
4. **Vérifier** (voir 1.3).
5. **Révoquer** l'ancienne valeur, seulement après une vérification réussie.
6. **Consigner** : date, environnement, secret concerné, opérateur, résultat
   de la vérification. **Jamais la valeur.**

Pourquoi cet ordre : révoquer avant de déployer provoque une indisponibilité ;
déployer avant de vérifier empêche de distinguer un déploiement raté d'une
rotation ratée.

### 1.3 Vérifications après rotation

| Contrôle | Commande | Attendu |
|---|---|---|
| Connexion applicative | `psql "$DATABASE_URL" -c 'select current_user'` | le rôle applicatif, pas le propriétaire |
| Rôle sans `BYPASSRLS` | `select rolbypassrls from pg_roles where rolname = current_user` | `false` |
| Connexion administrative | `psql "$DATABASE_URL_ADMIN" -c 'select current_user'` | le rôle administratif |
| Authentification | connexion sur `/api/v1/auth/login` avec un compte réel | 200, jeton délivré |
| Ancien secret inopérant | `psql "<ancienne URL>" -c 'select 1'` | **échec d'authentification** |
| Analyse GFW | un audit de parcelle de recette | `source` cohérente, pas `unavailable` |

### 1.4 Retour arrière

Le retour arrière n'est possible que **tant que l'ancienne valeur n'est pas
révoquée**. C'est pourquoi l'étape 5 est la dernière. Si la vérification
échoue :

1. redéployer l'ancienne valeur (toujours valide à ce stade) ;
2. ne pas révoquer ;
3. diagnostiquer avant de retenter.

Une fois l'ancienne valeur révoquée, il n'y a **pas** de retour arrière : la
rotation doit être refaite avec une nouvelle valeur.

### 1.5 Absence de divulgation

- Aucun secret dans un fichier versionné, un journal, un message de commit, une
  sortie de test ou une capture.
- Les commandes ci-dessus lisent les variables d'environnement ; elles ne les
  affichent pas (`psql` affiche le rôle, jamais le mot de passe).
- Un secret transite par le coffre-fort de l'hébergeur, jamais par un ticket,
  un courriel ou une conversation.
- Si une valeur a été exposée, elle est révoquée même si l'on croit qu'elle
  n'a pas servi : on ne peut pas prouver qu'elle n'a pas servi.

---

## 2. Rotation des comptes de démonstration

Voir `docs/SECURITE_RISQUES_RESIDUELS_2026-10-19.md` § E3 pour l'inventaire.

1. Exécuter la requête d'inventaire sur **chaque** environnement (lecture
   seule).
2. Pour chaque compte trouvé : **désactiver** (`status = 'disabled'`) plutôt
   que supprimer — la suppression efface la trace de ce qui s'est connecté.
3. Vérifier qu'aucune session active ne subsiste (`gf_sessions`).
4. Si le compte doit rester, imposer un mot de passe neuf via le parcours de
   réinitialisation, puis vérifier la connexion.
5. Consigner la date de fin pour chaque environnement.

Critère de clôture : plus aucun compte de démonstration actif avec un mot de
passe antérieur à la date de retrait du littéral.

---

## 3. Intégrité de la chaîne d'audit

### 3.1 État réel

La chaîne **n'existe pas**. `src/lib/audit-log.ts` insère des lignes dans
`audit_logs` sans chaînage cryptographique. Le fichier l'annonce lui-même :
« Le journal inaltérable append-only reste à construire — cf. P1-10 ».

Conséquence mesurable : une ligne modifiée, insérée ou supprimée par un accès
direct à la base — administration, sauvegarde restaurée, script — ne laisse
**aucune trace détectable**. Une vérification périodique n'a donc rien à
vérifier aujourd'hui.

### 3.2 Schéma minimal qui rendrait la vérification possible

Non implémenté. Décrit pour être discuté avant d'être écrit :

| Colonne | Rôle |
|---|---|
| `seq` | numéro d'ordre monotone par organisation ; détecte un trou |
| `prev_hash` | empreinte de la ligne précédente ; détecte une réécriture |
| `hash` | `sha256(seq ‖ prev_hash ‖ contenu canonique)` |
| `created_at` | déjà présent |

Propriétés à tenir :

- l'application n'a **pas** le droit de mettre à jour ni de supprimer
  (`revoke update, delete` — déjà fait pour les tables, à étendre) ;
- deux lignes ne peuvent pas partager `seq` dans une même organisation
  (contrainte d'unicité) ;
- l'écriture se fait dans la **même transaction** que l'opération journalisée,
  sinon un événement peut manquer sans que la chaîne le signale.

### 3.3 Vérification périodique (à implémenter)

```
pour chaque organisation :
    lire les lignes par seq croissant
    vérifier que seq est contigu à partir de 1
    vérifier que prev_hash == hash de la ligne précédente
    recalculer hash et comparer
```

Fréquence proposée : quotidienne, plus un contrôle à la demande avant tout
export réglementaire.

### 3.4 Détection et alerte

| Signal | Interprétation | Action |
|---|---|---|
| `seq` non contigu | ligne supprimée | **alerte critique** — gel des exports, conservation des journaux |
| `prev_hash` incohérent | ligne insérée ou réécrite | **alerte critique** — même traitement |
| `hash` recalculé différent | contenu modifié | **alerte critique** |
| chaîne vide pour une organisation active | journal désactivé ou base restaurée | **alerte** — vérifier la sauvegarde |

L'alerte doit partir vers un canal **hors** de la base vérifiée : une
altération qui toucherait aussi le canal d'alerte ne serait pas vue.

### 3.5 Ce qui reste à décider

- Périmètre : toutes les organisations ou seulement celles en cours de
  déclaration ?
- Rétention : la purge (`scripts/purge-retention.ts`) doit-elle archiver les
  hashes avant de supprimer des lignes ? Sans cela, la purge crée un trou et
  ressemble à une altération.
- Coût : une écriture chaînée sérialise les insertions par organisation. À
  mesurer avant de généraliser.

---

*Document « Rotation des secrets et intégrité de la chaîne d'audit
(Geoforest, 2026-10-19) » établi par **Agent Arena.ai** (Arena.ai — Agent
Mode). Aucune rotation n'a été exécutée ; aucune base n'a été modifiée.*
