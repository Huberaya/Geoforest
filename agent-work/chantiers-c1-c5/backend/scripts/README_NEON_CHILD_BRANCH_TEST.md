# Test de la baseline sur une branche enfant Neon

## Statut

Ce kit est préparé pour faciliter la suite. Le cycle upgrade/vérification/downgrade/re-upgrade a passé un test local sur PGlite/PostgreSQL embarqué 18.3, mais **aucun DDL n'a été exécuté sur Neon**. La session agent n'a actuellement ni intégration Neon ni `DATABASE_URL` injectée par un coffre de secrets. La branche `production` n'a pas été modifiée.

## Voie préférée : accès sécurisé de l'agent

Une fois l'intégration Neon activée pour l'agent, utiliser le DSN uniquement via le gestionnaire de secrets et exécuter dans `backend/` :

```bash
alembic upgrade head
```

La révision `20260925_0001` est la source canonique. Ne pas mettre le DSN dans le dépôt, la ligne de commande partagée ou le chat.

## Voie de secours : exécution manuelle par l'opérateur

1. Dans l'interface Neon, créer une **branche enfant jetable** depuis la branche confirmée vide. Avant toute écriture, vérifier visuellement que le sélecteur Neon affiche bien la branche enfant et non `production`. Le SQL PostgreSQL générique ne prouve pas l'identité de branche côté control plane; ne pas inventer une fonction de vérification.
2. Exécuter l'inventaire de schéma read-only déjà utilisé et confirmer que la branche enfant est vide. Si elle ne l'est pas, arrêter; ne pas appliquer cette baseline.
3. Si l'agent n'a toujours pas d'accès sécurisé, ouvrir `neon_child_branch_initial_upgrade.sql` et l'exécuter **en entier, comme une seule transaction**, sur cette branche enfant seulement. Le fichier est le SQL offline exact généré par Alembic; il crée les objets et inscrit la révision dans `alembic_version`. Ne pas retirer `BEGIN`/`COMMIT` pour contourner une erreur de l'éditeur; arrêter et utiliser la voie sécurisée si l'éditeur ne prend pas le script complet.
4. Exécuter `verify_neon_child_branch_initial_schema.sql` (lecture seule), puis comparer les résultats attendus ci-dessous. Garder le nom/ID de branche affiché dans l'interface Neon avec le rapport.
5. Ne pas exécuter le downgrade sur `production`. La branche enfant étant jetable, la supprimer dans Neon après le test plutôt que d'y conserver un environnement ambigu.

## Résultats attendus après l'upgrade

- `alembic_versions` : `20260925_0001`.
- `application_table_count` : 9; `missing_application_tables` et `unexpected_base_tables` : tableaux vides.
- `named_application_indexes_ix` : 31; `physical_indexes_on_application_tables` : 43 (31 index explicites, 9 index PK et 3 index des contraintes uniques).
- `foreign_key_count` : 16; `missing_enum_types` : tableau vide; 10 enums attendus.
- `jsonb_columns` : 8 colonnes, dont `plots.geometry`.
- `postgis_extension_installed` : `false` attendu pour cette baseline.

Ces vérifications confirment la présence des objets, pas l'isolation inter-tenant, la sûreté réglementaire ou une validation de production. Aucun résultat ne doit être qualifié de test Neon tant que la migration n'a pas été exécutée sur la branche enfant.
