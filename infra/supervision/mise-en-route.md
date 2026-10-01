# Mise en route de la supervision

Procédure d'installation du dispositif de monitoring, de journalisation et
d'alerting du chantier **P1-06**.

> ⚠️ **Lire ceci avant toute mise en production.**
> Ce document décrit ce qui a été **réellement exécuté et mesuré**, et ce qui
> ne l'a **jamais été**. La distinction est le cœur du chantier : un adaptateur
> qui n'a jamais parlé au service qu'il prétend joindre est livré **marqué non
> validé et refusé par défaut**. Le marquer validé sans avoir joué la recette
> correspondante, c'est transformer un incident silencieux en incident bruyant
> — pire, en incident qu'on croit surveillé.

---

## 1. État de validité

| Élément | État | Preuve |
|---|---|---|
| Journal structuré (JSON, une ligne par événement) | 🟢 validé | `var/log/app.log`, suite P1-06 §A |
| Identifiant de corrélation (`X-Request-Id`) | 🟢 validé | suite P1-06 §B |
| Réduction des secrets avant journalisation | 🟢 validé | suite P1-06 §C + banc `check-p106-regles.ts` §B |
| Mesures par route (compteurs, p95, taux 5xx) | 🟢 validé | suite P1-06 §D |
| Exposition Prometheus | 🟡 format produit, jamais ingéré | suite P1-06 §D — le texte est conforme, **aucun collecteur ne l'a jamais lu** |
| Sondes `/api/health` (vivacité) et `/api/ready` (aptitude) | 🟢 validé | suite P1-06 §E |
| Base injoignable ⇒ 503 + alerte | 🟢 validé | suite P1-06 §F — **base réellement coupée** |
| Détection < 2 min avec alerte envoyée | 🟢 validé | **18 s mesurés**, intervalle de supervision 20 s |
| Déduplication et annonce de résolution | 🟢 validé | suite P1-06 §G |
| Page de statut publique `/status` | 🟢 validé | suite P1-06 §I |
| Transport `journal-local` | 🟢 validé | `var/alertes/alertes.jsonl` |
| Transport `webhook` | 🟢 validé | alerte reçue par un processus tiers |
| Transport `sentry` | 🔴 **non validé** — refusé par défaut | jamais exécuté contre Sentry |
| Transport `otlp` (OpenTelemetry) | 🔴 **non validé** — refusé par défaut | jamais exécuté contre un collecteur |
| Transport `pagerduty` | 🔴 **non validé** — refusé par défaut | jamais exécuté contre PagerDuty |
| Sauvegarde (`GF_BACKUP_DIR`) | ⚪ **non configurée ici** | aucune restauration n'a jamais été jouée |
| Rotation des journaux | ⚪ **non mise en œuvre** | à faire côté infrastructure (§6) |
| Tableau de bord | ⚪ **inexistant** | aucune sonde n'a jamais été affichée |

---

## 2. Variables d'environnement

Aucune n'est obligatoire : le produit démarre sans supervision, et c'est
volontaire — un service qui refuse de démarrer parce qu'un collecteur est absent
est un service qu'on ne peut plus redémarrer en plein incident.

### Journalisation

| Variable | Défaut | Rôle |
|---|---|---|
| `GF_LOG_LEVEL` | `info` | `debug` · `info` · `warn` · `error` |
| `GF_LOG_FILE` | `var/log/app.log` hors production ; **désactivé en production** | `off` désactive le fichier |

> ⚠️ En production (`NODE_ENV=production`), le fichier de journal est **désactivé
> par défaut** : c'est le collecteur de l'infrastructure qui ramasse la sortie
> standard. Écrire en plus sur le disque d'une instance éphémère, c'est écrire
> au mauvais endroit. Pour le réactiver malgré tout, renseigner
> `GF_LOG_FILE=/chemin` explicitement.

### Alertes

| Variable | Défaut | Rôle |
|---|---|---|
| `GF_ALERT_FILE` | `var/alertes/alertes.jsonl` | journal local des alertes (`off` désactive) |
| `GF_ALERT_WEBHOOK` | — | URL de destination (POST JSON) |
| `GF_ALERT_WEBHOOK_TIMEOUT_MS` | `5000` | délai d'abandon de l'envoi |
| `GF_ALERT_ACCEPT_NON_VALIDE` | — | `1` = **autorise** les transports non validés. Ne pas activer en production sans avoir joué la recette du §5 |

### Seuils

| Variable | Défaut | Rôle |
|---|---|---|
| `GF_ALERT_TAUX_5XX` | `2` | % d'erreurs 5xx déclenchant une alerte, sur la fenêtre |
| `GF_ALERT_TRAFIC_MIN` | `10` | trafic minimal pour juger un taux — 2 % sur 2 requêtes ne veut rien dire |
| `GF_ALERT_FENETRE_MIN` | `5` | fenêtre glissante du taux d'erreur, en minutes |
| `GF_ALERT_LATENCE_P95_MS` | `2000` | p95 au-delà duquel une route est jugée dégradée |
| `GF_ALERT_DISQUE_POURCENT` | `80` | occupation disque déclenchant une alerte |
| `GF_ALERT_SAUVEGARDE_H` | `25` | ancienneté maximale de la dernière sauvegarde |
| `GF_ALERT_COOLDOWN_S` | `900` | délai de garde : une alerte déjà active n'est pas renvoyée avant |

### Sondes et mesures

| Variable | Défaut | Rôle |
|---|---|---|
| `GF_METRICS_TOKEN` | — | jeton d'accès à `/api/metrics` et `/api/observability/alertes` |
| `GF_HEALTH_STRICT` | — | `1` = « dégradé » répond 503 également |
| `GF_DISK_PATH` | répertoire de travail | point de montage à mesurer |
| `GF_BACKUP_DIR` | — | répertoire des sauvegardes à surveiller |
| `GF_VERSION` | `npm_package_version` | version affichée par `/api/health` |
| `GF_SUPERVISE_URL` | `http://127.0.0.1:3000` | base scrutée par `scripts/supervise.ts` |

---

## 3. Mise en route, dans l'ordre

### 3.1 Déclarer la destination des alertes

```bash
export GF_ALERT_WEBHOOK="https://hooks.example.net/geoforest"
export GF_METRICS_TOKEN="$(openssl rand -hex 32)"   # à conserver dans le coffre
```

> ⚠️ Le jeton est comparé en temps constant sur des condensats, mais il circule
> **en clair dans l'en-tête** : HTTPS est obligatoire, sinon le jeton se lit sur
> le réseau.

Vérifier :

```bash
curl -s -H "Authorization: Bearer $GF_METRICS_TOKEN" \
     http://127.0.0.1:3000/api/observability/alertes | jq '.transports'
```

`webhook` doit apparaître `{"valide": true, "actif": true}`. `sentry`, `otlp`
et `pagerduty` doivent apparaître `{"valide": false, "actif": false}`.

### 3.2 Déclarer les sauvegardes

Sans `GF_BACKUP_DIR`, le composant `sauvegarde` est `non_configure` — **jamais
`ok`**. Une sauvegarde absente et une sauvegarde non configurée ont la même
conséquence (aucune restauration possible) mais n'ont pas le même message :
dire « sauvegarde en retard » là où rien n'a jamais été configuré laisserait
croire qu'un dispositif existe et qu'il est tombé.

```bash
export GF_BACKUP_DIR="/var/backups/geoforest"
```

Le répertoire doit contenir un fichier par sauvegarde, horodaté par sa date de
dernière modification (`mtime`). Exemple de tâche planifiée :

```cron
0 2 * * * pg_dump -Fc app_db > /var/backups/geoforest/app_db-$(date +\%F).dump
```

> ⚠️ **Une sauvegarde jamais restaurée n'est pas une sauvegarde.** La recette
> d'acceptation est en §5.4 ; elle n'a jamais été jouée ici.

### 3.3 Lancer le supervisionnaire

> ⚠️ Le supervisionnaire tourne **hors du processus supervisé**. Un
> supervisionnaire hébergé par ce qu'il surveille mourrait avec lui, et
> n'annoncerait jamais la panne qu'il doit annoncer.

```bash
GF_METRICS_TOKEN="$GF_METRICS_TOKEN" \
GF_SUPERVISE_URL="http://127.0.0.1:3000" \
  node --import tsx scripts/supervise.ts --intervalle 20
```

Unité systemd :

```ini
[Unit]
Description=Supervision GeoForest Trace
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/srv/geoforest
Environment=GF_METRICS_TOKEN=…          # ou EnvironmentFile=/etc/geoforest/supervision.env
Environment=GF_SUPERVISE_URL=http://127.0.0.1:3000
ExecStart=/usr/bin/node --import tsx scripts/supervise.ts --intervalle 20
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

> ⚠️ `Restart=always` est indispensable ici, et c'est le contraire de ce qu'on
> veut pour l'application : le supervisionnaire doit se relever seul, sinon une
> panne met le service **et** son gardien hors service.

**Le choix de l'intervalle fixe le délai de détection.** Mesuré : 18 s avec un
intervalle de 20 s. `scripts/supervise.ts --une-fois` permet un appel depuis
cron si l'on préfère ne pas avoir de processus permanent.

### 3.4 Vérifier que l'alerte part vraiment

```bash
curl -s -X POST -H "Authorization: Bearer $GF_METRICS_TOKEN" \
     -H 'Content-Type: application/json' -d '{}' \
     http://127.0.0.1:3000/api/observability/alertes | jq '.envois'
```

Chaque envoi porte le résultat **par transport**. Un envoi « réussi » selon
l'émetteur ne prouve rien : relire ce que le destinataire a reçu. C'est
précisément pourquoi la suite P1-06 s'appuie sur
`scripts/recepteur-alertes.ts`, un processus tiers qui écrit ce qu'il reçoit.

---

## 4. Ce que mesure chaque sonde

| Sonde | Question | Échec ⇒ |
|---|---|---|
| `/api/health` | le processus répond-il, et de quoi a-t-il besoin ? | 503 si un composant **critique** est indisponible : à retirer du pool |
| `/api/ready` | peut-on lui confier des écritures ? | 503 : à retirer du pool, **sans redémarrage** |
| `/api/metrics` | quelles routes, quelles latences, quels échecs ? | — (lecture) |

> ⚠️ **Ne pas confondre les deux premières.** Redémarrer une instance parce
> qu'un équilibreur l'a retirée aggrave l'incident : on perd le cache, les
> sessions en vol, et on rallonge la panne.

Composants de `/api/health` :

| Composant | Critique | Mesure |
|---|---|---|
| `base` | ✅ | `select 1`, latence |
| `stockage` | ✅ | aller-retour réel (écrire, relire, comparer, effacer) |
| `disque` | — | occupation du **répertoire de travail**, pas de la racine |
| `sauvegarde` | — | ancienneté du dernier fichier de `GF_BACKUP_DIR` |
| `gfw` | — | taux d'échec des appels enregistrés |
| `api` | — | taux de 5xx et p95 observés |

> ⚠️ « dégradé » ≠ « indisponible ». Une instance dont la sauvegarde a du retard
> rend encore un service correct : la sortir du pool transformerait un incident
> mineur en interruption. Elle répond **200** et c'est une **alerte** qui est
> émise — l'outil adapté. `GF_HEALTH_STRICT=1` met les deux à 503, pour les
> déploiements qui préfèrent retirer l'instance au moindre doute.

---

## 5. Recettes d'acceptation — à jouer sur l'infrastructure réelle

Aucune de ces recettes n'a été jouée ici. **Tant qu'elle ne l'est pas, le
transport correspondant reste `valide: false`.** Chacune énonce son critère
d'échec : une recette qu'on ne peut pas faire échouer ne prouve rien.

### 5.1 Transport Sentry

1. Renseigner `SENTRY_DSN`.
2. Provoquer une erreur 5xx réelle.
3. **Critère** : l'événement apparaît dans Sentry **avec** l'identifiant de
   corrélation et **sans** aucun secret.
4. **Contre-épreuve** : couper le réseau vers Sentry, reprovoquer l'erreur.
   L'application ne doit pas échouer, et l'alerte doit quand même partir par le
   journal local. Un transport d'alerte qui peut faire tomber le produit est
   plus dangereux que pas de transport du tout.

### 5.2 Transport OpenTelemetry (OTLP)

1. Pointer `OTEL_EXPORTER_OTLP_ENDPOINT` vers un collecteur réel.
2. Générer du trafic.
3. **Critère** : les métriques apparaissent côté collecteur avec les mêmes noms
   que `GET /api/metrics` (`geoforest_http_requests_total`, …).
4. **Contre-épreuve** : collecteur arrêté — aucune requête ne doit être
   ralentie ni refusée.

### 5.3 Transport PagerDuty

1. Renseigner la clé d'intégration.
2. Provoquer `base_injoignable` (arrêter PostgreSQL).
3. **Critère** : un incident PagerDuty est **créé**, puis **résolu** quand la
   base revient. Une intégration qui sait créer mais pas résoudre laisse
   l'astreinte éveillée pour rien.
4. **Contre-épreuve** : clé révoquée — l'échec doit être journalisé, pas silencieux.

### 5.4 Sauvegarde

1. Jouer `pg_dump` dans `GF_BACKUP_DIR`.
2. **Critère** : le composant `sauvegarde` passe de `non_configure` à `ok`.
3. **Restaurer** la sauvegarde sur une base jetable et comparer le nombre de
   lignes de `gf_users`, `gf_plots`, `gf_documents`.
4. **Contre-épreuve** : vieillir le `mtime` du fichier (`touch -d '-2 days'`) —
   l'alerte `sauvegarde_absente` doit passer de « mineure » à « majeure ».

### 5.5 Équilibreur de charge

1. Configurer `/api/health` comme sonde de vivacité, `/api/ready` comme sonde
   d'aptitude.
2. Arrêter PostgreSQL.
3. **Critère** : l'instance est retirée du pool en moins de deux fois
   l'intervalle de la sonde, **sans être redémarrée** par l'orchestrateur.

---

## 6. À faire côté infrastructure

Ces points ne sont pas dans le produit et ne doivent pas y être : ils relèvent
de l'exploitation.

- **Rotation des journaux.** Sans elle, `var/log/app.log` finit par remplir le
  disque — et le disque plein est précisément l'incident que la journalisation
  doit permettre d'anticiper. `logrotate` avec `copytruncate`, ou collecteur
  vers un entrepôt.
- **Conservation des alertes.** `var/alertes/*.jsonl` est un append local : à
  exporter, sinon l'historique des incidents disparaît avec l'instance.
- **Agrégation multi-instances.** Les mesures sont **par processus**
  (`portee: "processus"` dans `/api/metrics`) et le p95 est **estimé sur un
  échantillon borné**. Devant plusieurs instances, chaque instance ne connaît
  qu'elle-même : c'est le collecteur qui agrège.
- **Tableau de bord.** Aucun n'existe. Une ébauche : taux de 5xx par route, p95
  par route, occupation disque, ancienneté de sauvegarde, état de chaque
  composant. ⚪ non réalisé, donc non mesuré.
- **Astreinte.** Sans personne pour recevoir, une alerte est un bruit de plus.
  Le dispositif technique ne vaut que par l'organisation qui le reçoit.
