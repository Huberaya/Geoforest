# Chantier 8 — premier incrément : sécurité et cible UE

29 septembre 2026 · branche `chantier-8/security-release`.

**GO8 reçu. EN COURS — ni chantier clôturé ni production autorisée.** L’utilisateur a choisi une **recommandation d’hébergement UE**, sans infrastructure existante à déployer et sans autorisation de souscription.

## Objectifs et dépendances

Finaliser le SaaS au travers de tests transversaux, sécurité, UX, packaging, procédures d’exploitation et bilan de lancement. Base : version 0.8.0 et migration 0007 du chantier 7 ; conserver les réserves des modules forestiers/documentaires et la séparation interne/officiel.

Ordre de travail : (1) auditer les écarts et recommander une cible, (2) durcir les erreurs de configuration détectables localement, (3) qualifier packaging/sandbox/SSO/sauvegardes sur cible, (4) rejouer les parcours transversaux et mesurer la charge, (5) conclure par un bilan de lancement fondé sur preuves.

## Réalisé dans ce bloc

### Recommandation UE

[Comparatif et recommandation détaillés](../deploiement/recommandation-hebergement-ue.md) : **Scaleway Paris comme première cible de qualification**, OVHcloud comme alternative, Hetzner si administration système/DB renforcée acceptée. Sources officielles consultées, limites des documents et postes de coût distingués. Estimations d’architecture explicitement non contractuelles.

Aucun achat, aucune ressource créée, aucun accès au compte d’un fournisseur. Le coffre auto-hébergé reste le choix de référence. L’API officielle EUDR n’a pas été sollicitée ; aucun avis de conformité réglementaire ajouté.

### Durcissement production

- Validation Settings : HTTPS parsé plutôt que simple préfixe ; origine sans chemin/slash terminal/identifiants/query/fragment ; backchannel HTTPS ; hôtes explicites et cohérents ; MFA attendu non blanc ; secrets OIDC/session distincts et sans placeholders ; DB runtime et TLS `verify-full` avec CA explicite.
- Représentation textuelle des erreurs Settings sans valeurs d’entrée, afin de ne pas exposer un DSN ou secret dans un refus de configuration.
- Contrôle DB de readiness : privilèges élevés et propriété de tables refusés ; RLS activée et tables/politiques attendues contrôlées sur **32 tables**. `supplier_sessions` conserve volontairement l’absence de politique directe, donc le refus par défaut, avec ses helpers existants.
- Démarrage **production refusé** si isolation, schéma 0007 ou PostGIS ne passent pas les contrôles. Message fixe sans détails de connexion.
- Génération du `.env` par création exclusive en mode 0600, sans fenêtre de fichier lisible créée avant chmod, ni écrasement de fichier/lien symbolique préexistant. Flags sensibles explicitement à false.

Ces contrôles sont des garde-fous de déploiement, pas un audit exhaustif de politiques SQL, un test réel de TLS fournisseur, une qualification de MFA ou une sandbox.

### Cohérence déploiement et UX

- Le Compose de développement transmet maintenant `DILIGENCE_ENABLED`. Il garde **explicitement** les documents désactivés : l’image de base n’a ni moteur antivirus qualifié ni coffre provisionné.
- `.env.example` renvoie aux exigences de production au lieu d’annoncer l’interface/PDF encore à venir.
- L’écran public ne se présente plus comme « chantier 1 » et ne prétend plus que toutes les analyses sont absentes. Il indique collecte, observations indicatives et dossiers internes selon activation, sans dépôt officiel ni certification automatique.
- [Procédure de préparation production](../deploiement/production.md) : configuration, contrôles, étapes bloquantes, sauvegarde/reprise et responsabilités à qualifier.

Fichiers : `backend/app/{config,main,readiness}.py`, `backend/tests/test_release_security.py`, `scripts/init-env.py`, Compose, exemple d’environnement, page publique et documents de déploiement. Pas de migration supplémentaire, de changement des règles réglementaires ni d’activation automatique des modules.

## Tests exécutés

| Vérification | Résultat |
|---|---|
| Régression backend entière | **863 passed**, 13 avertissements, **451,25 s**, sortie 0 |
| Nouveaux tests sécurité/configuration | **40 passed**, 5,16 s, inclus dans les 863 |
| TypeScript / ESLint / build standalone | Réussis |
| Ruff backend et générateur d’environnement | Réussi |
| Audits Python et npm | Aucune vulnérabilité connue signalée lors de cette exécution |
| Chromium, page publique standalone | **1 passed**, 2,9 s ; viewports 1440, 768, 390 et 360 px sans débordement horizontal |

Nouveaux tests : origine ambiguë ou invalide, identifiants vides dans URL, secrets courts/identiques/placeholders, TLS DB non vérifié et paramètres de connexion ambigus, absence de secrets dans les messages d’erreur, runtime réel accepté/propriétaire migrateur refusé, RLS désactivée sur quatre tables puis restaurée, démarrage production fermé avec mauvais rôle, création atomique du fichier privé et refus d’un lien symbolique pendant génération.

La page 360px a été capturée et examinée. Le serveur frontend testé est l’artefact standalone ; la recette API locale n’a pas de vrai IdP dans ce bloc. **Pas de nouvelle recette OIDC, antivirus réel, restauration, test de charge, sandbox, Docker ou CI GitHub revendiqués.** Les preuves du chantier 7 restent historiques et ne sont pas présentées comme exécutions de ce chantier.

Les serveurs temporaires ont été arrêtés. Seules des données de test ont été utilisées. Les 13 avertissements proviennent des dépendances déjà identifiées.

## Constats d’audit et corrections

La readiness initiale ne vérifiait que schéma/PostGIS. Elle pouvait être verte sous un compte propriétaire : corrigé et testé. Le premier nouveau contrôle rejetait aussi `supplier_sessions` faute de politique ; inspection a confirmé que le refus par défaut est intentionnel. Le contrôle a été corrigé sans élargir les permissions ni ajouter une politique permissive.

Le Compose omettait le flag diligence et le générateur d’environnement écrivait avant de restreindre les permissions : corrections ciblées. Aucun rôle runtime n’a reçu de privilège supplémentaire.

## Bilan provisoire de lancement

| Statut | Constat |
|---|---|
| **PRÊT — localement testé** | Garde-fous config/DB, générateur privé, régression backend et page publique responsive |
| **À FINALISER — chantier 8** | Packaging conteneurs, sandbox/egress, SSO/TLS cible, recette transversale complète, accessibilité/charge, alertes et exploitation |
| **BLOQUÉ — ouverture publique** | Aucune infrastructure UE contractualisée/qualifiée ; pas de restauration/RPO/RTO ni d’antivirus/sandbox validés sur cible |
| **RISQUE RÉGLEMENTAIRE** | Résidence UE non synonyme de conformité RGPD/EUDR ; décisions internes et observations indicatives ne sont pas déclarations officielles |
| **PROCHAINE VERSION** | Reports des chantiers antérieurs maintenus : connecteur officiel et références externes structurées, autres régimes, OCR/SMTP produit et montée en charge durable |

L’avancement du chantier 8 ne transforme pas les fonctionnalités différées en fonctionnalités livrées. Les critères bloquants d’exploitation doivent être levés par des preuves, pas par une case « prêt ».

## Suite

Préciser budget, volumes, criticité et responsabilités d’exploitation ; confirmer la cible recommandée. Préparer et tester les images et l’isolation des traitements, puis un POC PostgreSQL/PostGIS/RLS/restauration sur l’offre retenue, uniquement après autorisation de créer les ressources. Les tâches locales restantes peuvent continuer sans nouvel accord de chantier ; aucun déploiement payant ne peut être déduit de GO8.

Preuves : `preuves-chantier-8/{backend,release-security,lint,types,build,ruff,audit-python,audit-npm,e2e-public}.txt` et `connexion-mobile.png`.

Livraison locale, non poussée. Aucun token GitHub antérieur réutilisé. Le changement de mode préexistant de `infra/bootstrap-db.sh` est préservé et exclu du commit.
