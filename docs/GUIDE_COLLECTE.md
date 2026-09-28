# Guide de collecte initiale — GeoForest Trace

Version 0.3 · chantier 2 · 28 septembre 2026.

**Ce guide décrit une collecte de données, pas une certification EUDR.** Le pourcentage du portail mesure les champs renseignés de cette collecte seulement. Le risque est « non évalué » ; les codes produits sont « à qualifier ».

## Entreprise : de la fiche au lot

1. Connectez-vous et choisissez votre organisation. Les données d’un autre espace ne sont pas mélangées.
2. Ouvrez **Fournisseurs → Ajouter un fournisseur**. Référence interne et nom suffisent pour créer une fiche ; complétez pays, adresse et email quand disponibles. La référence est unique, même après archivage.
3. Ouvrez la fiche pour ajouter les contacts. Leurs noms et emails sont requis ; téléphone et fonction sont facultatifs. La fiche signale les informations d’identité manquantes.
4. Dans **Produits**, ajoutez un nom, une référence et au moins une matière déclarée. Le code SH/NC est facultatif (4, 6 ou 8 chiffres) et n’est jamais déduit automatiquement. Associez un ou plusieurs fournisseurs ; recherchez-les au besoin.
5. Dans **Lots**, choisissez un fournisseur puis l’un des produits qui lui sont associés. Saisissez la quantité positive et son unité ; jusqu’à six décimales, virgule ou point accepté dans l’interface. Les dates de production ne peuvent pas être futures ni inversées. Pays et dates manquants sont signalés.
6. Après revue d’une collecte, vous pouvez la rattacher comme source à un lot du même fournisseur. Ce lien conserve la provenance, il ne prouve pas la conformité.

Admin, Compliance Manager et Procurement peuvent gérer ce référentiel. Analyst et Viewer sont en lecture ; un compte OIDC Supplier est limité à son propre fournisseur. L’Admin peut être soumis à une authentification renforcée selon la configuration de l’environnement.

### Importer un CSV de fournisseurs

- UTF-8, séparateur virgule, 100 fournisseurs et 48 Ko maximum dans l’interface.
- En-têtes autorisés : `reference,name,country,email,address` ; seuls `reference,name` sont obligatoires. Pays au format ISO à deux lettres.
- Exemple **fictif** :

```csv
reference,name,country,email,address
DEMO-001,Coopérative fictive,CI,contact@example.invalid,Adresse fictive
DEMO-002,Entreprise synthétique,FR,,
```

Chargez le fichier ou collez son contenu, cliquez **Vérifier le fichier**, relisez l’aperçu puis **Confirmer l’import**. Si une ligne est invalide ou une référence déjà utilisée, rien n’est importé. Un fichier strictement identique déjà appliqué n’est pas importé à nouveau. Pour corriger une fiche existante, utilisez **Modifier**, pas l’import.

## Inviter un fournisseur sans lui créer de compte

1. Ouvrez sa fiche et cliquez **Créer un lien sécurisé**.
2. Copiez le lien et transmettez-le vous-même à votre contact par un canal de confiance. **Aucun email n’a été envoyé par GeoForest.** Le lien secret n’est affiché qu’à sa création.
3. Par défaut, le lien est valable 72 h et à usage unique. Après ouverture, la session dure au maximum 8 h, sans dépasser l’expiration du lien.
4. **Révoquer** coupe l’accès aux requêtes suivantes. Créer un nouveau lien révoque tous les anciens liens et sessions du fournisseur. Archiver sa fiche fait de même.

Le lien est une clé d’accès : toute personne qui le détient peut ouvrir le périmètre de collecte. Il ne certifie pas l’identité physique du contact. Ne le publiez jamais dans un ticket, une capture ou un dépôt Git. Après fermeture/déconnexion, il faut un nouveau lien pour revenir ; le lien d’origine est déjà consommé.

## Fournisseur : trois étapes sur téléphone

1. Ouvrez le lien reçu puis cliquez **Ouvrir mon espace sécurisé**. L’adresse secrète est retirée de la barre du navigateur avant son échange. N’actualisez pas la page avant d’ouvrir l’espace : si cela arrive, rouvrez le lien reçu.
2. **Mon organisation** : vérifiez le nom, le pays et l’adresse ; renseignez le nom et l’email du contact. Téléphone/type d’organisation sont facultatifs.
3. **Mes produits** : ajoutez au moins un produit (20 max), avec nom, matière, quantité, unité et pays de production.
4. Cliquez **Enregistrer mon brouillon** pour conserver vos modifications. L’enregistrement est explicite, pas automatique. Vous pouvez naviguer entre étapes sans perdre les saisies ; une actualisation ne conserve que la dernière version enregistrée.
5. **Vérification & envoi** : relisez, enregistrez, cochez la confirmation puis cliquez **Transmettre à mon client**. Le bouton reste bloqué si la version enregistrée est incomplète ou si des modifications ne sont pas enregistrées.

Après transmission, la version est figée. Utilisez **Actualiser le statut** pour voir la réponse du client. Si le client demande des corrections, modifiez le brouillon et transmettez à nouveau. S’il marque la collecte revue, celle-ci reste figée ; une nouvelle invitation permettra une nouvelle collecte. Un accès expiré ou révoqué doit être renouvelé par votre client.

## Revue humaine côté entreprise

La fiche affiche les propositions du fournisseur séparément des données internes. Admin et Compliance Manager peuvent, sur une collecte soumise :

- **Demander des corrections**, avec une note expliquant les informations attendues ;
- **Marquer la collecte revue**, avec une note de revue.

Procurement peut organiser la collecte, mais pas effectuer cette revue. Une revue **n’écrase pas** la fiche entreprise, ne crée pas automatiquement de produit ou de lot, et ne produit pas de déclaration officielle. Les soumissions successives sont conservées en base ; les actions sont visibles dans le journal, avec acteur « Portail fournisseur » distinct d’un utilisateur connecté.

## Erreurs fréquentes

| Message / situation | Action |
|---|---|
| Fiche modifiée entre-temps | Fermez/réouvrez la fiche ou rechargez la page pour récupérer la nouvelle version ; aucune fusion silencieuse. Les saisies non enregistrées seront perdues. |
| Référence déjà utilisée / relation incompatible | Choisissez une référence unique. Un produit/fournisseur déjà utilisé dans un lot ne peut pas être délié. |
| Produit absent lors de la création du lot | Associez-le d’abord au fournisseur dans Produits ; vérifiez qu’il n’est pas archivé. |
| Lien invalide, utilisé, expiré ou révoqué | Demandez un nouveau lien. Ne tentez pas de réutiliser celui qui a déjà ouvert une session. |
| Trop de requêtes | Attendez une minute. Dans cet environnement, les clients peuvent partager le limiteur du proxy. |
| Session expirée côté entreprise | Reconnectez-vous via l’accueil. |
| CSV invalide | Corrigez les lignes indiquées, puis revérifiez. Aucune ligne n’a été appliquée. |

## Limites assumées

- Parcelles, GPS, carte, fichiers/documentation de légalité et preuves satellite : pas encore disponibles.
- Aucun calcul de risque pays, test de déforestation, verdict EUDR ou transmission TRACES.
- Pas d’email automatique, de traduction multilingue du portail, de brouillon hors ligne ou de récupération autonome d’accès.
- Archivage irréversible dans l’interface actuelle ; contacts retirables avec conservation du journal.
- 30 collectes et 10 invitations récentes par fiche ; conservation des données plus anciennes en base, sans écran de comparaison historique dédié.
- Ne saisissez que des données fictives dans la démo. L’infrastructure de production et sa politique de protection/rétention des données restent à qualifier.
