# Supervision du worker documentaire — profil candidat

> **Actualisation 08p — 29 septembre 2026.** Le worker utilise désormais `SandboxScanner` et `sandbox_format` par défaut, sans fallback. La composition sous systemd a passé une recette locale PG/S3 émulé/ClamAV réel, y compris arrêts et reprises. Les passages ci-dessous décrivant les adaptateurs « non activés » ou l'ancien profil sont historiques (08n/08o). Voir [rapport 08p](../rapports/08p-worker-sandbox-supervise.md) pour les concessions du profil et les limites. L'API n'a pas été modifiée ; aucun déploiement ou GO production.


29 septembre 2026 · chantier 08n · **préparation et essais système locaux sur programmes synthétiques**.

Aucun worker métier, timer permanent, antivirus réel ou service cloud n'a été activé. Ce profil ne lève ni les blocages stockage du [lot 08m](qualification-stockage-ue.md), ni l'interdiction de migration cloud du candidat SQL 0008.

## 1. Objectif et périmètre

Préparer l'exécution périodique du worker existant `python -m app.documents.worker --once`, borner sa durée et ses ressources, éliminer ses descendants après arrêt forcé et restreindre son accès au système.

**Ce n'est pas encore une sandbox antivirus séparée.** Le worker et ses enfants partagent une identité et des permissions réseau. L'environnement minimal du scanner ne l'empêche pas à lui seul de lire les informations accessibles au même UID, notamment celles de son parent. Ne pas traiter `ProtectProc=invisible` comme une séparation de sécurité entre processus de même identité. Une compromission du parseur/antivirus n'est donc pas neutralisée par le seul profil proposé.

## 2. Fichiers livrés

- `infra/document-worker/geoforest-document-worker.service` : service systemd oneshot, non installé.
- `infra/document-worker/geoforest-document-worker.timer` : cadence proposée, non installée/non activée.
- `infra/document-worker/worker.env.example` : variables autorisées, placeholders exclusivement.
- `scripts/audit-document-worker-profile.py` : comparaison hors ligne du profil candidat avec le contrat versionné ; aucune commande système ou connexion.
- `scripts/qualify-worker-systemd.py --run-local-synthetic` : épreuves locales opt-in avec unités transitoires fictives ; nécessite systemd/cgroup v2 et des droits administrateur locaux.
- `backend/tests/worker_supervision/test_profile.py` : tests du contrat, des refus et du nettoyage de la recette.

Aucun fichier d'application, règle SQL, mécanisme de quarantaine, résultat de scan ou garde fournisseur n'est modifié par ce lot.

## 3. Cycle d'exécution proposé

### Cadence et non-chevauchement

Le timer cible un seul nom de service, de type `oneshot`. Une activation de cette même unité ne crée pas un second processus principal lorsqu'elle est déjà en cours. Le démarrage initial est proposé 60 secondes après boot ; les suivants 30 secondes après inactivité, avec jusqu'à 5 secondes de décalage aléatoire et 1 seconde de précision.

`Restart=no` : pas de boucle de redémarrage interne non bornée. Le timer propose une nouvelle activation après l'inactivité, y compris après échec. Cela limite la fréquence des relances, **pas leur nombre total**. Les trois tentatives et leases par job restent régis par la file SQL existante. `Persistent=no` ne transforme pas la cadence monotone en rattrapage massif des activations manquées.

La cadence et l'absence de chevauchement sont ici des propriétés du profil préparé, **pas une mesure de charge d'un worker relié à PostgreSQL/S3**. Plusieurs hôtes ou autres noms de services restent possibles ; leurs conflits doivent être maîtrisés par les leases SQL et une politique d'exploitation.

### Durée et descendants

- `TimeoutStartSec=270s` borne le traitement oneshot ; ne pas utiliser `RuntimeMaxSec` comme unique borne pour ce type de service.
- `TimeoutStopSec=10s`, `KillMode=control-group`, SIGTERM puis SIGKILL.
- Budget nominal d'exécution/arrêt de 280 secondes, inférieur au lease actuel de cinq minutes. Il ne remplace pas la vérification transactionnelle du jeton et de l'expiration en SQL.
- Un enfant créant une nouvelle session reste dans le cgroup du service. Le test réel vérifie son absence après le timeout, même s'il ignore SIGTERM.

Un arrêt ne doit jamais produire un statut de scan favorable par défaut. Un job interrompu attend l'expiration/reprise prévue par la file ; aucune modification manuelle de son statut n'est proposée. Un crash autour d'un commit peut laisser un résultat déjà validé : inspecter l'état SQL/audit avant de conclure à l'échec métier.

## 4. Enveloppe de ressources et restrictions

| Paramètre candidat | But / limite |
|---|---|
| UID/GID dédiés `geoforest-worker` | Non-root ; aucun groupe privilégié ; à provisionner seulement sur l'hôte autorisé |
| `NoNewPrivileges=yes`, capacités vides | Pas d'acquisition de privilèges supplémentaires via l'exécution |
| `ProtectSystem=strict`, `ProtectHome=yes` | Système en lecture seule, dossiers personnels inaccessibles |
| `TemporaryFileSystem` | `/tmp` privé de 256 Mio et `/var/tmp` privé de 32 Mio, `nosuid,nodev,noexec` |
| `PrivateTmp=no` | Choix intentionnel : les deux tmpfs bornés fournissent déjà les espaces temporaires du namespace ; ne pas les masquer par un autre mécanisme de tmp privé |
| `MemoryMax=3G`, `MemorySwapMax=0` | Limites cgroup mémoire/swap ; pas un benchmark du moteur antivirus |
| `CPUQuota=200%`, `TasksMax=32` | Deux CPU équivalents au maximum et borne tâches/processus/threads |
| `LimitNOFILE=256`, `LimitCORE=0`, `UMask=0077` | Fichiers privés, descripteurs bornés, pas de core dump du processus |
| Signatures et moteur en lecture seule | `/var/lib/clamav` et `/opt/clamav`, chemins à préparer ; aucune mise à jour de signatures par le worker |
| Configuration sensible masquée | Fichier env injecté par le gestionnaire de service, puis inaccessible dans le namespace ; pas de `.env` applicatif partagé |
| Restrictions noyau, namespaces, périphériques, temps réel | Réduire les opérations permises au service ; aucune prétention d'invulnérabilité |

Le programme ne doit pas stocker une preuve durable dans ces tmpfs : leur contenu disparaît à l'arrêt. Les données peuvent être en clair en mémoire temporaire ; ce n'est pas une garantie d'effacement sécurisé. L'administrateur/kernel de l'hôte reste dans le périmètre de confiance.

Le dimensionnement doit être mesuré avec le vrai ClamAV, ses bases et les formats autorisés. Les tests de ce lot vérifient les valeurs cgroup et la taille/les options des montages, **pas une charge de 3 Gio, l'épuisement des tâches ou la tenue de débit**. Un dépassement doit maintenir le document en quarantaine et déclencher une alerte ; la chaîne complète reste à éprouver.

### Détails révélés par les essais

Les premières recettes n'observaient pas les bons montages temporaires. Elles mélangeaient `PrivateTmp`, une identité `DynamicUser` modifiant implicitement l'isolation et des paramètres de montages transitoires. Une expérimentation avec `NoExecPaths` sur les mêmes chemins masquait aussi les tmpfs attendus sur cet hôte.

La version finale : identité synthétique fixe non privilégiée lors de la recette, `PrivateTmp=no`, pas de `NoExecPaths` concurrent, montages temporaires explicitement `noexec`. Le lanceur `systemd-run` reçoit chaque montage dans un argument distinct, contrairement à la liste de l'unité native. Les assertions vérifient désormais **exactement 256 et 32 Mio**, et non une simple borne supérieure pouvant accepter un autre montage. Les essais initiaux sont conservés comme échecs intermédiaires, pas comme validations.

## 5. Réseau et secrets

Le candidat conserve `IPAddressDeny=any` et `IPAddressAllow=localhost`. **Il ne peut pas traiter un job contre un fournisseur distant tel quel**, sur un hôte où ces restrictions sont effectivement appliquées. Ne pas transformer la règle en `allow all` pour faire fonctionner le worker.

Avant usage : qualifier le support cgroup/BPF de l'hôte, DNS, IPv4/IPv6, les adresses du stockage et de la DB, leur renouvellement et une politique egress maintenable. Les ACL systemd portent sur des adresses, pas sur l'identité TLS d'un fournisseur ni sur les ports ; des règles de pare-feu complémentaires sont à étudier. Les vérifications TLS applicatives restent obligatoires. Le test présent ne couvre qu'un pair local IPv4, pas l'exhaustivité des chemins réseau.

Le test réseau positif utilise exceptionnellement une unité synthétique sans les filtres IP afin de prouver l'accessibilité d'un serveur TCP **sur cette même machine**. La seconde unité, avec le profil restrictif, ne peut pas établir la connexion. Aucune relaxation du fichier candidat n'est effectuée et aucune API fournisseur n'est contactée. Un timeout isolé sans témoin accessible n'aurait pas constitué cette preuve.

Le fichier environnement de production devra être hors Git, appartenir à root et être de mode 0600. Ne jamais recopier le `.env` de l'API. Aucun secret Clerk, token navigateur, clé de backup, rôle migrateur ou compte administrateur S3 ne doit être donné au worker. Le modèle est refusé par l'audit s'il contient des variables supplémentaires, des doublons ou de vraies valeurs à la place des placeholders : cet audit contrôle **le modèle public**, pas le fichier de secrets réel.

Le répertoire `/opt/geoforest` doit contenir un artefact propre, sans `.env`, dépôt d'identifiants ou données métier. Code, venv et moteur antivirus appartiennent à un administrateur et ne sont pas modifiables par le worker. Son compte SQL doit passer `verify_worker_role` ; son accès S3 doit passer les contrôles du coffre et la recette IAM. Aucun de ces comptes n'a été créé dans le cloud.

## 6. Antivirus : dépendances restantes

Le scanner existant exige ClamAV 1.4.6 et des signatures fraîches selon sa politique de 72 h, contrôle leur stabilité et ferme l'accès en cas d'indisponibilité. **Ce lot n'installe ni ne requalifie ClamAV et ne réalise pas de test EICAR réel.** Une version épinglée doit être revue pour les avis de sécurité avant production, pas conservée indéfiniment parce qu'elle était qualifiée précédemment.

Préparer ensuite un environnement de scan distinct, sans accès DB/S3 ni secrets du parent, avec échange borné des octets/empreintes et résultat vérifié. Le profil du worker ne suffit pas à cette séparation. Vérifier aussi l'isolation du parseur de formats.

La mise à jour des signatures doit utiliser une autre identité autorisée à écrire, avec source/intégrité vérifiées et publication cohérente. Ne pas donner au worker les droits d'updater. Tester mise à jour concurrente, indisponibilité, signatures périmées, résultat positif et fichier propre dans le profil final. Aucun service FreshClam n'est déployé ici.

## 7. Exploitation et alertes à raccorder

| Signal | Action attendue |
|---|---|
| Erreur `WORKER_UNAVAILABLE`, service failed, timeout/OOM | Alerte opérateur, diagnostic sans journaux de documents ; aucune libération de quarantaine |
| Absence d'activations alors que timer attendu | Contrôle externe de disponibilité du service/timer ; un service oneshot inactif entre deux jobs est normal |
| Âge des jobs en attente, leases expirés, tentatives épuisées | Mesure par mécanisme d'observation minimal à concevoir ; ne pas ouvrir les tables métier au worker pour faciliter un tableau de bord |
| Signatures périmées ou moteur indisponible | Alerte dédiée ; ne pas compter l'absence de détection comme un résultat favorable |
| Échec de réception d'alerte | Exercice régulier du canal de secours ; supervision extérieure au seul worker |

**Piège :** le worker peut retourner un code processus 0 après avoir enregistré `SCAN_UNAVAILABLE`, ou `accepted=false`. Le succès du service n'est pas une preuve de scan favorable ni de bonne santé de toute la file. Son JSON actuel ne fournit pas toutes les métriques métier nécessaires. Aucun tableau de supervision ni envoi d'alerte n'est livré ici ; ne pas annoncer l'astreinte opérationnelle.

### Arrêt pour maintenance/sauvegarde — procédure future

Sur l'hôte effectivement autorisé : arrêter le timer, puis le service courant ; contrôler l'inactivité du service et l'absence de descendants. Arrêter également tous les autres workers et writers API avant d'attester `--writers-stopped`. Arrêter seulement le timer ne termine pas le traitement en cours. Ne pas exécuter ces opérations contre un service de production depuis la recette synthétique.

La reprise doit conserver tentatives/leases et revue humaine ; la promotion des données restaurées reste une décision distincte. Voir le [guide de restauration](sauvegarde-restauration-coffre.md).

## 8. Reproduction locale et limites de la preuve

Audit sans privilège ni réseau :

```sh
.venv/bin/python scripts/audit-document-worker-profile.py
systemd-analyze verify infra/document-worker/geoforest-document-worker.service \
  infra/document-worker/geoforest-document-worker.timer
PYTHONPATH=backend .venv/bin/pytest --confcutdir=backend/tests/worker_supervision \
  backend/tests/worker_supervision -q
```

Recette système **uniquement sur une machine de développement isolée**, jamais sur l'hôte métier sans validation :

```sh
.venv/bin/python scripts/qualify-worker-systemd.py --run-local-synthetic
```

Le dernier script utilise `sudo -n` si nécessaire, crée des unités transitoires aux noms uniques `geoforest-synthetic-*`, puis demande leur arrêt dans un `finally`. Les programmes ne traitent que des données fictives. Une commande client interrompue ne doit pas laisser une unité tourner ; vérifier aussi l'absence d'unités à la fin. Il peut écrire brièvement un fichier sentinelle de test, et le supprime si une protection attendue échoue.

La recette remplace explicitement UID/GID par `nobody:nogroup`, le répertoire de travail et les programmes par des fixtures ; elle n'injecte pas de fichier environnement métier, n'utilise pas les chemins ClamAV et n'applique pas le marqueur d'autorisation. L'épreuve de timeout est accélérée à 2 + 1 secondes. Ces substitutions figurent dans le JSON. **Ce n'est pas le démarrage du worker applicatif sous son unité finale.**

L'audit valide seulement le contenu des trois fichiers candidats. Il ne lit ni unités installées, ni drop-ins, ni noyau, ni compte réel, ni état de scan ; son résultat maintient `production_authorized=false`, `host_isolation_verified=false` et `antivirus_qualified=false`. Toute personnalisation d'exploitation nécessite une revue des paramètres effectifs (`systemctl cat/show`, droits et tests), pas un simple passage de cet audit.

## 9. Conditions avant activation

1. Fournisseur runtime compatible, IAM et compte worker SQL qualifiés ; autorisation distincte pour la migration candidate et les coûts.
2. Hôte UE et exploitation approuvés ; identité dédiée et artefact immuable installés ; clés séparées.
3. Politique egress effective et maintenable ; aucun contournement de TLS ou du blocage public.
4. Vrai antivirus, parseurs, signatures, séparation vis-à-vis du parent, ressources et comportement sous charge qualifiés.
5. Intégration file/worker/S3, perte de lease, crash et reprise testées sous l'unité effective ; temps de traitement mesurés.
6. Alertes et procédure d'arrêt/restauration vérifiées.
7. Revue d'exploitation et GO explicite, puis seulement création du marqueur `/etc/geoforest/document-worker.qualified` et installation/activation contrôlée du timer.

Le marqueur est une condition opérateur, **pas une attestation cryptographique ni une validation automatique de ces sept points**. Il n'a pas été créé. Aucun fichier de service/timer métier n'a été installé sur cette machine.

## Suite 08o : sandbox réelle disponible, composition non activée

Le [lot sandbox documentaire](sandbox-documentaire.md) ajoute des adaptateurs isolés et une recette locale avec ClamAV réel. Le présent service reste inchangé : `RestrictNamespaces=yes` empêche leur lancement. Une composition révisée et testée est nécessaire avant raccordement ; les résultats isolés ne qualifient pas automatiquement cette unité.
