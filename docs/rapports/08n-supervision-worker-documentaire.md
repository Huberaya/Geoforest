# Chantier 08n — Supervision et périmètre système du worker

29 septembre 2026 · demande utilisateur : « prochain chantier ».

## Bilan

**Profil de supervision livré et éprouvé localement sur programmes synthétiques. Pas de worker métier ni d'antivirus réel activé.**

- Service systemd oneshot et timer candidats, avec durée et ressources bornées.
- Restrictions de privilèges, système de fichiers et réseau préparées.
- **36 tests nouveaux + 96 tests de régression réussis.**
- **4 épreuves système locales réussies**, dont arrêt d'un enfant détaché ignorant SIGTERM et test réseau avec témoin positif.
- Aucun compte cloud, achat, migration Neon, déploiement Vercel ou activation du coffre.

**Limite essentielle :** c'est un périmètre de protection autour du worker, pas encore un bac à sable antivirus distinct de son parent. L'isolation des secrets et permissions entre worker, scanner et parseur reste à finaliser avant production.

## Objectifs, dépendances et risques

Objectifs : préparer les relances espacées, borner les ressources, arrêter tous les descendants et fournir une recette reproductible plutôt qu'un simple fichier de configuration non vérifié.

Dépendances inchangées : fournisseur compatible avec les protections exactes du coffre, IAM, rôle SQL worker, candidat 0008 et son autorisation séparée, hôte UE, moteur antivirus/signatures, sauvegarde indépendante et alertes. Le domaine reste différé ; il n'est pas nécessaire à cette recette locale.

Risques suivis : enfant survivant au worker, montage temporaire non borné malgré une configuration apparemment correcte, filtrage réseau présumé mais non observé, secrets du parent accessibles au scanner, saturation des ressources et service déclaré sain malgré un scan indisponible.

## Livrables

| Chemin | Rôle |
|---|---|
| [`../deploiement/supervision-worker-documentaire.md`](../deploiement/supervision-worker-documentaire.md) | Guide de fonctionnement, restrictions, essais, exploitation et conditions de GO |
| `infra/document-worker/geoforest-document-worker.service` | Service candidat, durée 270 s puis arrêt forcé après 10 s, cgroup complet |
| `infra/document-worker/geoforest-document-worker.timer` | Cadence après inactivité, sans redémarrage immédiat en boucle |
| `infra/document-worker/worker.env.example` | Modèle sans secret, distinct de la configuration API |
| `scripts/audit-document-worker-profile.py` | Audit hors ligne strict des fichiers candidats |
| `scripts/qualify-worker-systemd.py` | Recette système opt-in, exclusivement synthétique et locale |
| `backend/tests/worker_supervision/test_profile.py` | Tests de configuration, refus et nettoyage |
| [`preuves-chantier-8/worker-supervision/`](preuves-chantier-8/worker-supervision/) | Sorties brutes, résultats JSON, essais intermédiaires échoués, nettoyage et empreintes |

Le guide du worker existant est complété par un lien vers ce lot. Aucun changement dans le code métier du worker, le scanner, le SQL, les routes, la quarantaine, les gardes stockage ou le frontend.

## Ce qui a été réellement vérifié

### 1. Audit et tests locaux

**36 passed, 0,11 s.** Vérification du profil conforme sans autorisation de production, puis refus de : root, capacités de protection affaiblies, durée infinie, arrêt limité au seul parent, redémarrage non prévu, ressources illimitées, egress ouvert, mauvais tmp privé, modification de commande, dépendance système supplémentaire, absence du marqueur, directives supplémentaires/dupliquées, héritage de configuration, mauvaises cadences et secrets dans le modèle public.

Les fichiers absents, liens symboliques, contenus trop grands et UTF-8 invalide sont refusés. Les erreurs ne reproduisent pas les valeurs sensibles. La CLI d'audit est testée sans sous-processus. La recette système exige son opt-in ; un client systemd en timeout déclenche quand même une demande de nettoyage de son unité synthétique. Les montages transitoires sont transmis dans deux arguments distincts.

### 2. Quatre épreuves réelles sous systemd

Environnement observé : systemd 257, cgroup v2 local. Les unités transitoires exécutent du Python système sur des données fictives, sous `nobody:nogroup`, sans DB, S3, secrets applicatifs ou bases antivirus.

1. **Périmètre système :** UID non-root, capacités effectives nulles, NoNewPrivileges, descripteurs/core bornés, `/home` inaccessible, écriture système refusée, fichier temporaire 0600 ; tmpfs de **256 Mio et 32 Mio exactement**, options `noexec` observées ; valeurs CPU/mémoire/swap/tâches du cgroup vérifiées.
2. **Arrêt de l'arbre :** parent et enfant ignorent SIGTERM, l'enfant crée une nouvelle session ; timeout accéléré 2 + 1 secondes, terminaison SIGKILL et enfant absent de `/proc` après sortie du service.
3. **Témoin réseau positif :** une unité synthétique sans les deux filtres IP réussit une connexion TCP vers un serveur sur cette même machine, hors loopback.
4. **Réseau restreint :** avec les filtres du candidat, la connexion vers ce même pair local n'aboutit pas. Le témoin accessible évite de confondre une cible indisponible avec un filtrage effectif.

Le JSON final conserve `production_authorized=false` et `antivirus_qualified=false`. Les substitutions de chemins, UID/GID, programmes, configuration et durée de test sont explicitement enregistrées. **Ces essais ne sont pas le démarrage de l'unité applicative finale ni la qualification réseau complète IPv4/IPv6 d'un fournisseur.**

Les limites cgroup ont été lues ; aucun stress test de saturation mémoire/CPU/tâches n'est revendiqué. Le timer métier n'a pas été activé ; la cadence n'est pas mesurée sous charge.

### 3. Régressions et outillage

| Contrôle | Résultat |
|---|---|
| Unités documentaires existantes | **96 passed, 4,49 s** |
| Syntaxe native des deux unités | `systemd-analyze verify` : code 0 |
| Audit candidat hors ligne | Conforme ; production et antivirus toujours non qualifiés |
| Ruff / format | OK sur les trois fichiers Python du lot |
| pip check | OK |
| Nettoyage système | **0 unité `geoforest-synthetic-*` chargée** après les essais |
| `git diff --check` | OK |

Pas de suite backend complète, intégration PostgreSQL, recette UI/responsive, charge réelle ou EICAR réexécuté. Le S3 et les résultats antivirus des régressions restent synthétiques selon leurs fixtures historiques.

## Défauts rencontrés et corrections

Les premiers essais ont échoué sur les espaces temporaires. Une borne supérieure seule pouvait accepter un tmp privé différent de celui attendu ; `DynamicUser` modifiait la configuration de tmp de la recette. Les montages transitoires nécessitaient aussi un encodage distinct de la ligne de l'unité native. Une expérimentation avec `NoExecPaths` sur les mêmes chemins masquait les tmpfs.

La recette finale emploie une identité synthétique fixe non privilégiée, des assertions de tailles **exactes**, deux arguments de montage, `PrivateTmp=no` et les flags `noexec` directement sur les tmpfs. Aucun `NoExecPaths` concurrent n'est conservé. Les résultats finaux passent ; les fichiers `*-before-*.json` conservent plusieurs échecs intermédiaires pour la traçabilité, pas comme preuves de réussite.

Le premier test réseau exigeait EPERM/EACCES. Un filtre pouvant entraîner une absence de réponse, cette hypothèse était trop étroite ; il a été remplacé par un couple témoin accessible / connexion filtrée sur le même pair local. Aucun test cloud n'a été substitué à ce contrôle.

## Limites d'exploitation

- Le candidat ne permet que le réseau loopback. Une politique distante approuvée et testée est indispensable ; retirer les protections n'est pas une procédure de déploiement.
- Le marqueur `document-worker.qualified` est une condition opérateur, pas une certification. Il n'a pas été créé.
- Aucun compte système métier, fichier de secrets, moteur ClamAV, updater de signatures ou unité permanente n'a été installé.
- Le code processus 0 du worker ne signifie pas toujours scan favorable : il peut suivre l'enregistrement de `SCAN_UNAVAILABLE` ou un résultat non accepté. Les métriques de file et alertes effectives restent à développer.
- Le scanner et le parseur ne sont pas encore isolés de l'identité et des accès du parent. **Ne pas déclarer l'antivirus « sécurisé en production » sur cette seule base.**
- La restriction d'un processus n'assure ni l'authenticité des documents ni leur légalité EUDR. Les contrôles humains et métier restent requis.

## Statut final

| Statut | Conclusion |
|---|---|
| **PRÊT** | Profil candidat, audit, recette système reproductible, 132 tests locaux et 4 épreuves système réussis |
| **À FINALISER** | Sandbox distincte du scanner/parseur, ClamAV réel et signatures, dimensionnement, métriques/alertes et intégration complète |
| **BLOQUÉ** | Activation métier tant que fournisseur, IAM, migration candidate, hôte et exploitation ne sont pas qualifiés/autorisés |
| **RISQUE RÉGLEMENTAIRE** | Antivirus et protections OS ne constituent pas une certification EUDR/RGPD |
| **PROCHAINE VERSION** | Séparer effectivement le traitement de fichiers non fiables des secrets et accès du worker, puis qualifier le moteur réel et ses mises à jour dans cet environnement |

Livraison par commit local sur la branche de travail ; aucun push ni déploiement dans ce lot. La modification préexistante de `infra/bootstrap-db.sh` reste exclue.
