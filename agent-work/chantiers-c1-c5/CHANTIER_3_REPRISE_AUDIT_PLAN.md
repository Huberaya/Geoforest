# Chantier 3 — Reprise ciblée : audit du portail fournisseur et plan

**Statut : audit et plan présentés, puis validés par « continue »; implémentation et tests ciblés effectués.**  
Le chantier 3 était déjà partiellement livré dans le dépôt. Cette reprise ferme uniquement les écarts avec le périmètre du plan initial, sans réécrire le CRUD fournisseurs, produits et lots déjà présent. L'état de validation final et les réserves de déploiement sont consignés dans la section 4 ci-dessous.

## 1. Analyse de l'existant (état observé avant implémentation)

### Écart de périmètre constaté
Le plan initial `AUDIT_GEOFOREST_TRACE.md` définit le **chantier 3** comme « Fournisseurs + Portail fournisseur (première version) » : CRUD, invitation JWT signée avec expiration, connexion sans mot de passe, page d'accueil et progression, indicateur de complétude/risque, isolation par fournisseur.

Le rapport actuel `CHANTIER_3.md` a livré les fournisseurs, produits et lots, mais a reporté le portail à un chantier ultérieur. Le code correspondant au CRUD est bien présent; le portail initial n'est donc **pas achevé au regard du plan d'origine**.

### État par livrable

| Livrable initial | État observé |
|---|---|
| CRUD fournisseurs et données de contact | **FAIT** — routes et modèle présents |
| Génération d'un lien d'invitation signé et expirant | **NON FAIT** — `/suppliers/{id}/invite` génère un jeton aléatoire stocké, sans vérification JWT, expiration ni acceptation |
| Connexion fournisseur sans mot de passe | **NON FAIT** — aucun échange du lien contre une session fournisseur |
| Espace/page de bienvenue fournisseur | **NON FAIT** — aucune route frontend `/supplier-portal` ni endpoint portail dédié |
| Complétude et progression | **NON FAIT** — pas de calcul; `risk_rating` reste `unknown` |
| Isolation stricte par fournisseur | **À construire avant d'activer un compte fournisseur** — les routes métier de lecture existantes filtrent généralement par `organization_id`, pas par `User.supplier_id` |
| Fiche de détail fournisseur côté opérateur | **LACUNE UI** — la liste lie vers `/suppliers/{id}`, mais aucune page dynamique correspondante n'existe |
| Produits et lots | **FAIT dans l'exécution actuelle** — hors du périmètre à réécrire pour cette reprise |

### Constats de sécurité et de transparence
- Le modèle possède `invite_token` et `invite_sent_at`. Le jeton est généré par `secrets.token_urlsafe(32)`, conservé en base en clair et n'a ni date d'expiration ni état consommé/révoqué.
- `invite_sent_at` est renseigné lors de la génération, alors qu'aucun email n'est envoyé. Le libellé ne doit pas laisser croire que l'invitation a été envoyée.
- Le schéma de réponse `SupplierOut` n'expose pas le jeton; le journal d'audit exclut aussi le secret — bons garde-fous à conserver. En contrepartie, aucun lien utilisable n'est actuellement remis à l'opérateur.
- Les accès fournisseur ne sont pas encore activés. Si un utilisateur `role=supplier` était créé aujourd'hui, plusieurs routes de lecture limitées à l'organisation pourraient lui révéler des données d'autres fournisseurs de cette même organisation (ex. listes fournisseurs, produits, lots ou parcelles). La documentation de `get_tenant_org_id()` évoque un scope fournisseur, mais ce helper n'est pas branché à ces routes.
- `User.supplier_id` ne permet d'associer qu'un utilisateur à un seul fournisseur; l'email utilisateur est globalement unique. Un même contact utilisé par plusieurs fournisseurs/opérateurs doit donc être traité explicitement, et ne doit pas être lié automatiquement au mauvais compte.

### Vérification de référence
`GFW_LIVE_ENABLED=false python -m pytest tests/test_chantier3.py -q` : **15 passed**. Ces tests vérifient les livrables déjà présents, mais pas la consommation, l'expiration, le rejeu ou l'isolation d'un lien portail.

---

## 2. Plan proposé — complément du chantier 3

### A. Cycle de vie d'invitation
1. Exiger une adresse de destination; proposition : `contact_email`, puis `email` en secours. Sans adresse, refuser l'invitation avec un message explicite.
2. Émettre un lien signé et à durée limitée, dédié au type `supplier_invitation`, portant au minimum l'identité fournisseur, l'organisation, l'adresse cible, l'émission, l'expiration et un identifiant unique.
3. Permettre une seule consommation : persister uniquement un identifiant/digest de jeton et ses dates d'expiration/consommation/révocation, jamais le jeton brut. Une réinvitation invalide l'invitation précédente.
4. Utiliser `APP_URL` pour générer l'URL de portail. Proposition produit : durée configurable, **48 h par défaut**.
5. Si SMTP est configuré, envoyer le lien et ne marquer l'état « envoyé » qu'après confirmation d'envoi. Sinon, retourner un état explicite « lien généré — à transmettre » à l'opérateur; ne jamais enregistrer ou afficher « envoyé ».
6. Ne jamais inclure le jeton ou l'URL secrète dans les snapshots d'audit, logs, erreurs ou événements analytics. Le lien ne serait montré qu'une fois à un utilisateur autorisé.

### B. Acceptation et session sans mot de passe
1. Créer un endpoint d'acceptation distinct qui vérifie signature, type, destinataire, expiration, révocation et consommation; refuser les liens altérés, expirés ou déjà utilisés.
2. Créer ou rattacher un compte `User` fournisseur avec `role=supplier`, `organization_id` et `supplier_id` vérifiés; ne pas permettre qu'un email opérateur existant soit silencieusement converti en compte fournisseur.
3. Après acceptation, ouvrir une session fournisseur; prévoir aussi la demande ultérieure d'un lien de connexion à usage unique et limiter les tentatives/réponses afin d'éviter l'énumération d'emails.
4. Après échange du lien, retirer immédiatement le jeton de l'URL visible du navigateur et ne pas le conserver dans les logs client.

### C. Isolation et API portail
- Ajouter des routes dédiées du type `GET/PATCH /supplier-portal/me` et une route de connexion par lien magique.
- Chaque lecture/écriture portail doit filtrer simultanément par `supplier_id` de l'utilisateur et `organization_id`; le client ne choisit jamais librement ces identifiants.
- Refuser aux comptes `supplier` les endpoints internes qui retournent des listes globales d'organisation; autoriser seulement les routes explicitement prévues pour le portail.
- Pour la première version, limiter le portail au profil fournisseur et à l'état de progression. Les dépôts de parcelles/documents pourront rester aux chantiers correspondants.

### D. Interfaces
- Ajouter `/supplier-portal` : acceptation/connexion par lien, page de bienvenue, profil éditable limité aux champs autorisés et progression.
- Ajouter `/suppliers/[id]` pour corriger le lien de détail déjà présent dans la liste et permettre à l'opérateur de gérer l'invitation.
- Proposition de complétude, à valider : cinq éléments à poids égal — adresse complète, nom du contact, email du contact, téléphone du contact, et un identifiant légal (numéro fiscal, immatriculation ou EORI). Afficher explicitement « complétude du profil » et non « conformité EUDR ».
- Le niveau `risk_rating=unknown` doit s'afficher comme **« Non évalué »**; aucun score ni conclusion de risque ne sera inventé dans ce chantier.

### E. Audit trail
Journaliser la génération, l'envoi effectif (si SMTP), l'acceptation, la révocation et les modifications du profil fournisseur avec acteur, date, objet, état avant/après et IP. Ne jamais journaliser le lien, le jeton ou son digest. Si un fournisseur modifie ses informations, l'événement doit distinguer cet acteur du personnel de l'opérateur.

### F. Tests et validation prévus
- jeton valide, altéré, expiré, révoqué, déjà consommé; rotation/réinvitation;
- adresse absente, doublon ou adresse déjà associée à un compte opérateur;
- acceptation sans mot de passe, création de session et rôle `supplier`;
- fournisseur A incapable de lire ou modifier le fournisseur B, ses lots ou données internes, y compris dans la même organisation;
- refus des routes admin/globales pour le rôle `supplier`;
- absence de secrets dans réponses non autorisées, audit et logs;
- SMTP configuré / non configuré avec libellés d'état exacts;
- progression déterministe et libellé « risque non évalué »;
- build et typecheck frontend, suite backend complète.

---

## 3. Décisions retenues après le « continue »

Le « continue » est traité comme validation des valeurs proposées, sans élargir le périmètre : portail limité au profil fournisseur, un fournisseur par compte, complétude à cinq éléments, invitation 48 h, lien de connexion 15 min. En cas d'absence d'email SMTP, le lien d'invitation peut être copié manuellement et n'est jamais qualifié d'envoyé. Les risques sont présentés comme des indicateurs internes, pas comme une certification de conformité.

La migration demeure une question de déploiement distincte : le dépôt ne contient aucune révision Alembic et le démarrage utilise `Base.metadata.create_all`. L'ajout de la table est testé en SQLite, mais aucune migration versionnée ni répétition sur une base PostgreSQL représentative n'a été validée.

---

## 4. Implémentation et validation (25 septembre 2026)

- API dédiée : `POST /supplier-portal/request-link`, `POST /supplier-portal/accept-link`, `GET/PATCH /supplier-portal/me`.
- Invitations signées par JWT, claims liés au fournisseur, tenant et email; JTI aléatoire dont seul le SHA-256 est persisté; TTL configurables (48 h / 15 min); consommation atomique, expiration, révocation et rotation contrôlées.
- Le lien est placé dans le fragment URL pour qu'il ne parte pas dans une requête HTTP ou un Referer; la page le retire de l'historique avant échange. Les réponses d'envoi de lien de connexion sont génériques.
- SMTP : états distincts; envoi effectif audité après succès seulement. L'échec laisse un lien d'invitation manuel à copier, mais révoque un lien magique non livré. Aucune URL ou aucun jeton dans les snapshots d'audit/logs applicatifs.
- Isolation : routes métier d'organisation refusées au rôle fournisseur; profil portail fixé au `supplier_id` et `organization_id` du compte. Champs d'édition limités au profil; risque, statut, nom, pays et email d'identité restent en lecture seule.
- UI : `/supplier-portal` public/acceptation/profil et `/suppliers/[id]` pour détail, invitation/renvoi et transmission manuelle. Complétude présentée comme repère de saisie.
- Tests ajoutés : cycle d'invitation, digest JTI, TTL, expiration/tampering, usage unique/rejeu, rotation/révocation, état SMTP, collision de compte, champs protégés, audit et refus des routes opérateur; isolation entre fournisseurs dans la même organisation.
- Sécurité de dépendances frontend : Next.js / eslint-config-next mis à jour vers 16.3.6; `npm audit` ne signale plus de vulnérabilité.

**Vérifications exécutées :** `GFW_LIVE_ENABLED=false python -m pytest -q` → **71 passed**; `npm run typecheck` → **OK**; `npm run build` → **OK**; `npm audit --audit-level=high` → **0 vulnérabilité**. Avertissements Python restants : dépréciations `python-jose` (`datetime.utcnow`), `argon2-cffi` et scope de fixture `pytest-asyncio`.

**Réserves avant production :** aucune révision Alembic et aucun test PostgreSQL/migration; `init_db()` exécute `create_all()` et absorbe ses erreurs, donc la présence de la nouvelle table/permissions DDL doit être validée en environnement cible. SMTP réel, `APP_URL` public, proxy IP et rate limiting distribué (actuellement en mémoire) ne sont pas validés. La colonne historique `suppliers.invite_token` reste au schéma et d'éventuelles anciennes valeurs n'ont pas été purgées par une migration versionnée. Les jetons de session réutilisent le stockage `localStorage` existant. Le portail ne collecte pas encore parcelles ou documents, conformément au périmètre retenu.

**Prochaine étape :** définir/valider le processus de migration et le déploiement (URL publique, SMTP, base PostgreSQL, rate limiting multi-instance), puis effectuer un test d'acceptation en environnement de préproduction. Ne pas traiter la complétude ni le risque comme une attestation réglementaire.
