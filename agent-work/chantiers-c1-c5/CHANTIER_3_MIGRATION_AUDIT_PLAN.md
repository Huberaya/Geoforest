# Chantier 3 — Audit et plan de migration de base de données

**Date : 25 septembre 2026**  
**Étape : analyse terminée; plan soumis à validation. Aucune migration n'a été créée.**

## 1. Audit de l'existant

### Chemin actuel de création du schéma
- `backend/alembic/` contient `env.py` et `script.py.mako`, mais aucun dossier `versions/` ni aucune révision. `alembic history --verbose` et `alembic heads` ne retournent aucune révision.
- `backend/app/main.py` appelle `init_db()` au démarrage de chaque instance.
- `init_db()` fait `CREATE EXTENSION IF NOT EXISTS postgis`, puis `Base.metadata.create_all()`. Les exceptions sont interceptées et loguées comme avertissement; l'API continue son démarrage.
- Docker Compose démarre directement Uvicorn; il n'exécute aucune commande Alembic avant de démarrer l'API.
- Le dépôt ne contient ni dump/schema cible, ni fichier de base, ni configuration de connexion vers une base persistante de préproduction/production. Le volume `geoforest-pgdata` de Compose est local au développement et son contenu n'est pas fourni.
- `CHANTIER_1.md` reporte la baseline jusqu'à stabilisation du schéma; `CHANTIER_4.md` confirme également l'absence de révisions. L'historique SQL réel d'une éventuelle base déployée n'est donc pas établi.

### Changement du portail à migrer
Le portail ajoute **une table** `supplier_invitations`; il n'ajoute pas de colonne métier aux tables existantes dans cette reprise. Le DDL PostgreSQL a été compilé depuis les modèles SQLAlchemy :

- Colonnes : `id`, `organization_id`, `supplier_id`, `created_by_user_id`, `target_email`, `purpose`, `jti_hash`, `created_at`, `expires_at`, `sent_at`, `consumed_at`, `revoked_at`.
- FK : organisation (`ON DELETE CASCADE`), fournisseur (`ON DELETE CASCADE`), créateur (`ON DELETE SET NULL`).
- Index : organisation, fournisseur, créateur, email cible, expiration et index unique sur `jti_hash`.
- Les UUID sont stockés par le type portable actuel `VARCHAR(36)` (et non par le type PostgreSQL natif `UUID`). Les timestamps sont `TIMESTAMP WITH TIME ZONE`.
- Le modèle historique `suppliers.invite_token` reste présent; le nouveau code n'émet plus ce jeton, mais d'anciennes valeurs éventuelles n'ont pas été purgées.

### Risque principal
`create_all()` peut créer les tables manquantes, mais ne fait pas évoluer les colonnes/contraintes de tables existantes. De plus, si la création de `supplier_invitations` échoue, `init_db()` ne fait pas échouer le démarrage. Une application peut donc démarrer alors que ses routes portail sont inutilisables. À l'inverse, lancer un « baseline » initial sans connaître le schéma cible peut échouer sur des tables existantes ou enregistrer une version Alembic incorrecte.

## 2. Plan proposé — sans supposer l'état de la base

### Décision préalable requise
Choisir si le chantier vise :
1. une base neuve/réinitialisable uniquement;
2. une base persistante déjà initialisée par l'application, dont les données doivent être gardées;
3. les deux cas.

Cette réponse détermine si l'on peut générer une baseline fraîche, ou si l'on doit d'abord comparer/stamper un schéma existant. Aucune migration ne doit être lancée sur une base inconnue.

### Proposition technique après confirmation
1. Geler un schéma de référence correspondant aux modèles livrés jusqu'au chantier 4, **avant** `supplier_invitations`.
2. Créer des révisions versionnées :
   - **baseline** des tables existantes pour installer une base vide;
   - migration additive pour `supplier_invitations` (table, FKs, index unique et index secondaires).
3. Si une base persistante existe déjà sans historique Alembic : sauvegarde + export du schéma; comparer tables, colonnes, types, enums, index, clés et contraintes à la baseline. N'exécuter `alembic stamp` qu'après preuve d'équivalence; ensuite appliquer uniquement la migration additive. Si le schéma diffère, écrire une migration d'adaptation spécifique plutôt que le tamponner arbitrairement.
4. Ajouter un nettoyage contrôlé des anciennes valeurs `suppliers.invite_token` dans une migration séparée, après sauvegarde. Cette action invalide les anciens jetons en clair, n'est pas réversible sans restaurer la sauvegarde, et doit donc être annoncée dans le plan de déploiement.
5. Séparer les responsabilités : Alembic applique le schéma lors du déploiement; `init_db()` ne doit plus tenter de créer/modifier le schéma en production et doit échouer explicitement si le schéma attendu est absent. Garder éventuellement l'auto-création seulement en développement/test.
6. Définir l'installation de PostGIS séparément (privilèges DBA/infrastructure) ou dans la révision initiale adaptée; ne pas compter sur un `CREATE EXTENSION` silencieux à chaque démarrage.
7. Tester sur PostgreSQL/PostGIS réel ou CI équivalente : base vide → upgrade complet; base pré-portail → baseline/stamp contrôlé + upgrade; conservation des données; index/FK présents; relance idempotente; rollback de la migration additive; démarrage refusé si le schéma requis manque.

## 3. Critères d'acceptation
- Une installation neuve peut créer son schéma uniquement via des révisions Alembic versionnées.
- Une base persistante n'est ni vidée ni tamponnée sans comparaison préalable et sauvegarde vérifiée.
- La migration `supplier_invitations` crée les six index attendus et ses trois FK.
- Les anciennes invitations en clair sont invalidées/purgées selon une décision explicitement approuvée.
- Le démarrage de l'application n'absorbe plus silencieusement un échec de schéma en environnement de production.
- La suite portail reste verte après upgrade réel; les données métier préexistantes sont conservées.

## 4. Statut

**FAIT :** audit de l'initialisation, du dépôt Alembic, des modèles et des dépendances de la table portail; compilation du DDL PostgreSQL; constat de l'absence de DB cible/schema dump; préparation d'un script SQL d'inventaire en lecture seule dans `backend/scripts/inspect_postgres_schema.sql` et de ses consignes dans `backend/scripts/README_SCHEMA_INVENTORY.md`.

**NON FAIT :** aucune baseline, révision, opération `stamp`, purge de jetons, changement du démarrage DB ou test PostgreSQL n'a été effectué. Le script d'inventaire n'a pas été exécuté faute de `psql`/serveur ou DSN cible dans l'environnement. Cette retenue évite de fabriquer un historique de schéma ou de risquer les données d'une base inconnue.

**Prochaine étape :** exécuter le script sur la base cible et partager le résultat **du schéma uniquement** (pas de données ni de secrets de connexion), ou confirmer qu'il n'existe qu'une base neuve/réinitialisable. Après cela, valider la stratégie de baseline et écrire/tester les migrations correspondantes.
