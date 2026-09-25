# Chantier 7 — Coffre documentaire et légalité

**Statut : ANALYSE / PLAN — en attente de validation.**

**Audit en lecture seule : 25 septembre 2026.**
**Aucun code, modèle, migration, fichier documentaire métier, upload ou écriture en base n’a été créé pour C7.** Ce document est le seul livrable ajouté à ce stade.

## 1. Objectif et périmètre historique

Le chantier C7 doit rendre le dépôt, la traçabilité et la consultation des preuves documentaires utilisables dans GeoForest Trace, sans présenter l’outil comme une certification juridique. La feuille de route propose : stockage MinIO/S3, PDF/JPG/PNG/DOCX jusqu’à 20 Mo, validation du type réel, antivirus, métadonnées, versions, commentaires, checklist de légalité, alertes d’expiration et OCR de date d’expiration à titre d’assistance.

Le présent plan réaudite ces choix par rapport au dépôt et aux exigences EUDR consultées en 2026. Les éléments de la feuille de route ne sont pas considérés comme des décisions déjà validées.

## 2. Audit de l’existant

### Ce qui existe

- La page `frontend/src/app/(app)/documents/page.tsx` est un placeholder; aucun workflow documentaire n’y est présent.
- Les paramètres S3/MinIO existent (`S3_ENDPOINT_URL`, accès, bucket et région) et Docker Compose démarre MinIO en local.
- `boto3` est dans les dépendances, mais l’audit n’a trouvé ni client S3 utilisé, ni service de stockage, ni upload, ni téléchargement pré-signé.
- L’application dispose de fondations réutilisables : authentification, rôles, organisation tenant, portail fournisseur, modèle `Alert` et journal `AuditEvent` contenant acteur, action, date, objet, valeurs avant/après et IP.
- Les lots sont déjà reliés à un fournisseur et à un produit; les parcelles sont reliées aux lots. Cela fournit les premières cibles d’association documentaire.

### Ce qui manque

- Aucun modèle/table `Document`, version documentaire, association, endpoint ou service de fichiers n’a été trouvé.
- Aucun contrôle de signature MIME, de taille, de quarantaine ou d’antivirus n’a été trouvé.
- Aucun OCR n’est installé ou utilisé. `Tesseract` et `PyMuPDF` ne sont pas présents dans les dépendances actuelles.
- Les KPI `documents_expiring_soon` et `documents_missing` sont codés à zéro; l’étape d’onboarding documentaire est indisponible.
- Le portail fournisseur indique explicitement que le dépôt de documents n’est pas encore disponible.
- Une alerte `document` existe, mais aucun ordonnanceur/worker périodique pour les échéances documentaires n’a été trouvé. La bibliothèque Celery est installée, sans tâche de ce type observée.
- Les identifiants MinIO présents dans le Compose sont des valeurs de développement. Ils ne doivent jamais être repris comme secrets de production.
- Le modèle `Shipment` contient les dates de récolte et de réception, mais pas la date de mise sur le marché ou d’export. La date d’upload ne peut donc pas servir de point de départ automatique à la conservation réglementaire.

## 3. Exigences EUDR à respecter dans la conception

1. **Lien à l’opération concernée.** L’article 9 exige la collecte et la conservation des informations et éléments probants relatifs aux produits concernés, notamment la provenance, les fournisseurs, la géolocalisation et les preuves pertinentes de légalité. Un document doit donc pouvoir être relié au fournisseur et au produit/lot concerné, et si nécessaire à la parcelle.
2. **Durée et point de départ.** La conservation réglementaire de cinq ans est liée à la date de mise sur le marché ou d’exportation du produit, pas à la date de téléversement. C7 ne doit ni inventer ce point de départ, ni supprimer automatiquement un document sur la base de sa date d’upload. Le produit/lot et l’événement de mise sur le marché/export devront être traçables avant tout calcul de purge.
3. **Checklist non exhaustive.** Les pièces utiles varient selon les lois du pays de production, le produit et le contexte. Les FAQ de la Commission donnent des exemples (documents officiels, accords contractuels, décisions judiciaires, évaluations d’impact, audits), sans en faire une liste universelle. Une checklist par pays/produit ne sera étiquetée « exigence légale » que si sa source, sa portée et sa date de révision ont été vérifiées.
4. **Pas de certification automatique.** Le système peut suivre la présence, les dates, les versions et l’état de revue d’une pièce; il ne conclut pas, à lui seul, à la légalité d’une exploitation, à la conformité EUDR ou à la suffisance juridique d’une preuve.
5. **Pas de connecteur TRACES dans C7.** Le stockage documentaire n’est pas une déclaration. Toute future intégration EUDR-IS devra s’appuyer sur la documentation officielle actuelle de la Commission publiée sur CIRCABC; aucun format/API ne sera supposé ici.

Références officielles consultées :

- [Règlement (UE) 2023/1115 — texte consolidé EUR-Lex consulté](https://eur-lex.europa.eu/eli/reg/2023/1115/2025-12-26/eng), en particulier les articles 9 à 11.
- [Commission européenne — comprendre la diligence raisonnée](https://green-forum.ec.europa.eu/nature-and-biodiversity/deforestation-regulation-implementation/understand-due-diligence_en), y compris la conservation des dossiers pendant cinq ans à partir de la mise sur le marché/export.
- [FAQ EUDR de la Commission — 5e itération, 5 avril 2026](https://environment.ec.europa.eu/document/download/744919a7-8650-4850-89ad-a597268cd69e_en?filename=FAQ-UPDATE-5th-Iteration+FINAL.pdf), notamment les exemples de documentation de légalité.
- [Système d’information EUDR — Commission européenne](https://green-forum.ec.europa.eu/nature-and-biodiversity/deforestation-regulation-implementation/information-system-deforestation-regulation_en); l’API de masse est documentée séparément sur CIRCABC et n’est pas intégrée par C7.

## 4. Plan d’implémentation proposé — soumis à validation

### Phase A — Modèle de données et audit trail

- Ajouter une entité documentaire tenant-scopée et des versions binaires immuables; chaque nouveau dépôt crée une nouvelle version, jamais un écrasement silencieux.
- Associer une pièce à un ou plusieurs objets métier autorisés : organisation, fournisseur, lot/produit et parcelle. Chaque association sera vérifiée côté serveur pour confirmer l’organisation propriétaire.
- Métadonnées manuelles MVP : intitulé, catégorie, émetteur, référence/numéro, dates d’émission et d’expiration (si connues), pays, produit/lot lié, commentaire, taille, MIME détecté, SHA-256, statut antivirus, auteur et dates.
- Journaliser les actions critiques (création, nouvelle version, modification de métadonnées, revue, archivage/téléchargement selon décision) avec `user/action/date/object/previous/new/IP`; ne jamais enregistrer le contenu du fichier, un secret ou une URL pré-signée dans l’audit.
- Conserver un historique de revue distinct des métadonnées courantes. Une pièce remplacée ou expirée reste consultable selon la politique de rétention et les droits.

### Phase B — Stockage et flux de fichiers sûrs

- Bucket privé, clés d’objet aléatoires générées par le serveur, aucun accès public et aucun nom de fichier utilisateur utilisé comme chemin S3.
- Formats proposés : PDF, JPEG, PNG et DOCX; limite proposée : **20 MiB** par version (la feuille de route dit « 20 Mo », l’unité exacte doit être validée).
- Upload authentifié via l’API vers une zone de quarantaine; contrôle de taille, signature réelle et structure OOXML pour DOCX, calcul SHA-256 et analyse antivirus.
- Échec de l’analyse, antivirus indisponible ou type ambigu : conserver en quarantaine et refuser la consultation/téléchargement (fail closed). Ne jamais marquer le fichier comme sûr faute de scanner.
- Téléchargement uniquement après autorisation tenant/rôle et scan réussi; URL pré-signée de courte durée si l’endpoint objet est joignable par le navigateur, sinon proxy API. Les URL/identifiants S3 ne sont ni journalisés ni exposés au mauvais tenant.
- Configuration de production via gestionnaire de secrets, chiffrement côté stockage, TLS et compte de service à privilèges minimaux. Les identifiants Compose actuels restent exclusivement locaux.

### Phase C — Rôles et portail fournisseur

Proposition de permissions à valider :

- `admin`, `compliance`, `procurement` : dépôt, modification des métadonnées, ajout de version et revue des documents du tenant.
- `analyst` et `viewer` : lecture/téléchargement autorisés selon les règles du tenant; aucune modification.
- `supplier` : s’il est inclus dans C7, dépôt uniquement au nom de son propre fournisseur et accès seulement aux pièces qu’il a déposées ou que l’opérateur lui a explicitement rendues visibles; aucune liste d’autres fournisseurs, lots ou documents internes.

La séparation « visible en interne / partagé au fournisseur » doit être explicite. Aucun accès fournisseur ne sera déduit de la seule appartenance au tenant.

### Phase D — Checklist, statuts et revue

- Fournir une première taxonomie de **types de preuves possibles**, configurable et non exhaustive, plutôt qu’une affirmation automatique de pièces universellement obligatoires.
- Une règle de checklist (si activée) doit porter sa juridiction, son produit/commodité, sa source officielle, sa version/date d’effet et son état de revue. Sans règle vérifiée, afficher « à confirmer / selon votre procédure », pas « obligatoire selon l’EUDR ».
- Statuts descriptifs proposés : `à fournir selon la checklist configurée`, `reçu`, `à examiner`, `expiré`, `date inconnue`, `archivé`. L’interface ne dira pas « légalité validée » ou « conforme » sur la base de la présence d’un document.
- La revue humaine et son auteur/date/commentaire seront traçables.

### Phase E — Expiration et dashboard

- Calculer les pièces expirées et celles arrivant à échéance dans les 30 jours à partir d’une date d’expiration connue; l’absence de date reste « inconnue », pas « valide ».
- Remplacer les KPI placeholder par des agrégats tenant-scopés.
- Si des alertes persistantes sont requises, ajouter une tâche quotidienne idempotente et son exécution locale/production (worker/planificateur à configurer). Sinon, commencer par des alertes calculées à la consultation du dashboard; ce choix doit être confirmé.
- Les notifications prévues pour C7 sont in-app uniquement; l’email reste hors périmètre initial sauf décision contraire.

### Phase F — OCR assistif, proposé en deuxième étape

- Ne pas bloquer la mise en place sécurisée du coffre sur l’OCR.
- Si activé ensuite, OCR PDF (Tesseract/PyMuPDF) propose une date ou un numéro avec page/source; l’utilisateur doit confirmer chaque champ. L’OCR ne décide ni de la validité ni de la légalité et n’efface jamais les données saisies manuellement.

### Phase G — Migration et validation technique

- Migration additive Alembic, sans réécrire les révisions existantes.
- Tester upgrade/vérification/downgrade/re-upgrade sur PGlite local; ensuite test sur branche enfant Neon si l’accès sécurisé est disponible.
- **Aucune écriture sur Neon `production`**, aucun déploiement et aucun push pendant la préparation du chantier sans validation distincte.
- Le test Neon enfant et l’état de la connexion sécurisée restent des blocages connus du chantier DB précédent; les IDs Neon seuls ne donnent pas accès. Aucun secret ne sera demandé ou accepté en clair.

## 5. Critères d’acceptation proposés

- Un utilisateur autorisé peut déposer, consulter, versionner et lier une pièce à un objet du même tenant; un autre tenant ne peut ni l’énumérer, ni la télécharger, ni obtenir une URL exploitable.
- Le type réel et la taille sont contrôlés; un fichier avec extension falsifiée, fichier trop grand, DOCX invalide ou fichier détecté malveillant reste rejeté/quarantiné et inaccessible.
- Une panne du scanner ou du stockage n’est jamais transformée en statut « sûr ».
- Versions, empreintes, métadonnées et actions critiques sont traçables; les URL signées et les secrets n’apparaissent ni dans les logs ni dans l’audit.
- La checklist reste configurable et sourcée; aucune absence de pièce ou sortie OCR ne vaut avis juridique/certification.
- Les alertes ne sont créées que pour une date d’expiration connue et sont idempotentes.
- La conservation ne démarre pas à l’upload; chaque pièce pertinente est rattachée au produit/lot concerné et aucun effacement automatique n’est activé sans date et politique validées.
- Migration validée localement et tests de sécurité, d’isolation tenant, de RBAC, de versioning, d’alertes, de build/typecheck et de régression réussis.

## 6. Risques et décisions encore ouvertes

| Sujet | Risque / constat | Décision proposée |
|---|---|---|
| Téléversement fournisseur | Le portail existe mais n’a pas d’upload; ajouter cette voie élargit les tests d’autorisation | Choisir si le fournisseur peut déposer dès la V1 C7; s’il oui, garder le scope strict au fournisseur associé |
| Scanner antivirus | Aucun scanner n’est actuellement câblé | Ajouter ClamAV ou équivalent derrière un adaptateur; fail closed en cas d’indisponibilité |
| Checklist de légalité | Exigences dépendantes du pays, de la commodité et du contexte | Taxonomie générique/configurable dans C7; aucune règle juridique automatique non sourcée |
| OCR | Aucune dépendance ni pipeline présents | Reporter après upload/versions, ou l’inclure comme suggestion humaine seulement |
| Conservation | `Shipment` n’a pas la date de mise sur le marché/export | Lier aux lots maintenant; pas de purge automatique; ajouter le point d’ancrage lorsque le cycle produit le gère |
| Alertes automatiques | Pas de tâche périodique opérationnelle constatée | Choisir entre KPI/alerte à la consultation ou worker quotidien persistant |
| Migration/Neon | Le round-trip local C3 est testé; le test Neon enfant n’est pas fait | Migration additive, test PGlite; Neon enfant uniquement via accès sécurisé; pas de production |

## 7. Rapport de phase — Analyse / Plan

- **FAIT :** audit lecture seule de l’UI Documents, du backend, des dépendances, du stockage MinIO/S3, du dashboard, du portail fournisseur et des fondations RBAC/audit; relecture des exigences EUDR pertinentes et préparation du plan C7.
- **NON FAIT :** aucun code, modèle, endpoint, fichier stocké, migration ou test C7 créé/exécuté; aucune écriture DB, aucun push ou déploiement.
- **PROBLÈMES :** stockage configuré mais inutilisé; pas de contrôle de fichier/scanner, pas de modèle documentaire, pas de checklist, pas de worker d’alertes; pas de date de mise sur le marché/export sur le lot.
- **RISQUES :** fuite de documents/URL signées, accès inter-tenant, fichiers malveillants, checklist présentée à tort comme avis juridique, mauvaise date de début de conservation, clés MinIO de développement réutilisées en production.
- **PROCHAINE ÉTAPE :** obtenir validation du périmètre et des décisions ouvertes ci-dessus; seulement ensuite commencer l’implémentation C7 dans l’arborescence complémentaire, sans remplacer l’application historique à la racine.
