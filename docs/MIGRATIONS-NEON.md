# Qualification Neon Production — migrations et backfill BBOX

**État vérifié le 12/11/2026.** Ce document remplace l'ancienne procédure qui demandait encore d'appliquer les migrations 0007, 0008 et 0009. Les vérifications récentes ont été faites en lecture seule sur Neon Production ; aucune migration, modification du registre, ni écriture de données n'a été exécutée.

## 1. État des migrations

Le journal Drizzle de `main` contient 14 entrées (0000 à 0013). Les 14 timestamps du journal courant sont présents dans `drizzle.__drizzle_migrations` sur Production, qui contient 16 lignes.

Les deux lignes supplémentaires sont des traces de l'ancien historique de migration, avant réorganisation/renumérotation. Elles ne correspondent pas à deux migrations courantes à appliquer. **Ne pas les supprimer et ne pas modifier le registre manuellement.**

Conséquences :
- aucune migration Drizzle courante 0000–0013 ne manque ;
- ne pas lancer `npm run db:migrate` pour « rattraper » un compteur ;
- ne pas lancer `npm run db:push` ;
- ne pas lancer `db:rollback` sur Production ;
- conserver les deux entrées historiques jusqu'à une procédure de réconciliation dédiée, documentée et approuvée.

Le suivi Alembic (`alembic_version`, révision observée `0007`) est un mécanisme distinct de Drizzle. Il doit être rapproché du code backend/Alembic et ne doit pas être interprété comme une migration Drizzle manquante.

## 2. Rôles et accès

Les rôles contrôlés incluent `geoforest_app`, `geoforest_migrator` et `neondb_owner`.

- `geoforest_app` ne doit pas être superutilisateur et ne doit pas avoir `BYPASSRLS`.
- `neondb_owner` est le rôle administratif observé avec `BYPASSRLS`.
- Les droits sur les tables héritées vides et les objets PostGIS doivent rester justifiés par le code réellement utilisé. Ne pas les révoquer sur la seule base de leur nom.
- La visibilité nulle des parcelles pour `geoforest_app` sans contexte d'organisation est attendue ; elle ne doit pas être utilisée pour exécuter un backfill administratif.

Le backfill exige désormais explicitement `DATABASE_URL_ADMIN` et vérifie que le rôle connecté est `SUPERUSER` ou `BYPASSRLS`. Il ne retombe jamais sur `DATABASE_URL`.

## 3. Données métier observées

Photographie de la base lors de la qualification :

| Objet | Nombre | Observation |
|---|---:|---|
| Organisations | 2 | Une organisation principale et un tenant de test |
| Utilisateurs | 5 | Tous suspendus au moment du contrôle |
| Fournisseurs | 0 | Aucun enregistrement |
| Produits | 0 | Aucun enregistrement |
| Expéditions | 0 | Aucun enregistrement |
| Documents | 0 | Aucun enregistrement |
| Parcelles | 23 | Toutes en suppression logique |
| `parcel_audits` | 7 | Toutes sans `plot_id` |

Les 7 analyses historiques ne doivent pas être rattachées à une parcelle sans preuve métier. Le lien reste nullable et l'absence de rattachement doit être conservée.

## 4. État géométrique et BBOX

Les 23 géométries présentes ont été contrôlées :
- 23 géométries GeoJSON valides selon PostGIS ;
- 23 cadres englobants recalculés indépendamment et concordants avec PostGIS ;
- les quatre colonnes `bbox_min_lon`, `bbox_min_lat`, `bbox_max_lon`, `bbox_max_lat` sont incomplètes sur les 23 lignes ;
- les 23 parcelles sont en suppression logique : aucune parcelle active n'a été constatée.

Les géométries sont exploitables pour calculer les bornes, mais le backfill porte actuellement sur des lignes archivées. L'écriture en Production nécessite une validation explicite de son périmètre et de son intérêt métier.

## 5. Garde-fous du script

Fichier : `scripts/backfill-bbox.ts`

Le script corrigé :
1. exige `DATABASE_URL_ADMIN` ; aucun fallback vers `DATABASE_URL` ;
2. vérifie le rôle courant et exige `SUPERUSER` ou `BYPASSRLS` avant de lire les parcelles ;
3. sélectionne toute ligne dont au moins une des quatre bornes est NULL (pas seulement `bbox_min_lon`) ;
4. utilise `RETURNING id` et comptabilise les lignes réellement modifiées ;
5. vérifie les compteurs et le nombre de lignes dont les bornes restent incomplètes ;
6. conserve `--essai` sans écriture et `--recalculer` pour le recalcul complet.

Tests de garde : `scripts/ci/check-backfill-bbox.test.cjs`, inclus dans `npm run test:ci`.

## 6. Procédure — ordre obligatoire

### A. Avant toute exécution

- vérifier la branche et le SHA du correctif ;
- obtenir une CI verte sur la branche ;
- vérifier que `DATABASE_URL_ADMIN` pointe vers l'environnement explicitement ciblé ;
- vérifier que le rôle courant est administratif ;
- faire un essai `--essai` et conserver sa sortie ;
- confirmer le périmètre des 23 parcelles archivées et l'absence de parcelles actives.

### B. Écriture Production

**Aucune écriture Production n'est autorisée par ce runbook sans approbation explicite préalable du rapport d'essai et de son impact.**

Après approbation seulement :

```bash
DATABASE_URL_ADMIN='…' npm run db:backfill-bbox
```

Puis vérifier dans la même base :
- les 23 lignes ciblées ont quatre bornes non NULL ;
- chaque borne correspond au minimum/maximum recalculé depuis la géométrie ;
- aucune ligne inattendue n'a été modifiée ;
- le nombre de lignes encore incomplètes est nul sur le périmètre approuvé.

Ne jamais lancer `--recalculer` en Production sans justification distincte : cela réécrit aussi les cadres déjà complets.

## 7. Interdictions permanentes

- Ne jamais lancer `db:push` sur Production.
- Ne jamais modifier manuellement `drizzle.__drizzle_migrations`.
- Ne jamais lancer de migration ou de rollback Production pour corriger un simple écart de nombre d'entrées.
- Ne jamais utiliser le rôle applicatif pour un backfill administratif.
- Ne jamais relier les analyses historiques à des parcelles par supposition.
- Ne jamais considérer une sortie `--essai` comme une preuve d'écriture réussie.
