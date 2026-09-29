# Chantier 08o — Scanner et parseur isolés du worker

29 septembre 2026 · demande utilisateur : « prochaine étape ».

## Résultat

**Sandbox Linux et adaptateurs candidats livrés, avec ClamAV réel et parseurs réellement exécutés en isolation locale. Aucun raccordement de production.**

- Le traitement n'hérite pas de l'environnement sensible ni du fichier/descripteur sentinelle du parent.
- Namespaces PID/réseau distincts, capacités nulles, NoNewPrivileges et nouveaux namespaces utilisateur interdits dans l'enfant.
- Code/runtime en lecture seule et espace temporaire privé borné.
- ClamAV **1.4.6**, paquet officiel à signature GnuPG vérifiée, bases officielles téléchargées/testées par FreshClam.
- Fichier propre : **SCAN_PASSED** ; EICAR : **SCAN_REJECTED** ; erreur/signatures invalides/timeout : **SCAN_UNAVAILABLE**.
- PNG, JPEG et PDF simple traités ; PDF JavaScript et données invalides refusés.

**26 tests unitaires nouveaux + 13 tests d'intégration locale nouveaux + 96 régressions = 135 tests réussis.** Les 13 tests nécessitent un opt-in explicite ; sans lui ils sont ignorés, pas comptés comme réussis.

## Objectifs, dépendances et risques

Objectif : séparer le traitement de fichiers non fiables des fichiers, secrets, réseau et processus visibles depuis le worker, sans considérer un simple sous-processus comme une sandbox.

Dépendances : noyau Linux avec namespaces utilisateur, bubblewrap non privilégié, runtime et paquets Python de confiance, moteur et bibliothèques validés, bases fraîches et montage des artefacts maîtrisé. Les dépendances cloud/IAM/Neon 0008/Vercel restent inchangées et non autorisées par cette recette.

Risques traités : héritage de secrets/descripteurs, accès aux fichiers du parent, sortie réseau, enfant détaché survivant au timeout, scan favorable malgré erreur, retour automatique au scanner non isolé.

Risques restant à traiter : surface noyau/syscalls, compromission d'artefacts de confiance, budgets cgroup agrégés, composition des deux niveaux d'isolation, publication atomique des signatures, supervision métier et exploitation sous charge. Aucun domaine n'est requis pour cette étape.

## Fichiers livrés

| Chemin | Contenu |
|---|---|
| [`../deploiement/sandbox-documentaire.md`](../deploiement/sandbox-documentaire.md) | Architecture, limites, provenance, reproduction et conditions de raccordement |
| `backend/app/documents/sandbox.py` | Lanceur bubblewrap/prlimit, montages sélectionnés, limites et destruction des processus |
| `backend/app/documents/sandbox_processing.py` | Adaptateurs candidats `SandboxScanner` et `sandbox_format` |
| `sandbox_format_entry.py`, `sandbox_probe.py` | Entrée de parseur et sondes fictives |
| `scripts/qualify-document-sandbox.py` | Qualification synthétique réelle avec rapport JSON, empreintes et autorisation production toujours fausse |
| `backend/tests/sandbox_unit/`, `backend/tests/document_sandbox/` | Tests hors sandbox et tests Linux/ClamAV réels opt-in |
| [`preuves-chantier-8/document-sandbox/`](preuves-chantier-8/document-sandbox/) | GPG, SHA-256, FreshClam, résultats bruts, qualification réelle et nettoyage |

Aucun changement dans `worker.py`, le scanner/parseur historiques, les routes, la file SQL, les migrations ou l'interface. Le test raccorde explicitement les nouveaux adaptateurs à la fonction `execute_job` ; les commandes de production ne les sélectionnent pas automatiquement.

## Preuves réelles

### Provenance du moteur

La version Debian disponible était 1.4.3 : elle n'a pas été acceptée en contournant le contrôle de version. Le paquet officiel 1.4.6 a été extrait dans un cache local, sans installation de démon antivirus.

GnuPG a vérifié la signature avec la clé publiée via la documentation Cisco Talos :

`VALIDSIG 5BADCA2665EF59DCF8A23D8B707F0DB480836771`

La sortie affiche `TRUST_UNDEFINED` pour le trousseau neuf : signature cryptographiquement valide avec la clé obtenue par le canal HTTPS officiel, pas validation indépendante de l'identité par un réseau de confiance. Le paquet, sa signature, la clé et le binaire effectivement analysé sont empreintés dans les preuves.

Sources : [téléchargements officiels](https://www.clamav.net/downloads), [procédure de vérification GnuPG](https://docs.clamav.net/faq/faq-upgrade.html).

FreshClam, exécuté séparément pour ce provisionnement, a téléchargé et testé les bases : **daily 28138, main 63, bytecode 339**. Le scanner isolé ne dispose pas du réseau de mise à jour. Empreintes et dates de construction sont dans `real-qualification.json`.

### Isolation et fonctionnement

Les 13 tests Linux réels vérifient :

1. UID interne 65534, capacités effectives nulles et NoNewPrivileges ; ce UID est mappé à l'appelant hôte, pas un nouveau compte cloud/système métier.
2. Absence de la variable secrète sentinelle dans l'environnement, du fichier parent et du descripteur pourtant marqué héritable.
3. Répertoires hôtes non montés, runtime non modifiable, fichier temporaire 0600 et tmpfs de 128 Mio exactement.
4. Namespaces PID et réseau distincts ; environnement du parent absent du `/proc` privé ; tentative de nouveau namespace utilisateur refusée.
5. Serveur loopback préalablement accessible depuis le parent, inaccessible depuis l'enfant.
6. Après timeout, absence de processus conservant le namespace PID du programme, y compris son enfant détaché ignorant SIGTERM.
7. Vrais PNG, JPEG et PDF simple analysés dans le parseur isolé ; mauvais MIME et hash refusés ; PDF avec JavaScript et fichier malformé rejetés.
8. Vrai ClamAV : propre accepté, EICAR rejeté, timeout fermé, fausses bases bien formées mais invalides refusées, bases périmées refusées.
9. Assemblage via `execute_job`, scan et validation de format avec **S3 émulé par Moto**, ClamAV et parseur réels ; référence versionnée conservée et erreur de hash rejetée.

**La dernière vérification n'est pas un test fournisseur ni une transaction SQL finale du worker.** Aucune qualification d'isolation multi-tenant SQL nouvelle n'est revendiquée.

## Tests et outillage

| Contrôle | Résultat | Portée |
|---|---:|---|
| Tests unitaires nouveaux | **26 passed, 0,06 s** | Contrats, protocole, erreurs, sorties bornées, aucun fallback non isolé |
| Tests réels nouveaux | **13 passed, 34,19 s** | Namespaces Linux, ClamAV 1.4.6, vraies bases, parseurs, S3 émulé |
| Régressions documentaires | **96 passed, 4,00 s** | Suite existante ; pas une nouvelle qualification cloud |
| Garde sans opt-in | **13 skipped** | Pas de succès artificiel lorsque la recette réelle n'est pas demandée |
| CLI de qualification réelle | **4 cas conformes** | Propre, EICAR, timeout, PNG ; cas recoupant les tests, non additionnés au total |
| Ruff / format / pip check | OK | Nouveaux fichiers et environnement local |
| Nettoyage | Aucun `bwrap`, `clamscan` ou `freshclam` actif observé | Namespace du descendant également contrôlé dans le test de timeout |
| `git diff --check` | OK | Contrôle de patch |

Bubblewrap observé : **0.12.0**. Pas de suite backend complète, PostgreSQL, E2E navigateur, charge maximale, OOM/fork bomb ou exploitation sous unité systemd réexécutés. Aucune modification UI : recette responsive non applicable.

La première exécution des tests d'intégration a révélé une erreur de fixture : le répertoire racine fictif du `LocalStore` n'était pas créé. Correction en création explicite 0700, sans changer les gardes du stockage ; la recette finale passe entièrement. Le lanceur exige aussi `--unshare-user` explicitement pour appliquer le blocage de namespaces imbriqués, plutôt que d'accepter une isolation optionnelle.

## Blocage identifié avant raccordement

Le profil de supervision 08n contient **`RestrictNamespaces=yes`**. Il interdirait les namespaces nécessaires à bubblewrap. Il n'a pas été modifié ou affaibli en silence : **la composition service + sandbox reste à qualifier**.

Le prochain lot doit préparer un profil révisé conservant les protections pertinentes, tester le lancement imbriqué réel, raccorder les deux adaptateurs sans fallback et éprouver file/leases/reprises/alertes. Les limites rlimit de la sandbox ne remplacent pas le budget cgroup agrégé du service.

Les téléchargements et bases volumineuses sont dans `.cache/clamav-qualification`, exclus des snapshots : ils devront éventuellement être reprovisionnés. Les rapports, empreintes et le code persistent. Ne pas confondre cette copie de travail avec un système durable de mise à jour des signatures.

## Bilan obligatoire

| Statut | Conclusion |
|---|---|
| **PRÊT** | Adaptateurs isolés candidats, vérification locale ClamAV réelle et parseurs, 135 tests réussis et preuves de provenance |
| **À FINALISER** | Composition avec systemd, raccordement explicite worker, artefacts immuables, updater atomique, dimensionnement et alertes |
| **BLOQUÉ** | Activation sous le profil 08n inchangé ; qualification fournisseur/IAM et autorisations de migration/cloud toujours requises |
| **RISQUE RÉGLEMENTAIRE** | Scan favorable ≠ authenticité, revue humaine, légalité ou certification EUDR/RGPD |
| **PROCHAINE VERSION** | Service supervisé + sandbox + worker intégrés et testés localement, sans lever les gardes cloud |

Aucun document réel scanné, aucun service payant ni compte fournisseur créé, aucune modification Neon/Vercel, aucun changement de domaine. Livraison par commit local ; `infra/bootstrap-db.sh`, déjà modifié avant ce lot, est exclu.
