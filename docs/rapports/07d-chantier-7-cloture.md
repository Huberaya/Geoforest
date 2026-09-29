# Chantier 7 — bilan de clôture

**GeoForest Trace · 0.8.0 · schéma 0007 · 29 septembre 2026**
Branche : `chantier-7/due-diligence-exports`.

## Décision

**CHANTIER 7 CLÔTURÉ pour le MVP de préparation assistée, revue humaine et exports internes.** Livraison locale, non poussée et non déployée en production. **Aucun chantier 8 démarré : attente GO8.**

Cette clôture n’est pas une déclaration de conformité EUDR, une qualification de TRACES, une certification du coffre ou une autorisation de mise en production du SaaS complet. `DILIGENCE_ENABLED=false` reste le défaut.

## Fonctionnalités livrées

- Préparation de dossiers regroupant jusqu’à 20 lots avec qualification explicite de l’opérateur, du régime, du champ produit, des unités, de la complétude de la chaîne et des géolocalisations.
- Résolution des faits et preuves côté serveur sous RLS ; snapshots immuables et empreintes, historique des versions et décisions auditables.
- Workflow **brouillon → revue → corrections / validation interne / retrait interne**. Une nouvelle révision n’écrase pas l’ancienne.
- Contrôles des lacunes, fraîcheur du risque, sources modifiées, preuves indisponibles, archives et actions ouvertes. Validation humaine motivée, réservée aux rôles habilités ; jamais une décision officielle automatisée.
- Interface staff responsive, consultation historique, erreurs explicites, idempotence et contrôle de version. Supplier et portail exclus des dossiers internes.
- PDF de synthèse, JSON structuré avec géométries et sources, CSV index des lots ; téléchargements privés, audit transactionnel et vérification SHA-256 par le navigateur.
- Guide de **saisie officielle assistée**, sans format d’import TRACES ni connexion officielle revendiqués.

Le régime ordinaire est le seul parcours de validation qualifié dans ce MVP. Les autres régimes sont indiqués « à qualifier » : une limite du logiciel n’est pas présentée comme une interdiction légale.

## Points ouverts du précédent incrément : traitement final

| Point | Résolution |
|---|---|
| Validation positive dans le navigateur avec OIDC | Réalisée avec vrai Keycloak, Authorization Code/PKCE et vraie API/PostgreSQL, sans injection de session |
| Corrections, nouvelles révisions et retrait | Réalisés dans le même parcours, avec contrôle des états et de l’ancienne validation devenue historique |
| Écran 360 px, concurrence et droits/session | Réalisés : conflit 409, droit retiré 403, export après déconnexion/révocation 401, aucun débordement horizontal |
| Limites PDF | Huit nouveaux tests, vrais sous-processus et limites de production, pagination 60/61 pages et contenu long |
| Lisibilité PDF | PDF de dossier fictif validé de 4 pages et mise en page longue de 10 pages ; extraction indépendante, contrôle des pieds de page, examen visuel des pages témoins |
| Export après restauration | Nouvelle restauration isolée : sept tables identiques, un blob vérifié, les trois formats sur cinq révisions, soit quinze exports vérifiés |
| Suivi externe | Périmètre arrêté : guide et exports assistés livrés ; suivi manuel structuré des références et connecteur officiel classés **PROCHAINE VERSION**, non simulés |

### Défaut découvert et corrigé

ReportLab annote/reconstruit les exceptions levées pendant la pagination. Le dépassement de pages devenait donc `PDF_GENERATION_FAILED` au lieu de `PDF_PAGE_BUDGET`. Une exception typée à code stable préserve désormais le motif exact jusque dans la réponse API. Le test de contenu long reproduit l’ancien défaut et passe après correction.

Les premières tentatives OIDC ont également révélé une configuration locale Keycloak sans `/identity` dans son hostname public : l’application a correctement refusé l’issuer divergent. Configuration IdP corrigée et API redémarrée ; aucune désactivation de contrôle d’issuer, signature, PKCE ou CSRF.

## Résultats mesurés

| Vérification | Résultat final |
|---|---|
| Backend complet, version 0.8.0 | **823 passed**, 13 avertissements, **378,40 s**, sortie 0 |
| Dont API diligence | 35 tests dans la régression complète |
| Dont nouveaux tests de limites PDF | 8 tests dans la régression complète |
| Nouveaux parcours Chromium OIDC | **2 passed**, **18,6 s**, sortie 0 |
| Parcours navigateur du précédent incrément | 4 réussis, preuve historique conservée ; non recomptés comme nouveaux tests OIDC |
| Restauration isolée | 7 tables identiques ; 1 dossier, 5 révisions, 10 décisions, 1 preuve physique vérifiée |
| Exports de restauration | **15 réponses 200**, empreintes vérifiées ; JSON/CSV/PDF anonymes **401** |
| TypeScript / ESLint / Ruff | Réussis |
| Build Next.js standalone | Réussi ; dotenv exclus de l’artefact |
| Audits dépendances Python / npm | Aucune vulnérabilité connue signalée au moment de la vérification |

Les 13 avertissements proviennent des dépendances Starlette/TestClient et Rasterio. Un audit sans alerte ne constitue pas une garantie d’absence de vulnérabilités.

La recette navigateur positive contrôle aussi `CURRENT_INTERNAL_VALIDATION` sur le dossier courant validé, puis `NOT_A_CURRENT_VALIDATION` après création de nouvelles révisions. Les téléchargements passent par les vrais boutons et le contrôle d’empreinte du navigateur. Les deux tests OIDC complètent, sans les remplacer, les tests API multi-tenant/RLS/idempotence/concurrence et les scénarios Viewer/Supplier déjà livrés.

### Portée exacte des preuves

- Dossiers, compte OIDC, parcelle, justificatif et évaluations **entièrement fictifs**. La preuve initiale est préparée par des fixtures utilisant un scanner synthétique, seulement dans leur processus. Aucun nouveau test antivirus réel dans ce bloc.
- Keycloak local HTTP en mode développement : authentification réelle, mais **pas** qualification TLS/SSO/MFA de production. Aucune donnée ni intégration officielle EUDR utilisée.
- Les tests de ressources remplacent le rendu par des sondes dans de vrais enfants et appliquent le `main()` de production : dépassement d’allocation mémoire, CPU, taille de fichier et délai réel, puis vérification qu’aucun enfant ne survit. Ils ne prouvent ni une sandbox réseau ni la tenue en charge à grande échelle.
- Pour la restauration, les serveurs sources ont réellement été arrêtés avant dump/copie. Comparaison et exports ont été exécutés avant la nouvelle régression destructive. Les sessions/invitations restaurées et les sessions temporaires ont été révoquées. Le dump et le coffre restent privés hors Git.
- Les migrations neuve et peuplée du deuxième incrément restent des preuves historiques ; aucune nouvelle migration n’a été ajoutée à cette clôture.

## Bilan de lancement

| Statut | Périmètre |
|---|---|
| **PRÊT — recette locale du MVP 7** | Préparation, revue humaine, historique, isolation des dossiers et exports internes bornés |
| **À FINALISER — avant production** | Qualification de l’hébergement et du coffre, chiffrement/secrets, antivirus et sandbox d’exploitation, sauvegardes/restauration opérationnelles, configuration SSO/TLS, charge/observabilité et revue globale du chantier 8 |
| **BLOQUÉ — intégration officielle** | Contrat API officiel et accès authentifié non qualifiés dans cet environnement. L’API existe ; aucun connecteur ni dépôt officiel implémenté |
| **RISQUE RÉGLEMENTAIRE** | Données/preuves et champs produit/régime à vérifier humainement ; observations forestières indicatives ; validation interne sans valeur de certification ou déclaration officielle |
| **PROCHAINE VERSION** | Suivi manuel structuré des références externes, intégration officielle qualifiée, parcours des autres régimes, file durable/montée en charge. Les reports OCR/SMTP et autres réserves des chantiers antérieurs demeurent visibles |

Le suivi de références externes était envisagé comme éventuel : il n’est pas remplacé par un statut ambigu ou un champ libre faisant foi. Le mode assisté livré répond au périmètre prévu en l’absence d’intégration officielle qualifiée. Ne pas saisir un **numéro de vérification officiel secret** dans les notes exportables. ACCEPTANCE ne doit jamais être assimilé à une déclaration juridiquement valable.

## Exploitation et documents

Activation explicite après migration 0007, sauvegarde et revue de configuration. Le PDF demeure une synthèse : joindre le JSON pour les géométries et le détail structuré. Ni les pièces binaires ni les blocs raster complets ne sont embarqués. Limites : 20 lots/révision, 500 révisions/organisation, 80 Mio de preuves distinctes relues, JSON/CSV 2 Mio, PDF 8 Mio/60 pages/80 000 caractères affichés. Un seul PDF simultané par base (429 si occupé), délai parent 25 s, CPU 15 s et espace d’adressage 512 Mio.

- [Guide utilisateur et saisie assistée](../guide-diligence.md)
- [Recette reproductible et restauration](../recette-diligence.md)
- [Contrats API](../API.md) et `../openapi.json`
- [ADR 007](../adr/007-due-diligence-exports.md)
- [Registre réglementaire](../reglementation/07-diligence-declarations.md)

Preuves dans `preuves-chantier-7/` : `backend-final.txt`, `e2e-oidc-final.txt`, `restauration-finale.json`, `build-final.txt`, `types-final.txt`, `lint-final.txt`, `ruff-final.txt`, audits Python/npm et trois captures de recette fictive. Les anciens rapports sont conservés comme historique et renvoient désormais à ce bilan.

**Aucun push avec un ancien token, aucune modification de main, aucun engagement payant. La modification de mode préexistante de `infra/bootstrap-db.sh` reste hors livraison. Attente GO8.**
