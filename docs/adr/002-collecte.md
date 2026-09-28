# ADR 002 — Collecte initiale et approvisionnement

GO explicite reçu pour le chantier 2 uniquement. Le chantier 1 reste la base.

## Périmètre
Référentiels fournisseurs/contacts, produits multi-matières, relations fournisseur-produit et lots. Recherche paginée, archivage sans suppression, contrôle de version, import CSV fournisseurs transactionnel/idempotent. Portail simple par lien à usage unique (fragment URL), expiration/révocation, session dédiée hachée et CSRF. Brouillon, soumission, revue humaine ou demande de correction.

## Séparation des responsabilités
Les propositions du fournisseur restent dans une collecte versionnée ; elles ne réécrivent pas silencieusement les données de l'entreprise. L'entreprise crée les produits/lots et peut rattacher un lot à la collecte revue de son fournisseur. « Revue de collecte » n'est ni une évaluation du risque, ni une conformité EUDR. Les codes SH/NC et matières sont déclaratifs, statut réglementaire « à qualifier ». Pas d'inférence pays/risque.

Le pourcentage décrit uniquement les champs de collecte initiale activés. Parcelles et documents sont explicitement indisponibles jusqu'aux chantiers concernés. Pas de faux fichier, certification, email envoyé ou déclaration officielle.

## Sécurité
Clés étrangères composites organisation/objet ; RLS partout ; lecture OIDC Supplier limitée à son identifiant fournisseur ; écriture canonique Admin/Compliance Manager/Procurement. Revue réservée Admin/Compliance Manager. Supplier du portail possède seulement une session limitée à un fournisseur ; aucune identité utilisateur d'entreprise créée artificiellement. Événements distinguent acteur utilisateur et acteur portail. Les secrets d'invitation ne figurent pas dans les audits. Liens dans le fragment, effacé du navigateur avant l'échange. Expiration et révocation contrôlées sur chaque accès.

## Dépendances et limites
SMTP non configuré : transmission manuelle du lien. Aucun choix de pays/commodité pilote supposé ; aucun moteur réglementaire dans ce chantier. Fournisseur d'identité et hébergement restent ceux du socle. Le UUID Supplier réservé au chantier 1 est contrôlé à l'attribution côté API lorsque des fiches existent ; les anciennes appartenances sans fiche ne voient aucune donnée.

## Tests de sortie
CRUD/version/doublons, limites CSV et absence de lot partiel, liens composites inter-tenant, RBAC, lecture Supplier A/B, token rejoué/expiré/révoqué, session expirée/CSRF, brouillon concurrent, soumission incomplète, révision figée et revue, navigateur entreprise/portail en petits écrans. Aucune transition vers une conformité.
