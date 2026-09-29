# Chantier 3 — socle S3, point intermédiaire

Date : 29 septembre 2026. **Chantier non terminé. Aucun déploiement.**

## Décision et périmètre

Architecture acceptée : stockage objet privé compatible S3, fournisseur et région UE à valider, avec traitements antivirus séparés. Aucun fournisseur souscrit, aucune donnée réelle transférée, aucun accès Neon dans cette étape. Le domaine reste différé.

## Implémenté localement

- `backend/app/documents/s3_config.py` : configuration stockage indépendante des secrets d'identité Clerk/OIDC ; origine HTTPS explicite, identifiants explicites, exception HTTP strictement limitée à 127.0.0.1 en environnement de test.
- `backend/app/documents/s3_store.py` : adaptateur indépendant, non branché aux routes. Écritures conditionnelles `IfNoneMatch=*`, reprise identique sans nouvelle version, conflit refusé ; références `VersionId` obligatoires ; contrôle SHA-256 avant restitution ; aucune URL publique ou présignée, aucune méthode de suppression.
- Contrôles de configuration avant écriture : versionnement actif, quatre protections d'accès public actives, ACL propriétaire seule, chiffrement AES256. Les fournisseurs ne proposant pas ces opérations sont refusés à ce stade, pas automatiquement qualifiés par leur étiquette « compatible S3 ».
- Chunks de 64 000 octets compatibles avec le navigateur existant ; limite de fichier 20 Mio ; identifiants UUID et assemblage borné. Le téléchargement vérifié passe par une copie temporaire : ce fichier temporaire n'est pas le stockage durable.
- Champ optionnel `storage_version` dans `Blob`, sans changement des appels LocalStore existants.
- Dépendances SDK figées ; Moto et ses dépendances uniquement dans le lock de tests, pas dans les requirements runtime.
- **Activation applicative S3 explicitement refusée** par `Settings` tant que la file et les routes ne sont pas intégrées. Cela évite qu'une configuration S3 soit ignorée silencieusement avec une écriture locale à la place. Le backend par défaut reste local. Les protections Vercel restent inchangées.

## Recette effectuée

Commande depuis la racine :

```sh
.venv/bin/pip install -r backend/requirements.lock
PYTHONPATH=backend .venv/bin/pytest --confcutdir=backend/tests/documents_unit backend/tests/documents_unit -q
```

**90 tests réussis** : tests unitaires documentaires existants et nouveaux tests S3, en 4,04 s lors de cette exécution. Ruff et `pip check` réussis ; `git diff --check` réussi. Preuves : `docs/rapports/preuves-chantier-8/s3-foundation/`.

Cas S3 couverts : lecture d'une version historique malgré un nouvel objet courant, refus de référence absente/non versionnée, séparation des chemins d'organisations, hash incorrect, replay et conflit d'écriture, assemblage des chunks, tailles/offsets incorrects, délai d'assemblage dépassé, configuration bucket insuffisante, origine/configuration invalide, refus d'activation prématurée de l'API.

**Limites précises :** Moto en mémoire, données fictives uniquement. Aucun serveur S3 persistant, fournisseur réel, test de résidence géographique, IAM réel, chiffrement physique, sauvegarde/restauration complète, ClamAV réel ou test navigateur effectué ici. La séparation des clés testée n'est pas une preuve de RBAC applicatif. Aucun test de base de données : `--confcutdir` exclut volontairement la fixture qui tronque les tables de test. PostgreSQL local observé arrêté ; aucun bootstrap ou reset exécuté. Les 90 tests ne représentent pas la régression backend complète.

## Suite nécessaire, déjà dans le périmètre accepté

1. Migration locale candidate 0008 : backend et références S3 persistés par version, file durable, audit système explicite. Ne pas appliquer à Neon sans validation distincte.
2. Fonctions PostgreSQL à privilèges minimaux pour claim/complete/retry ; rôle worker sans lecture métier générale, pas d'usurpation d'une identité humaine. Leases, fencing et reprises bornées nécessaires ; aucun de ces mécanismes n'est encore codé.
3. Intégration des routes et quotas : finalisation en file, lecture uniquement après `SCAN_PASSED`, autorisation revalidée et audit ; pas de présomption d'autorisation à partir d'une clé S3. Définir le traitement des anciennes versions locales sans déplacement implicite de données.
4. Worker indépendant : assemblage, intégrité, ClamAV qualifié/signatures fraîches, validation de format isolée, publication atomique du résultat SQL. Un contrôle indisponible ne doit jamais libérer la quarantaine.
5. Tests DB/API multi-tenant et portail, permissions, erreurs S3, pannes entre stockage et commit, worker expiré, concurrence, reprise, quotas et contrôles de téléchargement. Puis navigateur/responsive et qualification Vercel séparée.
6. Qualifier un fournisseur UE : région effective, IAM API/worker distincts, versions, conditionnelles, comportement privé, chiffrement, coûts et supervision. Les chunks génèrent jusqu'à 328 objets par fichier de 20 Mio ; le coût des requêtes et des contrôles de configuration doit être mesuré avant activation.
7. Sauvegarde indépendante DB + objets + manifeste de versions et empreintes, avec test de restauration. **Versionnement ≠ sauvegarde.** Les VersionId pouvant changer lors d'une restauration chez un autre fournisseur, prévoir un remappage contrôlé, sans modification opportuniste des preuves scellées. Aucune politique de purge ni durée de rétention n'a été imposée automatiquement.

## Bilan

- **PRÊT localement :** primitives S3 et recette unitaire ciblée.
- **À FINALISER :** migration locale, file, worker, routes, audit, restauration et recette intégrée.
- **BLOQUÉ pour activation :** qualification fournisseur et traitements absents ; garde explicite conservée.
- **RISQUE RÉGLEMENTAIRE :** intégrité et antivirus ne prouvent ni authenticité, ni légalité, ni conformité EUDR. Revue humaine conservée.
- **PROCHAINE LIVRAISON :** file et worker locaux, puis tests de bout en bout. Ce point intermédiaire ne clôt pas le chantier 3 et ne demande pas un nouveau GO pour son périmètre déjà accepté.
