# Scanner et parseur en sandbox — qualification locale

> **Actualisation 08p — 29 septembre 2026.** Le worker utilise désormais `SandboxScanner` et `sandbox_format` par défaut, sans fallback. La composition sous systemd a passé une recette locale PG/S3 émulé/ClamAV réel, y compris arrêts et reprises. Les passages ci-dessous décrivant les adaptateurs « non activés » ou l'ancien profil sont historiques (08n/08o). Voir [rapport 08p](../rapports/08p-worker-sandbox-supervise.md) pour les concessions du profil et les limites. L'API n'a pas été modifiée ; aucun déploiement ou GO production.


29 septembre 2026 · lot 08o · **adaptateurs candidats éprouvés localement, non activés dans le worker ou l'API**.

## 1. Résultat et frontière de confiance

ClamAV **1.4.6 réel**, ses bases officielles et les parseurs PNG/JPEG/PDF ont été exécutés dans des namespaces Linux distincts. La recette vérifie l'absence des secrets sentinelles dans l'environnement et les descripteurs hérités, l'inaccessibilité du fichier sentinelle du parent, la séparation PID/réseau, l'impossibilité de joindre un serveur du parent et l'arrêt des descendants après timeout.

Le parent demeure de confiance : il vérifie les octets SHA-256, configure les montages, choisit le code/moteur et interprète les résultats. Le noyau, bubblewrap, le runtime `/usr`, les bibliothèques et l'opérateur qui fournit ces artefacts restent également dans le périmètre de confiance. **Une sandbox n'est pas une preuve d'absence de vulnérabilité noyau ou de détection de tout malware.**

Aucun document métier n'a été utilisé ou envoyé à un service antivirus externe. Seuls le moteur, sa signature, la clé publique et les bases officielles ont été téléchargés. Aucun compte cloud, abonnement, changement Neon ou déploiement Vercel.

## 2. Livrables

| Chemin | Rôle |
|---|---|
| `backend/app/documents/sandbox.py` | Lanceur rootless bubblewrap, limites et arrêt ; aucun repli vers une exécution non isolée |
| `sandbox_processing.py` | `SandboxScanner` et `sandbox_format`, adaptateurs candidats compatibles avec les objets du coffre |
| `sandbox_format_entry.py` | Entrée Python `-I -S` avec dépendances de format explicitement montées |
| `sandbox_probe.py` | Sondes fictives de frontière et d'arrêt des descendants, non exposées comme API |
| `scripts/qualify-document-sandbox.py` | Recette explicite sur fichier propre, EICAR, timeout et PNG ; JSON de résultats et empreintes |
| `backend/tests/sandbox_unit/` | Contrats, sorties invalides, erreurs et absence de fallback |
| `backend/tests/document_sandbox/` | Recette Linux réelle opt-in, ClamAV réel et fonction de traitement worker sur S3 émulé |

Le scanner historique, le parseur historique, `worker.py`, les routes et les gardes de production sont inchangés. Le raccordement est effectué **uniquement dans la recette**, en passant explicitement `SandboxScanner` et `sandbox_format` à `execute_job`.

## 3. Isolation mise en œuvre

### Environnement, processus et réseau

- `--unshare-all` et `--unshare-user` explicite : notamment namespaces PID, réseau et utilisateur distincts ; aucune option « try » utilisée pour le namespace utilisateur obligatoire.
- UID/GID **65534 à l'intérieur** du namespace, mappés à l'identité appelante à l'extérieur. Ce n'est pas la création d'un compte Unix de production.
- Capacités supprimées, NoNewPrivileges observé, nouveaux namespaces utilisateur interdits dans l'enfant (`--disable-userns`, vérification explicite et test `unshare` refusé).
- Environnement du lanceur réduit à PATH/LANG ; environnement du traitement recréé par bubblewrap. Aucun héritage de secrets DB, S3, Clerk ou de backup. La sonde utilise seulement une valeur sentinelle fictive.
- Descripteurs fermés sauf canaux nécessaires ; stdin transporte les octets, stdout le résultat borné, stderr est neutralisé. Le fichier sentinelle marqué héritable par le parent n'est pas transmis.
- `/proc` appartient au namespace PID enfant : le parent et son environnement ne sont pas visibles par ce montage. La recette compare aussi les identifiants de namespaces parent/enfant.
- Pas de réseau du parent : un serveur loopback est d'abord joint depuis le parent, puis inaccessible depuis l'enfant. Le namespace réseau privé ne constitue pas une preuve que tout appel socket est interdit : aucun filtre seccomp spécialisé n'est livré ici.

### Fichiers visibles

Racine nouvelle et lecture seule, `/usr` monté en lecture seule pour le runtime système, liens `/bin`, `/lib`, `/lib64`, `/proc` privé et `/dev` minimal en lecture seule. `/home`, `/etc` et `/run` hôtes ne sont pas montés. Le dépôt applicatif, `.env`, socket DB et clés de stockage ne sont jamais montés dans l'enfant.

Pour les formats : seuls le fichier d'entrée, le parseur existant, `PIL`, `pypdf` et les bibliothèques natives Pillow nécessaires sont ajoutés en lecture seule. **Pas de montage de tout le venv ni du package applicatif complet.** Python est lancé avec `-I -S`, puis le chemin de dépendances choisi est ajouté explicitement.

Pour ClamAV : seulement le binaire choisi, son répertoire de bibliothèques et les trois fichiers `daily`, `main`, `bytecode` retenus. Une signature doit être un fichier `.cvd` ou `.cld`, sans lien symbolique ; deux variantes du même nom ou un jeu incomplet sont refusés. Le répertoire parent des bases n'est pas exposé en bloc.

`/usr` et les bibliothèques du moteur restent des surfaces de code de confiance à maintenir propres : une installation contenant des secrets dans ces emplacements serait inadaptée. Les sources de montage doivent être immuables pour le worker et mises à disposition par l'opérateur. Les vérifications de chemins ne neutralisent pas un administrateur malveillant remplaçant ces artefacts.

### Ressources et arrêt

- Entrée au plus 20 Mio, timeout demandé strictement positif et au plus 90 secondes.
- Enveloppe de lancement : espace d'adressage 2 Gio, CPU 50 secondes, taille de fichier 80 Mio, 64 descripteurs, 64 processus au titre de RLIMIT_NPROC, core dump interdit.
- Le parseur conserve ses limites plus strictes existantes : 768 Mio, CPU 10 secondes, sortie fichier 4 Kio. L'antivirus conserve ses limites propres de taille, récursion, nombre de fichiers et CPU.
- `/tmp` privé de **128 Mio**, fichiers créés sous umask 0077 ; sa taille exacte et un fichier de mode 0600 sont vérifiés.
- Sortie lue au plus 65 537 octets, refus au-delà de 65 536 ; réponse de format limitée à 4 096 octets. Le fichier de capture peut atteindre la borne RLIMIT_FSIZE avant refus : ne pas présenter la limite de lecture comme une limite physique de 64 Kio.
- Timeout : destruction du groupe de lancement ; la terminaison du namespace PID élimine aussi un enfant créant sa propre session. La recette vérifie qu'aucun processus visible ne conserve le namespace après l'arrêt.

**Les rlimits ne sont pas un budget mémoire/CPU agrégé pour tous les descendants.** RLIMIT_NPROC dépend aussi de l'identité hôte. L'enveloppe cgroup du service final reste nécessaire. Ce lot ne prouve pas la tenue à une charge maximale, à une attaque de fork ou à tous les cas d'OOM.

Le tmpfs contient potentiellement des données en clair. Sa disparition n'est pas de l'effacement sécurisé ; la politique mémoire/swap de l'hôte et du cgroup final doit être qualifiée. Le profil bubblewrap présent ne revendique pas un montage temporaire `noexec` identique au profil systemd précédent.

## 4. Préservation du refus fermé

`SandboxScanner` garde les exigences existantes : version exacte du moteur, bases présentes et fraîches, empreinte/taille des octets et stabilité des métadonnées de bases avant/après analyse. **La commande `--version` elle-même passe par la sandbox**, pas seulement le scan.

- Code 0 avec sortie exacte `stdin: OK` : `SCAN_PASSED`, sans valeur de certification.
- Code 1 : `SCAN_REJECTED` selon détection/politique.
- Sandbox absente/interdite, version incorrecte, signature absente/périmée/invalide, hash incohérent, sortie inattendue, erreur ou timeout : `SCAN_UNAVAILABLE`.
- Formats invalides, actifs, MIME incohérent, erreur d'intégrité ou analyse isolée indisponible : pas de résultat favorable ; le traitement worker conserve le rejet/quarantaine prévu par son contrat.

Aucune branche ne rappelle automatiquement le scanner ou le parseur non isolés après un échec. Aucun résultat de scan ne constitue une revue humaine, une preuve d'authenticité ou une conclusion de légalité EUDR.

La comparaison des métadonnées de bases ne constitue pas à elle seule un protocole atomique de publication. Le futur updater devra publier des jeux immuables/cohérents, sans modification en place pendant un scan. Un updater périodique et son basculement atomique ne sont **pas livrés**.

## 5. Moteur et bases réellement utilisés

Le paquet Debian disponible sur cette machine proposait ClamAV 1.4.3. Il n'a pas été choisi ni rendu acceptable en affaiblissant la version exigée. Le paquet officiel **1.4.6 LTS** a été téléchargé et extrait dans un cache local, sans installation d'un démon ClamAV.

Sources consultées le 29/09/2026 :

- [Téléchargements officiels ClamAV](https://www.clamav.net/downloads) : paquet `clamav-1.4.6.linux.x86_64.deb` et signature associée.
- [Procédure officielle GnuPG](https://docs.clamav.net/faq/faq-upgrade.html).
- [Clé publique liée par la documentation officielle](https://raw.githubusercontent.com/Cisco-Talos/clamav-documentation/main/src/manual/cisco-talos.gpg).

Signature GnuPG vérifiée : **`VALIDSIG 5BADCA2665EF59DCF8A23D8B707F0DB480836771`**. La clé provient du lien HTTPS officiel ; GnuPG indique `TRUST_UNDEFINED` dans le trousseau neuf. C'est une vérification cryptographique avec cette clé, **pas une certification indépendante de l'identité du signataire par un réseau de confiance**. Le paquet, la signature et la clé sont empreintés dans les preuves.

FreshClam a téléchargé et testé les bases officielles hors de la sandbox, uniquement pour ce provisionnement local :

| Base | Version | Signatures annoncées |
|---|---:|---:|
| daily | 28138 | 355 695 |
| main | 63 | 3 287 027 |
| bytecode | 339 | 80 |

Le scanner isolé ne met rien à jour et ne dispose pas de ce réseau. `real-qualification.json` conserve les versions, dates de construction et SHA-256 des trois fichiers ainsi que l'empreinte du binaire analysé.

Les dates et versions ci-dessus sont une photographie de cette recette, pas des valeurs à copier pour tromper la fraîcheur. Télécharger de nouvelles bases lorsque nécessaire et répéter la qualification. Ne jamais modifier leur horodatage pour faire passer un test.

## 6. Reproduire sans données métier

Prérequis : Linux autorisant les namespaces utilisateur non privilégiés, bubblewrap non setuid (version observée **0.12.0**), `/usr/bin/prlimit`, Python système sous `/usr`, environnement Python issu du lock avec Pillow/pypdf. Une interdiction des namespaces doit conduire au refus, pas à une option `--not-a-security-boundary`.

### Provisionnement séparé du moteur

Emplacement de recette : `.cache/clamav-qualification/`, exclu de Git et des snapshots persistants. Les binaires, bibliothèques et bases volumineuses ne sont donc pas garantis disponibles lors d'une reprise de workspace ; **les preuves textuelles et le code persistent**.

1. Télécharger depuis les liens officiels ci-dessus le paquet 1.4.6, sa `.sig` et la clé Cisco Talos dans ce cache.
2. Créer un trousseau GPG privé 0700 dédié, importer la clé ; vérifier le paquet avec la signature. Archiver sortie `VALIDSIG`, origine de la clé, empreinte et SHA-256. Ne pas continuer en ignorant un échec.
3. Extraire avec `dpkg-deb -x` dans `.cache/clamav-qualification/engine`, sans lancer de service ou remplacer le scanner global.
4. Préparer un répertoire `.cache/clamav-qualification/database`. Exécuter le FreshClam du paquet validé avec un environnement minimal et une configuration séparée : `DatabaseMirror database.clamav.net`, `TestDatabases yes`, répertoire explicite et propriétaire local approprié. Dans cette recette le propriétaire était `user`.
5. Conserver les bases vérifiées et ne pas les modifier pendant les scans. N'y déposer aucune liste d'autorisation ou signature locale improvisée.

### Commandes de recette

```sh
PYTHONPATH=backend .venv/bin/pytest --confcutdir=backend/tests/sandbox_unit \
  backend/tests/sandbox_unit -q

# Opt-in requis ; les artefacts doivent avoir été explicitement provisionnés.
DOCUMENT_SANDBOX_TEST=1 PYTHONPATH=backend .venv/bin/pytest \
  --confcutdir=backend/tests/document_sandbox backend/tests/document_sandbox -q

.venv/bin/python scripts/qualify-document-sandbox.py --local-synthetic \
  --engine .cache/clamav-qualification/engine/usr/local/bin/clamscan \
  --database .cache/clamav-qualification/database \
  --library-path .cache/clamav-qualification/engine/usr/local/lib
```

Sans opt-in, les 13 tests système sont explicitement ignorés. Avec opt-in et artefacts manquants, ils échouent ; ils ne déclarent pas une qualification fictive. Le script n'effectue pas de téléchargement ni de vérification GPG automatique : le provisionnement validé reste un prérequis séparé. Son résultat maintient `production_authorized=false`.

## 7. Raccordement au service : dépendance encore bloquante

Le profil du lot 08n contient **`RestrictNamespaces=yes`**, incompatible avec la création de namespaces par bubblewrap. Il est volontairement **inchangé** ici. Le nouveau traitement ne doit donc pas être branché sur ce service en supposant qu'il fonctionnera.

Étape suivante : préparer un profil de composition révisé permettant uniquement les opérations nécessaires du lanceur, conserver NoNewPrivileges/capacités/cgroups et qualifier réellement le lancement depuis ce service. Ne pas désactiver indistinctement le durcissement pour contourner l'erreur. Vérifier aussi la visibilité des fichiers de code, dépendances, moteur et bases depuis les deux niveaux de montage.

Il faudra ensuite raccorder explicitement les deux adaptateurs au worker, sans fallback implicite, mesurer la charge, tester leases/reprises sous supervision, les mises à jour de signatures, les alertes et la sauvegarde. Le fournisseur, l'IAM et la migration candidate 0008 demeurent des conditions de GO distinctes.

Cette recette n'est ni une qualification de toute la chaîne API/DB/worker sous service, ni une preuve d'isolation inter-tenant SQL. Le test de fonction `execute_job` utilise **Moto pour S3**, mais un vrai ClamAV et de vrais parseurs isolés ; il ne publie pas de résultat en PostgreSQL.
