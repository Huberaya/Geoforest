# Qualification Neon Production — migrations et BBOX

**Contrôle en lecture seule : 13/11/2026.** Ce document remplace les anciennes procédures qui demandaient encore d'appliquer les migrations 0007–0009. Aucune migration, écriture de données, modification du registre Drizzle, restauration ou changement de rôle n'a été exécuté pendant ce contrôle initial.

## 1. Décision immédiate

- **Aucune migration Drizzle courante à appliquer n'a été identifiée** : le journal de `main` contient 14 entrées (0000–0013) et les 14 timestamps correspondants sont présents dans `drizzle.__drizzle_migrations` sur Production.
- Le registre Neon contient 16 lignes, soit deux timestamps supplémentaires hors du journal courant. Leur provenance exacte n'est pas démontrée par le seul rapprochement des timestamps. **Les conserver** : ne pas les supprimer et ne pas modifier le registre manuellement.
- `public.alembic_version` contient `0007`. Alembic est distinct de Drizzle ; ce point reste à rapprocher du code backend et de ses révisions Alembic.
- Les quatre colonnes BBOX existent et sont nullable. Les 23 lignes `gf_plots` ont toutes leurs quatre bornes renseignées ; aucune n'est incomplète.
- Les 23 cadres BBOX observés concordent avec les enveloppes PostGIS recalculées à partir des géométries JSONB. Aucune divergence n'a été détectée.
- Les 23 parcelles sont en suppression logique ; aucune parcelle active n'a été observée.

**Conclusion : ne pas lancer `db:migrate`, `db:push`, `db:rollback` ni le backfill sur Production pour le seul motif du nombre de lignes du registre. Le backfill n'a actuellement aucune ligne incomplète à traiter.**

## 2. Preuves Neon consultées

Projet `sparkling-brook-79507514`, branche Production observée lors du contrôle initial `br-delicate-brook-b1h226a9`.

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
- `neondb_owner` : rôle administratif avec `BYPASSRLS` — ne pas utiliser dans l'application.

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

## 7. État de la preuve au contrôle initial

Les contrôles SQL ci-dessus sont des lectures directes de Neon Production au 13/11/2026 avant le test de restauration. Ils ne prouvaient pas alors qu'un snapshot avait été restauré, qu'une sauvegarde automatique était planifiée, ni que les deux entrées Drizzle supplémentaires avaient été expliquées.

## 8. Test de restauration du snapshot Production — 13/11/2026

Snapshot source : `snap-lively-mud-b1n6qm8i` (`geoforest-p0-security-baseline-20261113`), créé le 13/11/2026 à 09:40:24 UTC sur l'ancienne branche Production.

**Restauration exécutée et finalisée avec succès**. Neon a effectué un échange de branche (finalize) : la branche restaurée est devenue la branche par défaut `production`, et l'ancienne branche Production a été conservée comme branche de sauvegarde.

| Rôle actuel | ID Neon | Nom |
|---|---|---|
| Production active / default | `br-young-base-b1n4tbxi` | `production` |
| Ancienne Production conservée | `br-delicate-brook-b1h226a9` | `p0-restore-verify-20261113 (1)` |

La restauration a été vérifiée par connexion SQL sur les deux branches. Les résultats suivants sont identiques :

| Contrôle comparatif | Production restaurée | Ancienne Production sauvegardée |
|---|---:|---:|
| `gf_users` | 5 | 5 |
| `gf_suppliers` | 0 | 0 |
| `gf_plots` | 23 | 23 |
| Parcelles actives | 0 | 0 |
| Parcelles avec BBOX incomplet | 0 | 0 |
| Lignes du registre Drizzle | 16 | 16 |
| Tables publiques | 55 | 55 |
| Colonnes publiques | 635 | 635 |
| Révision Alembic | `0007` | `0007` |

Le rôle `geoforest_app` sur la branche Production restaurée conserve les attributs attendus : `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS`. Aucun SQL de migration ou de modification de données n'a été exécuté pendant cette opération.

**Limite de preuve :** l'égalité des comptes et des structures critiques est vérifiée, mais ce contrôle ne constitue pas une comparaison cryptographique exhaustive de chaque ligne de toutes les tables. L'ancienne branche est conservée ; ne pas la supprimer avant une validation fonctionnelle de l'application et une décision explicite de rétention.

## 9. Sauvegardes automatiques et protection native Neon

- Le schedule de snapshots est vide (`schedule: []`) sur la branche Production active.
- Le projet est sur le plan Neon `free_v3`. La documentation Neon indique que les schedules automatiques de snapshots sont réservés aux plans payants (avec exception Agent sur demande). **La planification automatique native est donc bloquée par le plan actuel.**
- La branche Production active est `protected: false`. La tentative antérieure d'activation de la protection native Neon a été refusée par la limite de branches protégées du plan Free. Les restrictions Vercel sur certaines opérations ne remplacent pas une protection native complète.
- Le ruleset GitHub et les contrôles CI sont indépendants de ces limites Neon ; ils ne protègent pas à eux seuls la base de données.

**Décision P0 :** la restauration du snapshot est prouvée et l'ancienne branche est conservée. En revanche, les sauvegardes automatiques natives et la protection native de branche restent des réserves explicites liées au plan Neon Free. Ne pas présenter ces deux contrôles comme « verts ».

## 10. Interdictions complémentaires après restauration

- Ne pas supprimer `br-delicate-brook-b1h226a9` : elle contient l'ancienne Production et constitue le point de retour conservé.
- Ne pas lancer une seconde restauration, un reset, une migration ou un backfill Production sans nouvelle vérification et autorisation spécifique.
- Vérifier les connexions Vercel et les parcours applicatifs Production après le changement d'identité de branche.
- Ne pas activer une planification arbitraire : le plan Free ne la prend pas en charge ; toute solution de sauvegarde externe nécessite une destination sécurisée, des secrets dédiés et un test de restauration indépendant.
