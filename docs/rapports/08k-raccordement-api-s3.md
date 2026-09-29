# Chantier 3 — raccordement API S3 et suivi des traitements

29 septembre 2026. Suite du commit `ed45e9c`. **Livraison locale de l'intégration ; chantier toujours ouvert.**

## Objectif et dépendances

Relier le coffre au socle S3 et à la file durable, sans exécuter les scans dans une requête API ni sacrifier l'isolation, les quotas, la quarantaine, l'intégrité ou la revue humaine. Dépendances : schéma 0007 + candidat, client S3, worker distinct. Le fournisseur et la qualification cloud restent hors de cette livraison.

## Modifications

- Configuration stockage partagée, client S3 réutilisé, sélection du stockage par version lors des lectures. Activation API limitée à `APP_ENV=test` + `DOCUMENT_S3_API_TEST=true` sur base loopback `_test`. Production/développement et Vercel restent bloqués.
- Routes de réservation/upload/finalisation branchées au stockage S3 et à la file dans ce profil. Bloc de 64 000 octets compatible avec le navigateur, reprise idempotente après réponse perdue, position SQL non avancée sur échec. Vérification du candidat avant usage.
- `/finish` retourne la mise en file ; aucun scanner ni verrou de session de scan dans cette branche. Les trois tentatives ne peuvent pas être remises à zéro par le client.
- Téléchargement versionné, hash vérifié avant restitution, réautorisation après ouverture et fermeture du flux si droits/session perdus. Les références internes restent masquées.
- Compatibilité local/0007 préservée : aucune migration implicite des anciens fichiers. Lecture d'une ancienne version locale possible si sa racine existe encore ; reprise d'un upload local sur instance S3 refusée, nouvelle version autorisée.
- DTO `processing_mode`, suivi UI séquentiel et annulable, arrêt sur résultat terminal/perte d'accès, onglet masqué sans requête, backoff borné, message après épuisement des tentatives. Pas de revue humaine automatique.

## Résultats de recette

Preuves : `docs/rapports/preuves-chantier-8/s3-api/`.

| Vérification | Résultat réel |
|---|---|
| Suite backend sur schéma 0007, avant dernier garde DB | **966 réussis, 67 ignorés**, 13 avertissements ; 471,41 s |
| Tests worker/file sur base candidate dédiée | **49 réussis** |
| Tests API S3 → file → worker → téléchargement | **18 réussis**, 1 avertissement |
| Relance finale unitaires documentaires | **96 réussis** |
| Relance finale API locale + runtime DB | **28 réussis**, 1 avertissement |
| Unitaires frontend | **95 réussis** |
| Navigateur Chromium, UI réelle / API simulée | **2 réussis**, 1440 et 390 px |
| TypeScript, ESLint, Ruff, pip check, git diff --check | Réussis |

Les 67 tests ignorés de la suite générale sont précisément les 49 worker et 18 API S3, exécutés séparément avec leurs opt-in. Ils ne sont pas présentés comme réussis dans la suite générale. Les relances se recouvrent : **ne pas additionner toutes les lignes**. Les deux nouveaux tests refusant une base distante/métier ont été ajoutés après la suite complète ; ils sont compris dans les 96 unitaires de la relance finale. La suite complète n'a pas été relancée après ce dernier garde ciblé.

Avertissements observés : dépréciation Starlette/httpx et avertissements rasterio sur multiplication affine. Aucun échec restant dans les lancements finaux.

Les tests API supplémentaires couvrent : upload, revue prématurée refusée, audit, idempotence, absence de scan synchrone, limites et conflits des blocs, réponse de stockage perdue, dépôt incomplet, réservation annulée si bucket invalide, antivirus indisponible/rejet, essais épuisés, suppression d'une version S3 référencée, lecture épinglée malgré un nouvel objet courant, isolation inter-organisations et inter-fournisseurs, rôle Viewer, quota, révocation staff/portail au milieu du téléchargement et coexistence des versions locales/S3.

La recette navigateur vérifie l'absence de bouton de téléchargement en quarantaine, l'arrivée du statut favorable par polling puis l'arrêt du polling, aucun débordement horizontal, aucune erreur JS et affichage responsive. Captures `interface-1440.png` et `interface-390.png` : **données et API fictives, pas un écran de production**.

## Limites et état exact

- PostgreSQL/PostGIS réel mais uniquement local. Cluster inspecté avant initialisation : seule `postgres` existait, aucun rôle GeoForest. Bases neuves fictives `geoforest_test` (0007) et `geoforest_queue_test` (0007 + candidat) créées. Aucun accès Neon.
- Moto S3 en mémoire, antivirus synthétique pour les succès, validation réelle du format en sous-processus. Les tests appellent le worker avec son rôle DB restreint dans le processus de recette ; pas de daemon S3/ClamAV de production déployé.
- Le candidat SQL est inchangé et toujours hors d'Alembic `versions`. Head officiel toujours 0007. Aucune migration cloud sous-entendue.
- Aucun nouveau build/deploy Vercel, aucun vrai compte Clerk/OIDC utilisé par les tests navigateur, aucun fournisseur choisi, coût engagé, transfert réel ou opération DNS.
- Les appels S3 sous transaction et les vérifications de bucket répétées doivent être mesurés sous charge. Quota logique ≠ coût physique (chunks, versions et rétention). Aucune purge ajoutée.
- Le profil de test explicite n'est pas une qualification cloud ; ne pas supprimer ses gardes pour publier.

## Bilan

- **PRÊT localement :** parcours API S3/file/worker, suivi UI, permissions, reprise et compatibilité locale testés.
- **À FINALISER :** sauvegarde/restauration, migration Alembic définitive, fournisseur UE, ClamAV réel, supervision, tests de charge et qualification Vercel.
- **BLOQUÉ pour production :** activation interdite par configuration, services et garanties réels non qualifiés.
- **RISQUE RÉGLEMENTAIRE :** intégrité et antivirus ne prouvent ni authenticité, ni légalité, ni conformité EUDR ; revue humaine requise.
- **PROCHAINE ÉTAPE recommandée :** sauvegarde indépendante et exercice de restauration sur données fictives (DB + objets + correspondance des versions), avant activation d'un fournisseur réel.

Guide courant : `docs/deploiement/s3-api-locale.md`. Les rapports 08i/08j restent des constats historiques des étapes précédentes.
