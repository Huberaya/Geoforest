# Qualification du stockage UE et de la sauvegarde indépendante

29 septembre 2026 · **dossier documentaire et préparation locale — aucune activation cloud**.

## 1. Décision proposée

- **Coffre principal : Scaleway Standard Multi-AZ, Paris (`fr-par`), première cible de qualification uniquement.** Le fournisseur n'est pas validé pour le code actuel : le contrat exact de `GetPublicAccessBlock` reste non démontré dans les pages consultées.
- **Dépôt de sauvegardes : OVHcloud Standard 3-AZ, Milan (`eu-south-mil`), candidat**, dans un compte administrativement distinct, avec archives chiffrées côté client et rétention à qualifier. La région, l'offre et le tarif régional devront être confirmés avant toute commande.
- **Ne pas utiliser OVHcloud comme coffre runtime avec l'adaptateur actuel.** Sa matrice officielle indique `get public access block: no` dans les régions classiques. Les Local Zones ne sont pas une solution de contournement : la même matrice y indique notamment `get bucket encryption: no`.
- Conserver Neon, Clerk et le choix de backend Vercel. Cette étude ne relance pas une migration de DB, un IdP Keycloak ni le coffre auto-hébergé de l'ancienne proposition.

Il s'agit d'un **ordre de qualification**, pas d'une sélection définitive. Aucun compte créé, aucune commande, aucun essai gratuit activé, aucune donnée métier transférée, aucun contact fournisseur envoyé. Les contrôles du coffre restent inchangés. Si Scaleway ne satisfait pas les protections exactes, rouvrir le choix du fournisseur ; ne pas retirer une garde pour faire passer le déploiement.

Sources : [1](https://www.scaleway.com/en/docs/object-storage/faq/), [OVHcloud — régions](https://docs.ovhcloud.com/en/guides/storage-and-backup/object-storage/s3-location), [OVHcloud — compatibilité API](https://docs.ovhcloud.com/en/guides/storage-and-backup/object-storage/s3-s3-compliancy).

## 2. Deux services à ne pas confondre

```text
Neon + coffre documentaire privé Scaleway (candidat)
           │ lecture des versions + snapshot SQL cohérent
           ▼
Agent de sauvegarde séparé, hors fonction Vercel
           │ archive AES-256-GCM ; clé hors dépôt d'archives
           ▼
Compte OVHcloud indépendant / région UE différente (candidat)
           │ versions immuables + manifeste final + vérification indépendante
           ▼
Exercice de restauration en DB et coffre cibles neufs, isolés
           └── revue opérateur ; aucune promotion automatique
```

**Le coffre runtime** stocke les objets/chunks privés que l'application et le worker utilisent. Il exige le contrat de `S3Store`, notamment écriture conditionnelle, VersionId, SSE et blocage public.

**Le dépôt d'archives** conserve les sorties chiffrées du dispositif de sauvegarde. Ce n'est ni un second coffre actif ni une réplication aveugle des suppressions. Il nécessitera un transport distinct, un inventaire distant et une recette d'immuabilité et de confidentialité propres. Il n'est **pas implémenté** par le diagnostic livré ici. L'absence d'une API de blocage public chez OVHcloud reste un risque à traiter et à tester ; le chiffrement client ne dispense pas d'interdire l'accès public.

Une archive indépendante ne garantit pas à elle seule un basculement entre fournisseurs. **La cible de restauration runtime doit elle aussi satisfaire `S3Store`** : OVHcloud ne peut pas actuellement servir de cible de secours avec cet adaptateur. Une panne globale du fournisseur principal impose donc de qualifier une seconde cible compatible avant de promettre un PRA inter-fournisseurs.

## 3. Matrice de compatibilité avec le code actuel

Légende : **documenté** = description publique, jamais test de notre compte ; **inconnu** = preuve insuffisante ; **incompatible documenté** = contradiction explicite avec une exigence actuelle. Aucune ligne n'a été vérifiée sur un compte cloud.

| Exigence exacte | Scaleway | OVHcloud, régions classiques | Preuve et recette restante |
|---|---|---|---|
| HTTPS vérifié, SigV4, client en path-style | API S3 documentée ; couple endpoint/client à tester | HTTPS/SigV4 documentés ; path-style à tester | Aucun endpoint réel appelé. Pas de `verify=False` ni redirection non maîtrisée |
| `GetBucketVersioning.Status == Enabled` | Documenté | Documenté | Activer sur bucket neuf puis relire avec l'identité réellement utilisée |
| `GetPublicAccessBlock` et les **4 booléens strictement vrais** | **Inconnu, bloquant** | **Incompatible documenté** : API marquée `no` dans Regions | Les quatre champs sont `BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets` |
| ACL : tous les grants désignent uniquement `Owner.ID` | API documentée ; forme effective à tester | API documentée ; forme effective à tester | Refuser groupes publics et autre grantee ; tester aussi les politiques et l'accès anonyme |
| `GetBucketEncryption` avec `SSEAlgorithm=AES256` | **Documenté**, exemple de réponse SSE-ONE | **Documenté**, SSE-OMK + commande GET | Vérifier la réponse exacte et les permissions. SSE-C/SSE-KMS ne sont pas des remplacements transparents du contrat actuel |
| `PutObject(IfNoneMatch='*', ServerSideEncryption='AES256')` | Conditional writes documentées | Conditional writes documentées | Concurrence, rejet 412/409, reprise après réponse perdue, aucun écrasement silencieux |
| `PutObject` retourne un VersionId non vide, différent de `null` | Versionnement documenté | Versionnement documenté | Réponse effective du SDK à tester |
| `GetObject(VersionId=...)` retourne la version, la taille et `ServerSideEncryption='AES256'` attendues | Fonctionnalités documentées ; combinaison exacte à tester | Idem | GET de l'ancienne version après nouvelle écriture ; SHA-256 calculé sur les octets, pas ETag assimilé à SHA-256 |
| Permissions minimales, refus suppression/ACL/configuration | Politique spécifique Scaleway | Politique utilisateur avec retombée possible sur les ACL | Tests négatifs par identité indispensables ; voir §4 |
| Résidence des octets, logs, secours, clés et accès support | Offre régionale documentée ; contrat à examiner | Idem | Une région sélectionnée n'est pas une preuve contractuelle globale |
| Immuabilité des sauvegardes | Fonction Object Lock documentée | Fonction Object Lock documentée | Rétention effective des versions + essais de refus ; pas encore activé |

### Sources techniques primaires

- [Scaleway — opérations bucket](https://www.scaleway.com/en/docs/object-storage/api-cli/bucket-operations/).
- [Scaleway — SSE-ONE, PUT et GET de configuration AES256](https://www.scaleway.com/en/docs/object-storage/api-cli/enable-sse-one/).
- [Scaleway — écritures conditionnelles](https://www.scaleway.com/en/docs/object-storage/api-cli/using-conditional-writes/).
- [Scaleway — politiques de bucket](https://www.scaleway.com/en/docs/object-storage/api-cli/bucket-policy/) et [équivalence API/IAM](https://www.scaleway.com/en/docs/object-storage/reference-content/s3-iam-permissions-equivalence/).
- [OVHcloud — matrice de compatibilité](https://docs.ovhcloud.com/en/guides/storage-and-backup/object-storage/s3-s3-compliancy).
- [OVHcloud — SSE-OMK et GET de configuration](https://docs.ovhcloud.com/en/guides/storage-and-backup/object-storage/s3-encrypt-your-objects-with-sse-c).
- [OVHcloud — écritures conditionnelles](https://docs.ovhcloud.com/en/guides/storage-and-backup/object-storage/s3-conditional-writes).
- [OVHcloud — IAM, deux parties de la page consultées](https://docs.ovhcloud.com/en/guides/storage-and-backup/object-storage/s3-identity-and-access-management).

**Précisions importantes :**

1. Les deux fournisseurs documentent désormais les conditional writes. Un ancien ticket d'incompatibilité ne suffit pas pour conclure aujourd'hui à leur absence. La documentation OVHcloud précise toutefois que leur prise en charge avec SSE-C est à venir : ne pas choisir SSE-C comme correction improvisée.
2. Les conditions portent sur la version courante. Un delete marker peut rendre à nouveau possible un `If-None-Match: *`. Les droits de suppression et lifecycle sont donc partie intégrante de la protection, pas une option administrative.
3. Chez Scaleway, le réglage de visibilité d'un bucket concerne la liste des objets, pas leur visibilité individuelle. « Bucket privé » ne prouve donc pas le contrat de blocage public. [5](https://www.scaleway.com/en/docs/object-storage/how-to/create-a-bucket/)
4. L'absence de `GetPublicAccessBlock` dans les pages Scaleway consultées reste une **absence de preuve**, pas une affirmation d'absence du service.

## 4. IAM : objectifs, pas politiques déployables validées

| Identité séparée | Besoin minimal visé | Interdictions à démontrer |
|---|---|---|
| API documentaire | Lectures de configuration exigées ; PUT conditionnel de chunks/objets ; GET des objets autorisés par SQL | Supprimer une version, changer ACL/politiques/chiffrement/versionnement/lifecycle, administrer les comptes, accéder au dépôt de sauvegarde |
| Worker antivirus | GET des versions référencées et opérations nécessaires au worker actuel, SQL rôle dédié | Administration bucket, suppression, accès aux clés de sauvegarde ; pas de clé Clerk superflue |
| Capture sauvegarde | Snapshot SQL et lecture des versions nécessaires, selon rôle hors ligne à qualifier | Mutation du coffre source, suppression des archives, modification des droits cloud |
| Émetteur d'archives | PUT dans le dépôt de backup, noms nouveaux, rétention par défaut imposée ; lectures de métadonnées strictement nécessaires | DELETE, bypass de rétention, diminution de durée, changement lifecycle/ACL, administration ; aucune lecture en clair du coffre via cette seule identité |
| Vérificateur/restaurateur | GET des versions d'archives, accès temporaire à la clé ; écriture dans cibles neuves explicitement approuvées | Promotion automatique, écrasement de source, suppression des archives |
| Administration / secours | Provisionnement et gestion des contrats, authentification forte ; accès exceptionnel tracé | Usage quotidien des clés administrateur dans API/worker/CI |

Les capacités finales doivent être déduites des appels réels, pas d'un profil générique `ReadWrite` ou `FullAccess`. Les noms d'actions API et de permissions diffèrent : par exemple `GetBucketEncryption` correspond à une permission `s3:GetEncryptionConfiguration` dans les documentations consultées.

**Scaleway :** politiques version `2023-04-17`, `Principal.SCW`, identités `application_id:...`, ressources sous forme `bucket/prefix/*`. Le modèle courant n'autorise que les actions explicitement permises par la politique bucket **et** l'IAM ; la page indique que les clauses Deny ne sont pas utiles dans ce modèle. Le propriétaire de l'organisation peut réécrire une politique. Ne pas coller une politique AWS avec ARN et Deny en supposant son équivalence.

**OVHcloud :** la documentation IAM indique un repli vers les ACL en l'absence d'Allow/Deny applicable ; un propriétaire disposant de `FULL_CONTROL` peut ainsi rester autorisé malgré un Allow restrictif. Il faut une identité runtime non propriétaire, des refus explicites adaptés au moteur actuel, puis des tests de refus effectifs. La page indique aussi que les bucket policies ne sont pas disponibles pour le périmètre décrit ; ne pas construire la défense sur une politique bucket AWS supposée supportée.

Sources : [Scaleway — politique courante](https://www.scaleway.com/en/docs/object-storage/api-cli/bucket-policy/), [OVHcloud — règles d'évaluation et contre-exemples](https://docs.ovhcloud.com/en/guides/storage-and-backup/object-storage/s3-identity-and-access-management).

**Isolation métier :** un préfixe d'organisation n'est pas une autorisation. L'identité backend peut techniquement couvrir plusieurs organisations ; SQL/RLS, RBAC et contrôles documentaires restent obligatoires. Aucune clé S3 ne doit être transmise à un navigateur ou à un fournisseur du portail.

## 5. Indépendance, clés et conservation proposées

### Indépendance recherchée

- Fournisseur, compte, administrateurs opérationnels et région de backup distincts du coffre principal. Aucun secret administrateur backup dans Vercel, l'API, le worker ou les variables du projet principal.
- MFA, moyens de récupération et comptes de secours séparés ; éviter un unique compte SSO ou email de récupération dont la compromission permettrait de supprimer les deux domaines.
- Administrateurs nommés et procédure à deux personnes pour les opérations irréversibles, changement des clés de secours et clôture de compte. Une procédure à deux personnes ne constitue pas automatiquement une protection technique imposée par le fournisseur.
- Journaux et inventaires vérifiables conservés hors du seul compte source. Tester une révocation totale des accès source sans perdre la récupération de la sauvegarde.
- Cette proposition fournit deux domaines de stockage ; **elle n'est pas encore une stratégie 3-2-1 déployée**. Une troisième copie chiffrée déconnectée est à qualifier selon criticité.

### Clés

Le format livré au lot 08l utilise une clé externe AES-256-GCM de 32 octets. Ne pas joindre cette clé aux archives, aux logs ou à Git. Organiser deux moyens de récupération sécurisés indépendants du stockage principal et du compte backup, accessibles aux seuls restaurateurs habilités ; prouver une restauration depuis le secours de clé.

L'agent de capture actuel a besoin de la clé symétrique en mémoire ; le simple terme « write-only backup » ne supprime pas ce risque. Une enveloppe KMS, des clés par archive, un identifiant de clé et une rotation industrielle sont des évolutions **non livrées**. Ne pas supprimer une ancienne clé avant expiration et vérification de toutes ses archives. L'AES-GCM authentifie les octets mais ne protège pas contre la suppression, ni contre un émetteur compromis produisant une nouvelle archive incorrecte.

### Rétention technique proposée — à approuver avant activation

- 7 captures quotidiennes, 4 hebdomadaires, 3 mensuelles, au plus 14 ensembles distincts dans le modèle budgétaire sans déduplication.
- Fenêtres de verrouillage proposées par classe : 7, 35 et 100 jours. Les dates exactes, le chevauchement des captures et l'expiration des versions doivent être formalisés avant création.
- Essais fictifs avec une durée courte et bornée avant toute rétention irréversible. Cible envisagée : **Compliance** pour les archives finales après validation juridique/coût ; Governance n'est pas équivalent si une identité conserve le droit de bypass.
- Vérifier la rétention de chaque **version** d'objet, le manifeste final et la possibilité de retrouver les versions derrière un delete marker. Object Lock ne doit pas être traité comme un verrou universel sur un nom de clé.
- Ne pas activer un lifecycle qui supprime objets ou anciennes versions encore référencés par SQL. Le nettoyage des chunks/orphelins doit être explicite et sauvegarde-aware ; il n'est pas livré ici.

OVHcloud documente Governance, Compliance et un minimum de rétention d'un jour. Scaleway documente aussi ces modes, mais précise dans ses concepts une exception de suppression lors de la clôture du compte pour Compliance : confirmer contractuellement le traitement d'une clôture, suspension, impayé ou demande support, chez **les deux** fournisseurs. Le mot WORM n'est pas une garantie absolue contre la disparition du compte. [OVHcloud — Object Lock](https://docs.ovhcloud.com/en/guides/storage-and-backup/object-storage/s3-managing-object-lock) · [2](https://www.scaleway.com/en/docs/object-storage/concepts.md)

**Conservation réglementaire :** ces sauvegardes de reprise ne remplacent pas la politique de conservation des dossiers EUDR ni les exigences RGPD. Une rétention Compliance trop longue peut empêcher l'effacement. Faire valider finalités, durées, données personnelles, exceptions et procédure de suppression ; ne pas annoncer de certification EUDR/RGPD.

## 6. Budget stockage prospectif, pas devis SaaS

Tarifs publics consultés le 29/09/2026, HT, sans promotion ni engagement. La commande régionale et les conditions contractuelles prévalent.

| Offre | Prix public relevé | Attention |
|---|---:|---|
| Scaleway Standard Multi-AZ | 0,000022 €/GB/h, soit 0,01606 €/GB/mois sur 730 h | Unité publiée GB ; confirmer conversion et agrégation de facturation des nombreux chunks |
| OVHcloud Standard Multi Zone, premiers 50 Tio | 0,00001917 €/Gio/h, soit 0,0139941 €/Gio/mois | Tarif France public ; confirmer applicabilité au SKU Milan choisi |
| OVHcloud Standard One Zone | 0,00000972 €/Gio/h, soit 0,0070956 €/Gio/mois | Moins cher, mais non retenu comme hypothèse de backup multi-zone |

Sources : [1](https://www.scaleway.com/en/pricing/storage/) · [OVHcloud France — tableau Object Storage](https://www.ovhcloud.com/fr/public-cloud/prices/#object-storage).

**Modèle arithmétique :** 730 h/mois, volumes constants à régime établi, `1 Gio = 2^30 octets`. La conversion Scaleway suppose ici `GB = 10^9 octets`, à confirmer. `P` est tout le volume réellement facturé du coffre, versions et staging compris ; `A` est la taille mesurée d'une archive complète chiffrée, SQL inclus. Pas de compression ni déduplication présumée. Les couples P/A ci-dessous sont des hypothèses de planification indépendantes, pas une mesure de GeoForest.

`coût nominal = P × 1,073741824 × 0,01606 + 14 × A × 0,0139941`

| P : coffre résident | A : archive complète | Backup : 14 × A | Principal | Backup | **Stockage seul** |
|---:|---:|---:|---:|---:|---:|
| 20 Gio | 22 Gio | 308 Gio | 0,34 € | 4,31 € | **4,66 €/mois** |
| 100 Gio | 110 Gio | 1 540 Gio | 1,72 € | 21,55 € | **23,28 €/mois** |
| 500 Gio | 550 Gio | 7 700 Gio | 8,62 € | 107,75 € | **116,38 €/mois** |

**Ce tableau n'est ni une facture prévisionnelle complète ni la capacité du programme actuel.** Les plafonds locaux de sauvegarde (dont archive 256 Mio et source DB 32 Mio) empêchent ces scénarios de production sans évolution et qualification de charge. Les arrondis fournisseur, l'agrégation par bucket/objet et les minimums doivent être confirmés ; le protocole actuel crée des chunks de 64 000 octets et leur conservation peut alourdir stockage et nombre d'opérations.

### Réseau et dépenses non comprises

- OVHcloud publie pour Standard des requêtes, trafic entrant/sortant et extraction gratuits, avec une réserve pour certaines entités contractantes APAC. La cible proposée est un contrat France/UE, pas APAC. [Tarifs officiels](https://www.ovhcloud.com/fr/public-cloud/prices/#object-storage)
- Scaleway affiche 75 GB de sortie gratuits par mois puis une ligne `€0.01 /MONTH` dont l'unité d'excédent est ambiguë dans la page consultée. **Ne pas la transformer en prix confirmé par GB.** Demander l'unité, le périmètre du quota et la tarification des sorties vers OVHcloud. Le trafic interne Scaleway gratuit n'est pas une preuve de gratuité inter-fournisseurs. [1](https://www.scaleway.com/en/pricing/storage/)
- Ajouter `max(0, sortie_SCW_en_GB − quota_applicable) × tarif_egress_confirmé` au modèle. Une capture complète quotidienne relit potentiellement 30 fois les objets dans le mois : le coût réseau peut dépasser le stockage. Les octets SQL viennent de Neon, pas de Scaleway ; les comptabiliser séparément.
- Sont exclus : Vercel commercial, Neon, Clerk production, worker et antivirus, agent backup, volume temporaire chiffré, gestion/escrow des clés, supervision, logs, restauration d'essai, support, TVA, exploitation humaine et domaine futur.
- Proposer des alertes de budget et quotas de stockage après dimensionnement. Une alerte de facturation n'est pas un plafond de dépense garanti.

Ne pas choisir une classe froide pour économiser avant mesure des délais de récupération, minimums de facturation et frais d'extraction. Standard est l'hypothèse de départ pour simplifier les exercices de restauration.

## 7. Recette exigée avant décision de production

Toutes les lignes ci-dessous sont **à exécuter après autorisation explicite**, avec compte de qualification, budget plafonné convenu, ressources neuves et données fictives. Aucune commande mutante cloud n'a été exécutée ici.

| Test | Acceptation attendue / preuve à conserver |
|---|---|
| Configuration et région | Endpoint/région attendus ; quatre appels de sécurité conformes avec identités réelles, réponse régionale confrontée au contrat ; aucun secret dans les preuves |
| Chiffrement et versions | PUT puis GET par VersionId, taille/SHA-256/SSE exacts ; une version plus récente ne remplace pas la référence ancienne |
| Concurrence | Deux écritures conditionnelles concurrentes, un seul contenu accepté ; conflit différent refusé ; rejeu du même contenu sans nouvelle écriture destructive |
| Permissions | Pour API, worker et backup : suppression/version/lifecycle/ACL/chiffrement/versionnement/administration refusés ; essais sous leurs identités, pas sous le propriétaire |
| Confidentialité | GET/HEAD/list anonymes refusés ; identité non autorisée et autre compte refusés ; tentative de publication rejetée/neutralisée selon contrat validé |
| Multi-tenant | Organisations A/B, fournisseur limité, document quarantainé et expiré : aucun accès illégitime ; contrôles applicatifs/RLS conservés |
| Immuabilité backup | Suppression et réduction de rétention refusées sur objets fictifs ; récupération par VersionId même avec marqueur ; verrouillage effectif du manifeste |
| Indépendance | Accès source révoqués ; archive et clé récupérées via moyens de secours distincts ; pas de dépendance au compte principal pour les télécharger |
| Intégrité et erreurs | Archive absente/tronquée/altérée, mauvaise clé, panne réseau, permissions retirées : échec fermé, pas de reçu de succès, alerte exploitable |
| Restauration | Nouvelle DB et nouveau coffre vides ; remappage VersionId, RLS, états/revues, révocation sessions/invitations ; cible offline et aucune promotion automatique |
| Capacité et disponibilité | Mesurer gros jeux fictifs, nombreux chunks, saturation/quotas, indisponibilité régionale ; mesurer durée backup et récupération complète |
| Observabilité | Alerte indépendante si dernière sauvegarde **vérifiée** trop ancienne ; journal hors source ; test réel du destinataire d'alerte |

**Objectifs proposés, non engagements mesurés :** RPO ≤ 24 h et RTO ≤ 8 h pour le périmètre documentaire/SQL sauvegardé. Le RPO se mesure à la date des données de la dernière archive récupérable, pas à la seule heure de fin d'un job. Une fréquence de 24 h ne garantit pas à elle seule ce RPO si un job échoue ou dure longtemps ; prévoir marge, surveillance et reprise. Le RTO couvre récupération des clés, téléchargements, infrastructure cible, restauration, vérifications et décision humaine. Les 8 h ne sont pas prouvées par les tests locaux.

## 8. Diagnostic livré maintenant

- `backend/app/documents/storage_diagnostic.py` : quatre GET de configuration seulement ; réutilise **sans modification** `S3Store.check_security()` sur les observations en mémoire.
- `scripts/diagnose-document-storage.py plan` : plan JSON hors ligne, aucun client construit.
- `scripts/diagnose-document-storage.py local-check` : uniquement `APP_ENV=test`, backend S3, `DOCUMENT_S3_LOCAL_TEST=true`, endpoint `http://127.0.0.1:...`, configuration fictive injectée par environnement. Aucun mode cloud fourni.
- Aucune lecture d'objet, aucun listing, PUT, DELETE, correction de bucket, création de ressource ou changement de droits. Exceptions et noms privés non reproduits dans le JSON.
- Le résultat conserve toujours `provider_qualified=false` et `production_authorized=false`. `OBSERVED_PASS` est une observation de configuration, non atomique, pas un audit complet. Un code retour 0 ne vaut pas autorisation de production.
- Les tests simulent les réponses et interdisent les connexions socket ; le chemin local CLI est exercé avec un faux client. Ce n'est pas une recette HTTP avec un fournisseur ou un émulateur persistant.

```sh
.venv/bin/python scripts/diagnose-document-storage.py plan
PYTHONPATH=backend .venv/bin/pytest \
  --confcutdir=backend/tests/storage_qualification \
  backend/tests/storage_qualification -q
```

Ne pas modifier `DOCUMENT_S3_LOCAL_TEST` pour ouvrir la CLI au cloud. Une future exécution distante devra disposer d'un périmètre autorisé, d'endpoints/régions autorisés explicites, d'identités dédiées et d'un transport contrôlé. Le module de diagnostic n'est pas un endpoint public et ne doit pas être exposé à des URL fournies par un utilisateur.

## 9. Questions prêtes pour les fournisseurs — non envoyées

**Scaleway :**
1. En `fr-par`, quelle prise en charge exacte de `GetPublicAccessBlock` ? Fournir schéma de réponse, les quatre booléens, actions IAM correspondantes et comportement face à ACL/politiques publiques.
2. Confirmer `If-None-Match: *` avec SSE-ONE, VersionId en PUT/GET et en-tête `ServerSideEncryption=AES256` en GET, avec le SDK Python en path-style.
3. Préciser l'agrégation des GB/heures (notamment des chunks 64 kB), définition de GB, prix/unité des sorties Internet vers un autre fournisseur et portée des 75 GB inclus.

**OVHcloud :**
1. Confirmer les limitations de blocage public et le mécanisme permettant d'empêcher effectivement la publication d'archives dans `eu-south-mil`, sans prétendre satisfaire l'adaptateur runtime actuel.
2. Confirmer les permissions de suppression de versions, l'évaluation IAM/ACL et les refus explicites nécessaires pour un émetteur non propriétaire et non administrateur.
3. Confirmer la portée d'Object Lock Compliance, les versions et marqueurs, les droits de modification, les effets de clôture/suspension/impayé et les tarifs Standard 3-AZ Milan sous contrat France.

**Pour les deux :** DPA, sous-traitants et accès support, lieux des données/replicas/logs/secours, notifications d'incident, SLA applicable et exclusions, export/réversibilité, effacement après contrat, politique d'impayés et récupération. Les SLA commerciaux n'assurent ni une restauration de notre DB ni la conformité EUDR.

## 10. Limites et prochaines dépendances

Le lot 08l demeure **local et borné** : arrêt des writers attesté par l'opérateur, clé externe sans KMS, plaintext temporaire privé, pas de planification, transport offsite, Object Lock, alertes ou promotion. Il ne sauvegarde pas tout Clerk, les secrets, l'infrastructure et le patrimoine géospatial externe. Aucun PRA complet de GeoForest ne doit être annoncé.

Le candidat SQL 0008 reste hors Alembic ; aucune autorisation passée pour 0001→0007 ne couvre sa migration cloud. Backend Vercel non déployé ; protections documents/forêt/diligence conservées. Le domaine n'est pas requis pour cette qualification locale.

**Ordre de suite :** réponse documentaire sur le blocage public → choix fournisseur réellement compatible → autorisation séparée compte/coût/recette → adaptation du transport de sauvegarde et des limites de production → exercice indépendant de restauration → revue et GO d'exploitation. En parallèle, l'environnement du worker antivirus et l'orchestration locale peuvent continuer à être préparés sans achat.
