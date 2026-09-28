# Notifications persistantes — audit, plan et validation

**Date : 27 septembre 2026**

**Statut : implémenté et validé en tests; migration non appliquée.**
**Périmètre approuvé :** projet complémentaire `agent-work/chantiers-c1-c5/`, notifications in-app, état lu/non lu par utilisateur, événements métier déjà émis. Aucun email/push ni worker planifié dans ce chantier.

Aucune modification de l’application historique à la racine, aucune écriture dans une base, aucun commit ni push. Les changements Risques/DDR déjà présents dans l’arbre de travail ont été conservés.

## 1. Audit initial

Le projet complémentaire avait déjà une table `alerts` migrée et des alertes créées lors de l’inscription, des premières créations fournisseur/produit/lot/parcelle et de l’invitation fournisseur. Les lignes étaient persistées en base, mais l’écran `/alerts` était un placeholder.

Constats importants :

- l’aperçu du dashboard ne retournait que huit alertes; il n’existait pas d’API dédiée de liste, pagination, filtres, compteur de non-lues, lecture individuelle ou lecture en lot;
- `user_id` pouvait cibler un membre, mais les lectures, compteurs et changements d’état étaient uniquement tenant-scopés; `is_read` était stocké sur l’alerte et donc partagé;
- l’alerte de bienvenue était créée à la première lecture du dashboard, comme effet de bord d’un `GET`;
- la création des alertes était dispersée dans plusieurs endpoints/services, sans clé d’idempotence commune;
- Redis/Celery figuraient dans les dépendances, mais aucun worker ni planificateur périodique n’était configuré.

## 2. Plan approuvé

- Réutiliser le modèle `Alert`, sans créer un second système.
- Garder les notifications in-app et les événements métier existants; ne pas ajouter d’email, push ou rappels planifiés.
- Persister l’état lu/non lu par utilisateur, y compris pour les alertes visibles par toute l’organisation.
- Ajouter une API tenant/destinataire-scopée, un centre de notifications et un badge de non-lues.
- Créer les alertes dans la transaction métier et rendre les émissions idempotentes.
- Préparer une migration additive; ne l’appliquer à aucune base dans ce chantier.

## 3. Rapport d’implémentation

### FAIT

- Ajout de `alert_recipient_states`, qui conserve l’état individuel par couple alerte/utilisateur. Pour les alertes historiques, `Alert.is_read` reste le repli; les nouveaux états individuels le surchargent sans perte de compatibilité.
- Ajout d’une `dedupe_key` unique par tenant et d’un service commun de création. Les alertes de bienvenue, premier fournisseur/produit/lot/parcelle, parcelle invalide et invitation fournisseur utilisent des clés idempotentes.
- Déplacement de l’alerte de bienvenue vers la transaction d’inscription; le GET du dashboard n’écrit plus d’alerte.
- Ajout des routes `GET /alerts` (pagination, filtres état/niveau/catégorie), `GET /alerts/unread-count`, `POST /alerts/{id}/read`, `POST /alerts/{id}/unread` et `POST /alerts/read-all`. L’ancienne route de lecture du dashboard est conservée pour compatibilité.
- Les listes et compteurs respectent le destinataire. Les alertes personnelles des autres membres et des autres tenants répondent comme introuvables; les utilisateurs fournisseurs sont refusés par le scope opérateur existant.
- Les liens externes sont refusés lors de la création et expurgés lors de la sérialisation; seuls des chemins internes peuvent être suivis depuis l’interface.
- Remplacement du placeholder `/alerts` par un centre avec filtres, pagination, actions lire/non lire et lecture en lot. Ajout du badge non lu dans la navigation; il est rafraîchi après action, changement de page et retour au focus.

### NON FAIT / LIMITES DE PÉRIMÈTRE

- Pas de rappels planifiés d’expiration documentaire ou de DDR : aucun worker/planificateur n’a été ajouté.
- Pas d’email, notification navigateur/push, temps réel inter-session, préférences de notification, archivage ni suppression automatique.
- Aucun test d’intégration sur une base PostgreSQL/Neon réelle et aucune migration appliquée; seule la compilation hors ligne de la chaîne Alembic et les bases SQLite de tests ont été utilisées.
- Les états de lecture sont conservés dans `alert_recipient_states`, mais ne produisent pas d’événement distinct dans le journal d’audit; ils ne sont pas traités comme une action métier critique.

### TESTS / VALIDATION

- Backend : **118 tests passés**; `compileall` réussi.
- Migration : compilation PostgreSQL offline d’upgrade et downgrade réussie dans `test_migration_revision.py`; révision `20260927_0004` additive, après `20260927_0003`.
- Tests ajoutés : isolation entre destinataires d’un même tenant et entre tenants, états indépendants sur une alerte partagée, lecture/non-lecture individuelle, lecture en lot, route historique compatible, refus fournisseur, déduplication, filtrage/pagination bornée et repli d’état pour une alerte historique.
- Frontend : `npm test` **3 tests passés**; typecheck réussi; build réussi; lint avec **0 erreur et 14 avertissements**.
- `git diff --check` réussi après l’actualisation du rapport.

### PROBLÈMES / AVERTISSEMENTS

- Les avertissements ESLint existants restent dans des fichiers hors du centre d’alertes. Next.js signale aussi plusieurs lockfiles et choisit celui de la racine comme racine de workspace; le build a néanmoins réussi.
- Pytest signale des dépréciations/configurations de dépendances (`datetime.utcnow()` dans la dépendance JWT, Argon2 et portée de fixture `pytest-asyncio`); les tests passent.

### RISQUES

- L’état historique `Alert.is_read` reste un repli global pour les anciennes lignes sans état destinataire. Dès qu’un membre modifie l’état, son état individuel prévaut; les autres membres gardent le repli historique.
- Le badge est rafraîchi sur les événements UI, changement de page et focus; il n’est pas une livraison temps réel et ne remplace pas une notification push.
- Le catalogue d’événements n’a pas été étendu aux échéances documentaires/DDR. Ce choix respecte le périmètre validé; un futur chantier avec worker devra ajouter ses propres clés d’idempotence et tests de reprise.

### PROCHAINE ÉTAPE

1. Faire relire le parcours et le comportement de visibilité par le métier.
2. Si le déploiement est autorisé, tester la migration `20260927_0004` sur une base isolée ou une branche Neon enfant avant toute production.
3. Traiter les rappels d’échéance et l’email/push comme des décisions de périmètre distinctes.

---

**Décision de gouvernance :** implémentation autorisée par « Valide le plan recommandé ». Aucun commit, push, déploiement ou accès à une base de production n’a été réalisé.
