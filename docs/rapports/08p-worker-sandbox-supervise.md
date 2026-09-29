# 08p — Worker documentaire isolé sous supervision

29 septembre 2026 · chantier 8 · **recette locale, pas production**

## Objectif, dépendances et périmètre

Composer le worker à file PostgreSQL (08l), la supervision (08n) et la sandbox réelle (08o), puis éprouver les interruptions sans autoriser d'exécution non isolée. Dépendances locales : Linux/systemd et namespaces utilisateur, bubblewrap 0.12.0, PostgreSQL 17.11/PostGIS 3.5.2, ClamAV 1.4.6 signé et bases officielles, Python/venv verrouillé, Moto HTTP pour S3.

Le moteur et ses bases sont réels ; **le service de stockage reste une émulation**. Aucun compte cloud, service payant, document métier, migration Neon ou publication Vercel. L'API et l'interface sont inchangées : aucune nouvelle validation responsive n'est revendiquée.

## Changements livrés

- `backend/app/documents/worker.py` : `SandboxScanner` dans le démarrage normal et `sandbox_format` par défaut dans `execute_job`. Aucun fallback historique.
- `sandbox_processing.py` : documentation de l'état raccordé.
- Profil `infra/document-worker/geoforest-document-worker.service` et auditeur contractuel synchronisés.
- `backend/tests/supervised_sandbox/` : recette opt-in, unités transitoires, PostgreSQL dédié, S3 HTTP local et injections d'arrêt **réservées aux tests**.
- Guides sandbox/worker/supervision actualisés ; preuves et empreintes dans `preuves-chantier-8/supervised-sandbox/`.

La modification préexistante de `infra/bootstrap-db.sh` est exclue du lot.

## Résultats observés

| Suite | Résultat |
|---|---:|
| Composition supervisée PG + S3 HTTP + sandbox | 11 PASS |
| Contrats de supervision | 36 PASS |
| Contrats unitaires sandbox | 26 PASS |
| Sandbox réelle et antivirus réel | 13 PASS |
| Régressions documentaires unitaires | 96 PASS |
| **Total exécuté** | **182 PASS** |

Ruff ciblé, `git diff --check` et `pip check` passent. Ce total n'est pas une exécution exhaustive du dépôt ; la suite historique `document_worker` sur sa propre base n'a pas été relancée dans ce lot.

### Fonctionnement, erreurs et permissions

1. Sonde de frontière exécutée dans un vrai service systemd : séparation PID/réseau, secrets sentinelles non accessibles et contrôles du lanceur. Contrôles supplémentaires du parent : UID non root, capacités effectives nulles, NNP=1, ouverture en écriture de `/proc/sys/kernel/hostname` refusée, ouverture de `/proc/kmsg` refusée, `/tmp` nosuid/noexec.
2. L'ancien `RestrictNamespaces=yes` refuse effectivement la sandbox. Le test exige un résultat de la sonde, pas seulement un échec de lancement systemd.
3. Image PNG saine : enqueue avec rôle applicatif, claim avec rôle worker, finalisation S3, scan ClamAV et parseur isolés, commit SQL `SCAN_PASSED`, relecture vérifiée de la version exacte.
4. EICAR : `SCAN_REJECTED`, jamais favorable. PDF avec action `/Launch` non référencée : `FORMAT_REJECTED` par le parseur.
5. Namespace interdit : `SCAN_UNAVAILABLE`, trois tentatives bornées puis job `FAILED`, sans référence publiée ni fallback. Le code de sortie 0 peut signifier qu'un **refus** a été correctement persisté ; ce n'est pas un scan favorable.
6. Après finalisation de l'objet, SIGKILL injecté ou blocage ignorant SIGTERM : le service échoue, le job reste loué et la version SQL reste sans référence finale. Le superviseur borne le blocage ; après expiration du bail, une nouvelle exécution termine correctement.
7. Un commit avec ancien bail expiré est refusé (`false`). La reprise conserve exactement le même `VersionId` S3 et une seule version objet. Les tentatives passent de 1 à 2. **L'expiration est accélérée par SQL dans la base fictive** : le test ne patiente pas cinq minutes. Il ne simule pas une panne électrique ni une partition réseau réelle.
8. Identité SQL migrator utilisée comme worker : refus avant claim. Suppression de PublicAccessBlock du bucket émulé : refus avant claim. Aucune garde fournisseur n'est affaiblie.
9. Le worker ne peut lire directement les versions/utilisateurs ni modifier directement les jobs ; le rôle applicatif ne voit pas les versions d'une autre organisation.
10. Les résultats terminés vérifient l'audit `document.scan_finished`, acteur système/source worker, et **zéro revue humaine créée automatiquement**.

## Concessions systemd : décision et risque résiduel

**Le profil 08p n'est pas identique ni strictement plus restrictif que 08n.**

| Adaptation | Motif observé |
|---|---|
| `RestrictNamespaces=user mnt pid net ipc uts cgroup` | Autoriser les namespaces obligatoires de bubblewrap ; l'ancien refus global bloque le scan. |
| Ajout `AF_NETLINK` | Configuration loopback dans le namespace réseau privé. |
| `RestrictSUIDSGID=no` | Avec `yes`, bubblewrap 0.12 reçoit ENOSYS sur son chemin openat2 et ne peut ouvrir `/usr`. |
| `ProtectKernelTunables=no`, `ProtectKernelLogs=no`, `ProtectHostname=no` | Les surmontages de `/proc` empêchent le montage proc du namespace enfant (EPERM). |

`ProtectProc=invisible` est conservé, ainsi que NNP, capacités vides, UID non root, système en lecture seule, home protégé, périphériques privés, cgroups protégés et budgets mémoire/CPU/processus. La sandbox enfant conserve les protections 08o, notamment l'interdiction de créer des namespaces utilisateur imbriqués.

Ces barrières restantes sont testées en partie, **elles ne sont pas équivalentes aux options retirées**. Le parent est de confiance et peut maintenant créer des namespaces ; AF_NETLINK élargit ses familles de sockets. Il faut qualifier le noyau, systemd, bubblewrap et les droits de l'hôte cible avant toute exploitation. Si ces concessions sont inacceptables, revoir l'architecture de lancement, jamais revenir au scan non isolé.

Les essais exploratoires, y compris les échecs ayant conduit à ces choix, sont conservés dans `development-attempts/`. Les diagnostics bruts ont été retirés du lanceur de test final et n'ont jamais été ajoutés au worker de production.

## Rejouer localement

Prérequis à provisionner explicitement : DB **neuve et fictive** `geoforest_supervised_test` sur `127.0.0.1:5432`, rôles minimaux migrator/app/worker, PostGIS, migrations 0001–0007 et candidat 0008. Le candidat reste hors Alembic et **n'est pas autorisé pour Neon**. Ne pas détourner les fixtures historiques à TRUNCATE vers cette base.

Les identifiants de la fixture sont volontairement fictifs et les URLs figées ; aucun endpoint réel configurable. Les tests insèrent des organisations uniques, ne font ni DROP ni TRUNCATE et ne changent en nettoyage que leurs jobs fictifs inachevés. Les reprises accélèrent uniquement leurs propres baux/disponibilités.

```sh
.venv/bin/pip install -r backend/tests/supervised_sandbox/requirements.txt
# Dans un processus séparé, loopback uniquement :
.venv/bin/python backend/tests/supervised_sandbox/moto_server.py
# Après provisioning PG, bwrap et artefacts ClamAV vérifiés :
SUPERVISED_SANDBOX_TEST=1 PYTHONPATH=backend .venv/bin/pytest \
  --confcutdir=backend/tests/supervised_sandbox backend/tests/supervised_sandbox -q
```

ClamAV attendu dans `.cache/clamav-qualification/{engine/usr/local,database}`. Voir le guide sandbox pour sa provenance et sa qualification. Les dépendances Flask/Moto HTTP sont réservées à la recette ; aucun assouplissement du lock métier.

Les unités sont transitoires et collectées, aucun timer permanent activé. Le harnais substitue le compte local non root `user`, les chemins montés en lecture seule, des variables fictives et un délai d'arrêt de 2 s (profil candidat : 10 s). Pour le test de blocage, délai de démarrage 4 s au lieu de 270 s. Il retire ExecStartPre et ne constitue **pas** une installation du service de production ni une validation de son marqueur de qualification. DB et runtime locaux sont éphémères, pas des sauvegardes.

## Bilan et suite

- **PRÊT — local :** raccordement sans fallback et recette composée, scan/rejet/reprise/version immuable/audit/permissions.
- **À FINALISER :** qualification d'un hôte cible et de son identité dédiée, exploitation des bases antivirus, alertes, charge, pannes réseau et procédures opérateur.
- **BLOQUÉ pour production :** fournisseur S3 et garde PublicAccessBlock non qualifiés, absence de qualification hôte et de GO pour candidat 0008. Un fournisseur émulé ne prouve aucune garantie du fournisseur réel.
- **RISQUE RÉGLEMENTAIRE :** antivirus et format acceptés ne prouvent ni authenticité, ni légalité, ni conformité EUDR. Revue humaine séparée et obligatoire selon le workflow.
- **PROCHAINE VERSION proposée :** qualification opérationnelle reproductible du worker (installation, démarrage/refus, alertes et mises à jour antivirus), puis recette sur infrastructure expressément autorisée. Aucun achat, déploiement ou nouvelle migration cloud sans accord.
