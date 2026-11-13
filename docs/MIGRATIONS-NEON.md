# Qualification Neon Production — migrations et BBOX

**Contrôle en lecture seule : 13/11/2026.** Ce document remplace les anciennes procédures qui demandaient encore d'appliquer les migrations 0007–0009. Aucune migration, écriture de données, modification du registre Drizzle, restauration ou changement de rôle n'a été exécuté pendant ce contrôle.

## 1. Décision immédiate

- **Aucune migration Drizzle courante à appliquer n'a été identifiée** : le journal de `main` contient 14 entrées (0000–0013) et les 14 timestamps correspondants sont présents dans `drizzle.__drizzle_migrations` sur Production.
- Le registre Neon contient 16 lignes, soit deux timestamps supplémentaires hors du journal courant. Leur provenance exacte n'est pas démontrée par le seul rapprochement des timestamps. **Les conserver** : ne pas les supprimer et ne pas modifier le registre manuellement.
- `public.alembic_version` contient `0007`. Alembic est distinct de Drizzle ; ce point reste à rapprocher du code backend et de ses révisions Alembic.
- Les quatre colonnes BBOX existent et sont nullable. Les 23 lignes `gf_plots` ont toutes leurs quatre bornes renseignées ; aucune n'est incomplète.
- Les 23 cadres BBOX observés concordent avec les enveloppes PostGIS recalculées à partir des géométries JSONB. Aucune divergence n'a été détectée.
- Les 23 parcelles sont en suppression logique ; aucune parcelle active n'a été observée.

**Conclusion : ne pas lancer `db:migrate`, `db:push`, `db:rollback` ni le backfill sur Production pour le seul motif du nombre de lignes du registre. Le backfill n'a actuellement aucune ligne incomplète à traiter.**

## 2. Preuves Neon consultées

Projet `sparkling-brook-79507514`, branche Production `br-delicate-brook-b1h226a9`.

| Contrôle | Résultat observé |
|---|---:|
| Entrées du journal Drizzle courant | 14 |
| Timestamps courants retrouvés dans le registre Neon | 14/14 |
| Lignes totales du registre Neon | 16 |
| Timestamps supplémentaires hors journal courant | 2 |
| Révision Alembic | `0007` |
| Parcelles `gf_plots` | 23 |
| Parcelles actives | 0 |
| Parcelles en suppression logique | 23 |
| Parcelles avec au moins une borne BBOX NULL | 0 |
| BBOX divergents de l'enveloppe PostGIS | 0 |

Les deux entrées supplémentaires du registre sont **non réconciliées** à ce stade. Leur présence n'autorise ni suppression ni réécriture. Une réconciliation complète devra comparer chaque hash et timestamp aux fichiers de migration et à l'historique Git, puis expliquer explicitement les deux entrées historiques.

## 3. Rôles

Le contrôle des attributs PostgreSQL a confirmé :

- `geoforest_app` : `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS` — attendu pour le rôle applicatif ;
- `neondb_owner` : `NOBYPASSRLS` faux (rôle avec `BYPASSRLS`) et privilèges administratifs — ne pas utiliser dans l'application.

Le backfill doit exiger explicitement `DATABASE_URL_ADMIN` et vérifier le rôle connecté avant toute lecture métier ou écriture. Il ne doit jamais retomber sur `DATABASE_URL`.

## 4. Garde-fous du backfill

Le correctif de `scripts/backfill-bbox.ts` :

1. refuse l'absence de `DATABASE_URL_ADMIN` ;
2. refuse un rôle sans `SUPERUSER` ni `BYPASSRLS` ;
3. sélectionne les lignes dont **au moins une** des quatre bornes est NULL ;
4. utilise `UPDATE ... RETURNING id` pour compter les écritures réelles ;
5. vérifie les compteurs et les bornes encore incomplètes après exécution ;
6. conserve `--essai` comme parcours sans écriture ;
7. conserve `--recalculer` comme opération distincte, à ne pas utiliser en Production sans justification spécifique.

Le test de garde `scripts/ci/check-backfill-bbox.test.cjs` est inclus dans `npm run test:ci`. Ces assertions statiques complètent les tests PostgreSQL de CI ; elles ne remplacent pas une exécution contrôlée du script sur une base jetable.

## 5. Procédure avant toute future écriture

1. Vérifier le SHA de la branche et obtenir une CI verte.
2. Vérifier hors ambiguïté que `DATABASE_URL_ADMIN` vise le projet et la branche attendus.
3. Exécuter `--essai` et archiver la sortie.
4. Si le résultat est zéro ligne, **arrêter** : aucune écriture n'est justifiée.
5. Si des lignes sont identifiées, vérifier leur périmètre métier, leur état (actif/archivé), la géométrie source et le résultat attendu.
6. Obtenir une approbation explicite du rapport d'essai avant toute écriture Production.
7. Après écriture autorisée, vérifier les lignes effectivement modifiées, les quatre bornes et leur concordance avec la géométrie.

## 6. Interdictions

- Ne jamais utiliser `db:push` sur Production.
- Ne jamais modifier manuellement `drizzle.__drizzle_migrations`.
- Ne jamais lancer migration ou rollback pour corriger un simple écart de nombre d'entrées.
- Ne jamais exécuter le backfill sur Production sans essai et approbation explicite.
- Ne jamais rattacher les analyses historiques à des parcelles sans preuve métier.
- Ne jamais présenter une sortie `--essai` comme une preuve d'écriture réussie.

## 7. État de la preuve

Les contrôles SQL ci-dessus sont des lectures directes de Neon Production au 13/11/2026. Ils ne prouvent pas qu'un snapshot a été restauré, qu'une sauvegarde automatique est planifiée, ni que les deux entrées Drizzle supplémentaires ont été expliquées. Ces sujets restent distincts et ouverts.
