# Test de la chaîne de migrations sur une branche enfant Neon

## Statut de sécurité

Le kit `neon_child_branch_initial_upgrade.sql` reste le script historique C1 pour la seule révision `20260925_0001`. Le schéma courant du checkout C7 est `20260926_0002`.

Les nouveaux scripts `neon_child_branch_c7_upgrade.sql` (chaîne complète `base -> 20260926_0002`) et `neon_child_branch_c7_incremental_upgrade.sql` (uniquement `20260925_0001 -> 20260926_0002`) sont générés hors ligne par Alembic et ne se connectent à aucune base. `verify_neon_child_branch_c7_schema.sql` ne lit que les catalogues PostgreSQL.

**Aucun de ces scripts n'a été exécuté sur Neon. Aucune écriture n'a été faite sur `production`.** Une branche enfant doit être jetable; le nom/ID affiché par l'interface Neon est la preuve du périmètre, pas une requête SQL.

## Voie préférée — accès sécurisé de l'agent

Une fois l'intégration Neon configurée via le gestionnaire de secrets, créer/confirmer une branche enfant jetable, injecter le DSN uniquement dans l'environnement du processus, puis exécuter depuis `backend/` :

```bash
alembic upgrade head
```

Ne jamais placer le DSN dans le dépôt, les arguments affichés, un journal partagé ou le chat. Confirmer visuellement dans Neon que le sélecteur pointe vers la branche enfant, jamais `production`.

## Voie manuelle de secours — sans transmettre de secret à l'agent

1. Dans l'interface Neon, créer une branche enfant jetable depuis la branche que l'opérateur a confirmée vide. Vérifier visuellement le nom/ID sélectionné avant toute écriture.
2. Sur la branche enfant seulement, exécuter l'inventaire read-only `inspect_postgres_schema.sql`. Si la branche contient déjà des tables métier inattendues, arrêter.
3. Choisir le script selon la révision réellement vérifiée :
   - Branche enfant vide : exécuter **en entier et comme une seule transaction** `neon_child_branch_c7_upgrade.sql`.
   - Branche enfant vérifiée à `20260925_0001` : exécuter en entier `neon_child_branch_c7_incremental_upgrade.sql`.
   - Tout autre état : arrêter et faire auditer l'état Alembic avant d'appliquer un DDL.
4. Exécuter `verify_neon_child_branch_c7_schema.sql` et sauvegarder le résultat avec le nom/ID de branche visible dans l'interface.
5. Si un test downgrade/re-upgrade est requis, le faire uniquement sur la branche enfant jetable. La supprimer après le test; ne pas la convertir en environnement partagé.

Ne pas retirer `BEGIN`/`COMMIT` pour contourner un échec de l'éditeur SQL. En cas d'échec, arrêter et utiliser une voie d'exécution qui gère le script transactionnel complet.

## Résultats attendus après upgrade C7

- `alembic_versions` : `20260926_0002`.
- `application_table_count` : **13**; `missing_application_tables` et `unexpected_base_tables` : tableaux vides.
- `named_application_indexes_ix` : **46**; `physical_indexes_on_application_tables` : **65** (46 index nommés `ix_`, 13 index de PK et 6 index de contraintes uniques).
- `foreign_key_count` : **26**; 10 types enum attendus, aucun enum manquant/inattendu.
- `jsonb_column_count` : **8**; mêmes colonnes JSONB que la baseline précédente.
- `postgis_extension_installed` : `false` attendu.

Le C7 ajoute `documents`, `document_versions`, `document_links` et `document_checklist_items`, sans nouveaux types enum ni nouvelles colonnes JSONB.

Ces vérifications confirment uniquement la présence des objets SQL. Elles ne remplacent pas les tests d'isolation tenant/RBAC et ne constituent ni un test de production, ni un avis juridique. Aucun résultat ne doit être qualifié de « test Neon » tant que l'exécution n'a pas eu lieu sur une branche enfant identifiée dans l'interface Neon.
