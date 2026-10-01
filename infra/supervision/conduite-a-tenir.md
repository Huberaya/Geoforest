# Conduite à tenir

 Que faire quand le produit signale quelque chose. Chaque alerte porte un
`code`, une `gravite`, des `mesures` chiffrées et une `action` : ce document
reprend les codes et dit ce que les chiffres signifient.

> ⚠️ **Une alerte sans destinataire n'est pas une alerte.** Ce document suppose
> que le dispositif du §3 de `mise-en-route.md` est en place : un
> supervisionnaire qui tourne hors du processus, et quelqu'un pour recevoir.
> Tant que ce n'est pas le cas, le produit journalise et n'avertit personne.

---

## Comment lire une alerte

```json
{
  "code": "base_injoignable",
  "gravite": "critique",
  "composant": "base",
  "titre": "Base de données injoignable",
  "message": "…",
  "action": "…",
  "mesures": { "disponible": false, "latenceMs": 1 },
  "ts": "2026-10-01T15:57:47.544Z",
  "etat": "déclenchée"
}
```

Trois champs décident de l'urgence :

- `gravite` — `critique` (service interrompu, intervention immédiate) ·
  `majeure` (dégradation, intervention dans l'heure) · `mineure` (à traiter,
  pas à réveiller) ;
- `etat` — `déclenchée` · `résolue`. **Une résolution n'est pas du bruit :**
  sans elle, l'astreinte ne sait jamais si elle peut cesser d'intervenir ;
- `mesures` — la valeur observée **et** le seuil. Lorsqu'une astreinte reçoit
  une alerte à trois heures du matin, la première question est « depuis quand et
  à combien ». Une alerte qui ne sait pas répondre fait perdre du temps au pire
  moment.

---

## Codes d'alerte

### `base_injoignable` · critique · composant `base`

La base ne répond pas. Aucune lecture ni écriture ne peut aboutir : **le service
ne tient plus sa promesse de persistance** (P0-07 — un accusé de dépôt ne doit
jamais être délivré pour une écriture non durable).

1. `/api/health` doit répondre **503** et `/api/ready` **503**. Si ce n'est pas
   le cas, le problème est dans le produit, pas dans PostgreSQL — ne pas
   commencer par redémarrer la base.
2. Vérifier PostgreSQL : `pg_isready`, espace disque du volume de données,
   nombre de connexions.
3. Vérifier les identifiants : `DATABASE_URL` pointe vers le rôle applicatif,
   `DATABASE_URL_ADMIN` vers le rôle de contournement RLS. Une migration passée
   avec le mauvais rôle laisse des tables sans cloisonnement (P1-04).
4. L'instance doit être **retirée du pool**, pas redémarrée.

> ⚠️ Une base injoignable est aussi le moment où la **piste d'audit est
> indisponible** — elle est dans la base. Le journal applicatif est alors la
> seule trace : c'est pour cela que les événements d'authentification y sont
> consignés en double.

### `stockage_inutilisable` · critique · composant `stockage`

L'aller-retour d'écriture sur le support des pièces échoue. Les dépôts de
documents ne peuvent pas être honorés : un dossier de diligence diligente
incomplet n'est pas transmissible (P0-06, P0-07).

1. La sonde a **écrit, relu, comparé puis effacé** — ce n'est pas un test
   d'existence de répertoire. L'échec est donc réel : permissions, disque plein,
   ou compartiment révoqué.
2. Vérifier `mesures.support`. Si c'est un support jamais validé (S3 sans
   compartiment réel), le produit a dû le **refuser au démarrage** — cf. P1-02.
3. Tant que ce composant est en panne, **ne pas accepter de dépôt** : mieux vaut
   un refus explicite qu'un document qu'on croit conservé.

### `disque_sature` · majeure · composant `disque`

Occupation au-delà de `GF_ALERT_DISQUE_POURCENT` (80 % par défaut), mesurée sur
le **répertoire de travail de l'application**, pas sur la racine.

1. Purger les journaux (§6 de `mise-en-route.md`) et les pièces obsolètes.
2. Agrandir le volume.
3. ⚠️ Un disque plein empêche aussi la journalisation : on perd les traces au
   moment où elles serviraient le plus. C'est pourquoi la règle `disque` existe
   séparément du journal.

### `sauvegarde_absente` · majeure, ou mineure si non configurée

- **mineure** = `GF_BACKUP_DIR` n'est pas déclaré. Aucune restauration n'est
  possible, **et rien ne surveillait cette absence**. Ce n'est pas une panne,
  c'est un trou de dispositif : traiter en journée, pas la nuit.
- **majeure** = le répertoire est déclaré mais la sauvegarde est absente, vide
  ou plus vieille que `GF_ALERT_SAUVEGARDE_H`.

1. Relancer la sauvegarde.
2. **Vérifier une restauration.** Une sauvegarde jamais restaurée n'est pas une
   sauvegarde.

### `gfw_indisponible` · majeure · composant `gfw`

Le fournisseur satellite (Global Forest Watch) échoue.

1. Vérifier la clé d'API, le quota, l'état du service.
2. ⚠️ **Le produit doit refuser d'émettre un verdict plutôt que de le simuler**
   (P0-04). Une analyse de couverture forestière « à peu près » ferait courir un
   risque réglementaire bien supérieur à l'indisponibilité.
3. `non_configure` (aucun appel enregistré depuis le démarrage) n'est **pas**
   `ok` : sa disponibilité n'est simplement pas mesurée. Ne pas lire cet état
   comme une bonne nouvelle.

### `taux_5xx:<route>` · critique · composant `api`

Plus de `GF_ALERT_TAUX_5XX` % d'erreurs serveur sur une route, avec au moins
`GF_ALERT_TRAFIC_MIN` requêtes dans la fenêtre.

1. Relever l'identifiant de corrélation d'une requête en échec
   (`X-Request-Id`, renvoyé au client et reproduit dans la réponse 500).
2. `grep` ce seul identifiant dans le journal : on obtient toutes les lignes de
   cette requête, toutes couches confondues. C'est la raison d'être de
   l'identifiant de corrélation.
3. Le trafic minimal n'est pas une subtilité : 2 % sur 2 requêtes ne veut rien
   dire, et une alerte qui se déclenche sur trois requêtes est du bruit.

### `latence:<route>` · mineure · composant `api`

p95 au-delà de `GF_ALERT_LATENCE_P95_MS`.

> ⚠️ Le p95 est **estimé sur un échantillon borné**, par processus, et la
> mesure est annoncée comme telle (`precision` dans `/api/metrics`). Une valeur
> affichée n'est pas une valeur exacte : c'est un indicateur de tendance, pas
> une mesure de laboratoire. Ne pas régler un incident sur 30 ms d'écart.

---

## Diagnostic, dans l'ordre

```bash
# 1. Le service répond-il, et que dit-il de lui-même ?
curl -s http://127.0.0.1:3000/api/health | jq '.status, .composants, .notice'

# 2. Peut-on lui confier des écritures ?
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/ready

# 3. Que s'est-il passé, et depuis quand ?
curl -s -H "Authorization: Bearer $GF_METRICS_TOKEN" \
     http://127.0.0.1:3000/api/metrics | jq '.routes'

# 4. Quelles alertes sont en cours ?
curl -s -H "Authorization: Bearer $GF_METRICS_TOKEN" \
     http://127.0.0.1:3000/api/observability/alertes | jq '.etats'

# 5. Une évaluation immédiate, sans attendre la boucle.
curl -s -X POST -H "Authorization: Bearer $GF_METRICS_TOKEN" \
     -H 'Content-Type: application/json' -d '{}' \
     http://127.0.0.1:3000/api/observability/alertes | jq '.envois'
```

`POST {"aVide": true}` vide la mémorisation de déduplication **sans rien
envoyer**. Il sert à repartir d'un état connu après un incident, pas à
réémettre : une réémission serait un doublon indiscernable d'une rechute.

---

## Corréler un signalement utilisateur

Un utilisateur qui dit « ça ne marche pas » peut désigner une requête précise :
l'identifiant `X-Request-Id` figure dans l'en-tête de la réponse. Le produit le
renvoie aussi dans le corps des erreurs 500 (`requestId`).

```bash
grep '3f8c1a0e2b7d4915' var/log/app.log | jq '.'
```

⚠️ L'identifiant fourni par le client n'est **jamais recopié tel quel** : il
doit avoir la forme `[A-Za-z0-9_-]{8,64}`, sinon il est remplacé. Accepter
n'importe quelle chaîne permettrait à un appelant d'écrire ce qu'il veut dans le
journal.

---

## Ce que ce dispositif ne dit pas

À garder en tête en plein incident, pour ne pas surinterpréter :

- Les mesures sont **par processus**. Devant trois instances, chacune ne
  connaît qu'elle-même ; le total n'est connu de personne.
- Le p95 est **estimé sur un échantillon borné**, pas calculé exactement.
- L'absence d'alerte ne prouve pas l'absence de panne : elle prouve que la
  dernière évaluation n'a rien trouvé. Si le supervisionnaire est tombé, le
  silence est trompeur — **le supervisionnaire est lui-même à superviser**
  (unité systemd avec `Restart=always`).
- Les transports Sentry, OpenTelemetry et PagerDuty n'ont **jamais** été
  exécutés contre leur service réel. Ils sont livrés marqués non validés et ne
  s'activent qu'avec `GF_ALERT_ACCEPT_NON_VALIDE=1`.
