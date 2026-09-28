# Gestion des risques et DDR — audit du dépôt et plan proposé

**Date de l’audit : 27 septembre 2026**

**Périmètre :** projet complémentaire `agent-work/chantiers-c1-c5/`. L’application historique à la racine a été consultée uniquement pour auditer ses règles et exports EUDR existants; elle n’est pas une cible de modification.

**État de l’audit initial :** l’analyse du dépôt et des sources officielles a été terminée avant toute implémentation; le plan a ensuite été accepté par l’instruction explicite « réalise et valide le chantier risques-DDR ». Cette instruction a autorisé l’implémentation dans le seul projet complémentaire `agent-work/chantiers-c1-c5/`.

**État d’exécution (27 septembre 2026) :** la migration additive, les routes/services et interfaces Risques/DDR/Déclarations sont préparés; tests backend et frontend exécutés avec succès (résultats et limites en section 10). Aucune migration n’a été appliquée à une base, aucune écriture Neon/production, aucun commit ni push n’a été réalisé. Le projet historique à la racine n’a pas été modifié. Une exception ciblée dans `agent-work/chantiers-c1-c5/.gitignore` permet de versionner `frontend/src/lib/` sans toucher au `.gitignore` racine.

**Checkout de départ :** `agent/chantiers-c1-c5-complement`, HEAD `0144bed`. L’arbre de travail était propre avant la création du plan; il contient maintenant les modifications non commitées du chantier.

## 1. Synthèse et recommandation

Le projet complémentaire dispose de bonnes fondations pour construire un dossier de diligence : lots, produits, fournisseurs, parcelles, coffre documentaire versionné, portail fournisseur, journal d’audit et dépistage géospatial C5. En revanche, **il n’a aujourd’hui ni moteur d’évaluation des risques EUDR, ni modèle de DDR/déclaration, ni route API ou interface fonctionnelle correspondante**.

La recommandation est de bâtir, dans le seul projet complémentaire, un flux tenant-scopé qui :

1. distingue quatre objets qui ne doivent pas être agrégés en un score unique :
   - le benchmark réglementaire **pays ou partie de pays**;
   - le dépistage géospatial C5, qui produit un **signal descriptif**;
   - le risque interne de gestion d’un fournisseur;
   - l’évaluation réglementaire **du produit / lot, de ses origines et de sa chaîne d’approvisionnement**, avec preuves, mesures et décision humaine;
2. versionne les référentiels produit et pays avec leur source et leurs dates d’effet;
3. collecte et relie les preuves aux produits, lots, fournisseurs, parcelles et étapes de chaîne;
4. enregistre l’évaluation, les mesures d’atténuation et une décision humaine traçable;
5. prépare un dossier et les données utiles à la saisie dans l’Information System EUDR, sans prétendre le transmettre;
6. affiche **« Préparé pour déclaration »** comme état maximal tant que l’échange officiel n’a pas été documenté, testé et vérifié. Aucun libellé « Déclaré » ne doit être utilisé pour un simple export ou une référence interne.

**Aucun connecteur EUDR-IS/TRACES ni format d’API n’est proposé à ce stade.** La Commission indique que la documentation d’API des opérateurs est publiée sur CIRCABC et doit être consultée régulièrement. Le dossier CIRCABC a été ouvert dans cette session, mais son contenu technique n’a pas pu être récupéré (écran de chargement/cookies). La spécification reste donc **non auditée**; c’est un prérequis bloquant à tout futur connecteur.

## 2. Résultats de l’audit du dépôt complémentaire

### 2.1 Données existantes et périmètre de risque

- `backend/app/models/suppliers.py` expose `SupplierRiskRating` (`unknown/low/medium/high`). Le risque est `unknown` par défaut; aucun moteur, critère, preuve, source ou version de calcul n’a été identifié. Le schéma d’écriture fournisseur ne permet pas de renseigner une évaluation justifiée. Cette propriété est un indicateur interne fournisseur, pas une évaluation de conformité d’un produit EUDR.
- La fiche fournisseur contient le **pays du fournisseur**; le pays de production est une information distincte, portée facultativement par `Shipment.country_of_production`. Le pays du siège/fournisseur ne doit donc jamais servir automatiquement de pays de production.
- `Product` stocke une commodité et un code SH libre. La liste `EUDR_COMMODITIES` est un sélecteur simplifié d’exemples (codes généralement à 4 chiffres); elle n’est ni un inventaire exhaustif de l’Annexe I ni un référentiel daté. Elle ne représente pas correctement, à elle seule, les codes « ex », les exclusions, les espèces et les dates d’effet actuelles.
- `Shipment` relie un lot à un seul fournisseur et un produit, avec quantité et unité libres, pays de production optionnel et date de récolte optionnelle. Il n’y a pas de pays ou partie de pays au niveau de chaque origine, de période de production structurée, de masse nette obligatoire ni de lien quantité/source permettant de représenter proprement les mélanges, transformations et apports de plusieurs origines.
- `Plot` est lié au lot et porte une géométrie, des métadonnées de validation et une année de récolte optionnelle. C’est une bonne base géographique, mais le lien lot-parcelle ne suffit pas à prouver l’allocation des quantités ni le lien de chaque matière première à un produit transformé.

**Conséquence :** l’évaluation DDR doit être portée par un dossier lié au périmètre de produit/lot et à ses sources, pas par une note permanente sur le fournisseur. Pour les lots mixtes, chaque origine/parcelle doit rester identifiable; une moyenne de scores ne convient pas.

### 2.2 Benchmark pays, dépistage C5 et appréciation réglementaire

- Le service complémentaire `services/satellite/deforestation_screening.py` et son interface C5 distinguent `signal_post_2020`, `no_signal_observed`, `non_evaluable` et `source_unavailable`. L’interface avertit expressément qu’une absence de signal ne signifie pas conformité; l’année frontière 2020/2021 impose une revue humaine. Les résultats gardent leur provenance, version de données, version d’algorithme et historique dans l’audit. **C’est la séparation à préserver** : C5 ne conclut pas à la légalité, au risque négligeable ni à la conformité EUDR.
- Le benchmark officiel de l’article 29 est une classification de pays ou parties de pays (faible/standard/élevé), utile notamment pour déterminer si la diligence simplifiée de l’article 13 peut s’appliquer. Il ne remplace pas l’évaluation de l’article 10 et n’est pas une note fournisseur.
- Le rating fournisseur existant ne doit pas être alimenté par le benchmark ou C5 sans décision distincte et explicite. Recommandation d’interface : le nommer **« Risque interne fournisseur »** et le dissocier visuellement du benchmark pays et de la décision DDR.

### 2.3 Preuves, coffre documentaire et traçabilité

- C7 fournit déjà `Document`, `DocumentVersion`, `DocumentLink` et `DocumentChecklistItem` : versions binaires, empreinte SHA-256, état d’analyse antivirus, dates, révision et liens vers fournisseur, produit, lot ou parcelle. Les routes contrôlent le tenant de la pièce et de sa cible.
- La checklist documentaire est configurable par l’organisation et son code précise qu’elle ne constitue pas une règle juridique. Elle peut soutenir une collecte de pièces, mais ne doit pas être présentée comme liste exhaustive ou décision de légalité.
- `AuditEvent` et `record_audit_event` sont réutilisables : acteur, action, date, objet, instantanés avant/après et IP; les événements sont protégés contre modification/suppression via l’ORM et le journal est consultable par admin/conformité. Les créations/modifications de fournisseurs, produits, lots, parcelles, pièces et analyses C5 sont déjà journalisées.
- Point de vigilance : `plot_snapshot` place la géométrie et son centroïde dans le journal d’audit. Cette donnée est sensible; le futur DDR devra conserver l’audit exigé sans élargir les permissions ni les expositions de coordonnées. La source de l’IP directe (`request.client.host`) devra également être vérifiée derrière les proxies de déploiement.

### 2.4 Rôles, routes et interface

- `UserRole` (`admin/compliance/procurement/analyst/viewer/supplier`) est le RBAC interne au SaaS. `SupplierType` (`producer/cooperative/trader/processor/other`) décrit un type de fournisseur. Aucun des deux ne suffit à qualifier les rôles économiques EUDR, qui dépendent notamment de l’activité, de la place dans la chaîne, de la taille et du caractère primaire de la production.
- `Organization.plan` vaut par défaut `pme`, mais il s’agit d’un plan tarifaire. Il ne doit pas être utilisé comme preuve de taille réglementaire ou pour attribuer automatiquement un régime EUDR.
- Les routes existantes couvrent fournisseurs, produits, lots, parcelles, pièces, portail fournisseur, dépistages C5, dashboard et audit. **Aucune route `/risks`, `/dds` ou `/declarations` n’a été trouvée.** Le service `services/eudr/` est vide hors initialisation.
- Les pages UI Risques, DDR, Déclarations et Rapports sont des placeholders. Les compteurs DDR du dashboard restent à zéro/null. Le statut de lot `ready` est défini dans le modèle comme « DDR prêt / déclaré », alors que l’interface affiche « DDR prêt »; le PATCH de lot permet de choisir les statuts sans workflow DDR sous-jacent. Ce statut ne peut donc pas attester une déclaration.
- Le portail fournisseur peut afficher le rating interne défini par l’opérateur. Il ne transforme pas le fournisseur en « opérateur » EUDR.

### 2.5 Migrations et tests présents

- La chaîne complémentaire comprend `20260925_0001_initial_schema` puis `20260926_0002_document_vault`. Elle est additive et indépendante de l’application historique; le head source est `20260926_0002`.
- Les tests actuels couvrent notamment RBAC/tenant, fournisseurs-produits-lots, C5 (provenance, absence de verdict automatique, échec fermé, historique et isolation), coffre documentaire et compilation hors ligne de la chaîne Alembic.
- Aucun test de référentiel Annexe I courant, benchmark versionné, critères Article 10/11, rôles économiques ou DDR/déclaration n’existe encore. Aucun test n’a été lancé pendant cet audit.

### 2.6 Exportateur historique à la racine — constat de non-réutilisation

L’application historique contient `backend/app/services/traces_exporter.py` et `src/lib/eudr/traces-exporter.ts`, ainsi qu’une route `/api/v1/export/traces`. Ces fichiers **revendiquent** un XML `SubmitStatementRequest` pour TRACES-NT, mais construisent un XML avec des namespaces et une extension GeoForest Trace propres au dépôt. Les tests de cette application vérifient que ce XML est bien formé et que ses propres champs sont présents; aucun XSD officiel, contrat CIRCABC ou test d’acceptation EUDR-IS n’a été trouvé.

Autres problèmes pertinents : l’exporteur produit `VERIFIED_COMPLIANT` à partir d’un résultat géospatial; l’export ajoute une référence `GFT-…` et renseigne `exported_at` dès la demande de téléchargement, sans soumission officielle. Cette référence est interne, pas un numéro EUDR-IS. L’ancienne table pays utilise des boîtes géographiques approximatives et diverge de la liste officielle actuelle (par exemple Ghana/Inde/Kenya/Vietnam sont codés `STANDARD` dans cette table alors que la liste officielle les classe `LOW`; le code utilise aussi `EU` comme code de résolution). Enfin, la route historique d’export lit un audit par identifiant sans scope d’organisation visible dans le fichier consulté.

**Décision d’audit :** ne pas reprendre cet exporteur, son « verdict conforme », son benchmark ni ses statuts dans le projet complémentaire. L’application à la racine demeure intacte, conformément au périmètre.

## 3. Base réglementaire contrôlée au 27 septembre 2026

Les textes de référence sont les actes publiés au Journal officiel; un texte consolidé est une aide de lecture et ne remplace pas les actes postérieurs.

| Sujet | Référence officielle vérifiée | Conséquence pour le plan |
|---|---|---|
| Diligence raisonnée | Règlement (UE) 2023/1115 consolidé au 26/12/2025, notamment art. 4–13; modifié par le règlement (UE) 2025/2650 | Séparer collecte Article 9, évaluation Article 10, atténuation Article 11, système/registre Article 12 et déclaration officielle. Garder les éléments probants pendant la durée légale. |
| Critères de risque | Article 10(2) et orientations Commission C/2026/3896 | Prévoir des constats contextualisés et des preuves sur : benchmark pays/parties, forêts, peuples autochtones et consultations/revendications, tendance déforestation, fiabilité des informations, corruption/fraude/application du droit/droits humains/conflits/sanctions, complexité/traitement, contournement/mélange, conclusions des groupes d’experts, préoccupations étayées/historique et autres informations pertinentes. Les certifications peuvent compléter les preuves conformes à l’article 9, pas remplacer la responsabilité de l’opérateur. |
| Atténuation et gouvernance | Articles 11–12 | Enregistrer demandes de données supplémentaires, enquêtes/audits, autres mesures et, si utile, soutien aux fournisseurs; documenter les décisions et leur réexamen annuel. Prévoir la revue annuelle du système de diligence et la conservation quinquennale. Les obligations de publication annuelle concernent certains opérateurs non-PME; elles doivent être rattachées à une taille/qualification confirmée, pas au plan tarifaire. |
| Benchmark pays | Règlement d’exécution (UE) 2025/1093 et liste officielle Commission consultée | Les quatre catégories `HIGH` sont Biélorussie, Corée du Nord, Myanmar et Russie. La liste officielle courante classe notamment Ghana, Inde, Kenya, Vietnam, Thaïlande et Papouasie-Nouvelle-Guinée comme `LOW`, contrairement aux boîtes statiques de l’application historique. Importer la liste officielle complète et sa version; ne pas approximer une frontière par une boîte englobante. Recontrôler la liste avant implémentation, car la Commission annonce un système dynamique. |
| Rôles et régimes simplifiés | Règlement (UE) 2025/2650; pages Commission sur rôles/diligence | Séparer : (a) diligence simplifiée Article 13 pour produits exclusivement issus de zones `LOW`, après examen de la complexité et du mélange/contournement; Article 9 reste requis et des informations de risque peuvent déclencher la diligence complète; (b) déclaration simplifiée Article 4 bis pour micro/petits opérateurs primaires répondant aux critères légaux. Ce sont deux voies distinctes. Représenter aussi opérateur amont, opérateur aval, commerçant, premier acteur aval et représentant autorisé. |
| Obligations aval et dates | Page officielle Commission « Roles and responsibilities » | Les rôles aval ne sont pas des utilisateurs du portail : les obligations de conservation, de notification, d’enregistrement et de vérification dépendent de l’acteur, de sa taille et de sa place dans la chaîne. Échéances publiées : 30/12/2026 pour grandes/moyennes et certains micro/petits déjà couverts par l’EUTR; 30/06/2027 pour la plupart des autres micro/petits. |
| Produits de l’Annexe I | Règlement délégué (UE) 2026/2102, publié le 17/09/2026 et en vigueur le 18/09/2026 | Le catalogue doit être une table versionnée avec code, description, qualificatif « ex », espèce, exclusions et période d’effet. Exemples : soja remplacé par `1201 90 00`; retrait des entrées de cuirs bovins `ex 4101`, `ex 4104`, `ex 4107`, des entrées `ex 4010` et `ex 4016`; pneus limités à `ex 4012 90 30`. Les ajouts visés (dont café soluble, langues bovines congelées et certains dérivés du palmier) s’appliquent à partir du 30/12/2027; les changements ne doivent pas être aplatis dans une liste intemporelle. Les espèces, déchets, produits usagés et emballages comportent aussi des précisions/exclusions. |
| EUDR Information System | Règlement d’exécution (UE) 2026/1565 et page officielle Commission | L’Information System fournit une interface officielle pour déclarations DDS et simplifiées; la Commission distingue Production (soumissions à valeur juridique) et Acceptance (formation/tests, sans valeur juridique). La page indique que l’API opérateur et ses mises à jour sont documentées dans CIRCABC. Elle mentionne GeoJSON pour les coordonnées, ce qui ne suffit pas à valider un schéma d’API de déclaration. |

## 4. Modèle de risque recommandé

**Ne pas calculer un score juridique global ou une « conformité automatique ».** L’application peut signaler des données manquantes, présenter des facteurs et aider l’opérateur à documenter son raisonnement; l’opérateur reste responsable et un utilisateur autorisé prend la décision.

1. **Benchmark pays** — donnée de référence partagée, source/version, niveau, pays ou région concernée et dates d’effet. Une valeur inconnue ou une origine non déterminée ne devient pas automatiquement `LOW`.
2. **Signal C5** — observation géospatiale versionnée, avec limites, source et revue requise. Conserver les états prudents actuels; ne pas convertir `no_signal_observed` en faible risque ou conformité.
3. **Risque fournisseur interne** — suivi achats, séparé et explicitement étiqueté; il peut informer le dossier, mais ne constitue pas le résultat EUDR du lot.
4. **Évaluation Article 10 du produit/lot** — dossier par périmètre de produit mis sur le marché/exporté, relié à toutes ses sources, parcelles/établissements, dates ou périodes, fournisseurs et transformations. Pour chaque critère pertinent : source, fiabilité, preuve associée, appréciation motivée, auteur/date et éventuelle réserve. Ce cadre ne doit pas devenir une checklist universelle à cases à cocher : les orientations Commission précisent que la diligence n’est pas un processus « tick-box ».
5. **Atténuation Article 11** — actions, responsable, échéance, preuves demandées/reçues, résultat et réévaluation. Un risque non négligeable non résolu bloque la préparation du dossier pour mise sur le marché/export.
6. **Décision humaine** — états internes séparés : incomplet; à évaluer; atténuation requise; en revue; décision documentée « nul ou négligeable » ou « non négligeable / blocage ». Les éléments et versions examinés restent figés dans l’historique.
7. **Revue du système Article 12** — au minimum, dater les revues annuelles, politiques/procédures concernées, changements de règles et actions de contrôle; confirmer séparément le périmètre d’un éventuel rapport public.

### Modèle de données logique (noms indicatifs, à confirmer avant migration)

| Objet logique | Portée / fonction |
|---|---|
| `RegulatorySourceVersion` + `ProductScopeRule` | Référentiels partagés versionnés : texte source, code CN/SH, description, « ex »/qualificatifs, exclusions, version et période d’application. |
| `CountryBenchmarkVersion` | Liste officielle complète avec pays/parties, niveau, acte source, date de publication et période d’application. |
| `EconomicActorProfile` | Profil EUDR confirmé par un responsable (rôles possibles, taille selon la référence légale, producteur primaire ou non, activités et dates de validité). Aucun héritage du rôle RBAC ni de `Organization.plan`. |
| `SupplySource` / allocation d’origine | Lien du produit ou lot vers plusieurs sources, parcelles/établissements, quantités/unités, périodes et étapes de chaîne; support du mélange/transformation sans perte de provenance. |
| `DueDiligenceCase` | Dossier tenant-scopé sur un périmètre de produit/lot et une date d’action, avec snapshot du code produit et des versions de règles/bases de risque utilisés. |
| `RiskFinding` / `MitigationAction` / `DecisionRecord` | Constats, motifs, mesures, preuves et décisions versionnés; liens contrôlés vers `DocumentVersion` et journal d’audit. Pas de score réglementaire opaque. |
| `DeclarationPreparation` | Préparation distincte d’une DDS ou d’une déclaration simplifiée (Annexes II/III), données préremplies et contrôles de complétude. Toute référence saisie par un utilisateur sans retour officiel vérifié reste étiquetée « référence externe saisie manuellement — non vérifiée ». |

Les objets propres à un client doivent tous porter `organization_id`; les objets de référentiel réglementaire partagés doivent être séparés des données client. Toute cible de document ou d’origine devra être validée dans le tenant avant lecture, association ou export.

## 5. Parcours utilisateur cible

1. **Qualifier le périmètre.** Confirmer l’acteur économique et son rôle pour cette opération, la taille réglementaire, la première mise sur le marché/export, le produit, le code réellement applicable et la date d’action. Un utilisateur peut avoir plusieurs rôles; ne pas déduire le rôle à partir du type de fournisseur.
2. **Collecter les données Article 9.** Produit/description/espèces le cas échéant, quantité et unité requises, pays et partie du pays, toutes les parcelles ou établissements concernés, date/période, fournisseurs/acheteurs et éléments probants de déforestation zéro et de légalité. Les documents C7 restent versionnés et associés au bon niveau.
3. **Déterminer la voie de diligence.** La voie de l’article 13 n’est disponible que si tous les produits/origines satisfont aux conditions `LOW` et que la complexité, le mélange et le contournement ont été examinés. La déclaration Article 4 bis est une voie distincte, réservée à l’acteur primaire légalement admissible; elle peut utiliser les données prévues à l’Annexe III. Le système ne déduit pas ces conditions du plan SaaS.
4. **Examiner les signaux et les critères.** Afficher séparément le benchmark, le dépistage C5, les preuves documentaires et les autres informations. Une lacune, une source indisponible, une origine inconnue ou un signal non résolu garde le dossier incomplet/en revue.
5. **Atténuer et décider.** Suivre les demandes/audits/actions et leurs preuves; faire enregistrer la décision motivée par un rôle conformité autorisé. Un niveau de risque non négligeable ou non résolu bloque le dossier.
6. **Préparer, pas déclarer.** Générer un dossier interne et des données de saisie conformes aux modèles réglementaires après revue de leur contenu; utiliser l’interface officielle et ses outils pour tout dépôt tant que l’API n’est pas vérifiée. Afficher **« Préparé pour déclaration »**. Un téléchargement, une référence interne ou une déclaration orale de dépôt ne vaut pas retour de l’Information System.
7. **Traçabilité aval et revue.** Prévoir la conservation des références DDS/identifiants fournis par les amont selon le rôle de l’organisation, les notifications liées à de nouvelles informations, le suivi des revues et la conservation légale.

## 6. Plan d’exécution proposé — après validation explicite

### Étape 0 — Référentiel et règles de gouvernance

- Reprendre les textes en vigueur et les lignes directrices à la date de réalisation; enregistrer les références officielles, dates, version et limites d’interprétation.
- Refaire la comparaison exhaustive de l’Annexe I et de la liste benchmark juste avant d’importer les référentiels; revue humaine des codes « ex », espèces, déchets, produits usagés, emballages et dates différées.
- Définir avec le métier qui confirme les rôles EUDR, la taille légale, les pays/parties d’origine et la décision finale; ne pas présenter le produit comme certification juridique.

### Étape 1 — Modèle et migration additive

- Ajouter le minimum de tables versionnées pour les référentiels et le dossier DDR, ses sources, constats, atténuations, décisions et préparations de déclaration.
- Réutiliser le coffre C7 et le helper d’audit; n’ajouter une nouvelle cible de lien qu’avec contrôle tenant côté route et tests dédiés.
- Préserver les colonnes, statuts et événements existants; ne pas réinterpréter ou effacer des données historiques. Le statut historique `ready` devra être traité explicitement et jamais assimilé à une soumission.
- Produire une migration strictement additive après le head existant; son exécution/test en base doit rester hors production et nécessiter l’accord correspondant. Aucun DDL sur Neon `production` n’est inclus dans ce plan.

### Étape 2 — Services et API tenant-scopés

- Endpoints pour les référentiels, profils économiques, dossiers, constats, mesures, décisions, historique et préparation.
- Vérification d’organisation sur chaque objet lié, règle RBAC par action, refus d’accès aux géométries selon rôle, journalisation de toutes les opérations critiques avec instantanés avant/après et IP.
- Règles d’état conservatrices : données insuffisantes ⇒ incomplet; signal indisponible ⇒ pas de résultat; pas de préparation si blocage non résolu; pas de statut de dépôt sans retour officiel vérifié.

### Étape 3 — Interfaces

- Remplacer les placeholders Risques, DDR et Déclarations par les vues de benchmark, C5, données/preuves, critères, mesures, revue et préparation.
- Afficher en permanence les sources, dates et limites; séparer visuellement risque fournisseur, benchmark et appréciation du lot.
- Corriger le dashboard pour exposer des compteurs réels sans employer « conformité globale » tant qu’un indicateur n’a pas une définition défendable; afficher « Préparé pour déclaration » distinctement.

### Étape 4 — Préremplissage et export manuel

- Première version sans transmission machine-à-machine. Préparer les informations destinées à la saisie manuelle et les pièces internes, en précisant le type de dossier et les champs manquants.
- Tout format de fichier dit « officiel », XML d’API, authentification, cycle de vie, statut de traitement ou mapping de réponse demeure exclu jusqu’à la lecture de la spécification CIRCABC actuelle et à la validation sur Acceptance. Le GeoJSON des coordonnées ne sera généré comme fichier d’import que selon la description officielle applicable.
- Ne pas inscrire de référence `GFT-…` comme référence officielle et ne pas afficher « Déclaré » à la suite d’un export. En cas de future saisie manuelle d’une référence externe, elle reste explicitement non vérifiée.

### Étape 5 — Tests, revue de sécurité et validation

- Tests unitaires des versions/effectivités de référentiels, voies Article 13 et Article 4 bis, données obligatoires, seuil d’état, révocation/réouverture et historique.
- Tests d’API de bout en bout pour isolation multi-tenant, rôles, accès fournisseur, association de preuves, journalisation user/action/date/object/previous/new/IP, et non-fuite des géométries.
- Cas métier : plusieurs parcelles/origines, mélange/chaîne complexe, origine inconnue, données manquantes, benchmark `LOW/STANDARD/HIGH`, signal C5/absence de signal/indisponibilité, demande d’atténuation, changement de règle après date d’effet, déclaration simplifiée admissible/inadmissible.
- Compilation hors ligne de la migration, tests sur base locale PostgreSQL, puis éventuel test sur branche Neon enfant après accord; aucun essai sur serveur Production EUDR-IS ni sur Neon `production` dans cette étape.
- Revue par une personne conformité/juridique du wording, des listes et cas limites; l’acceptation applicative ne sera pas présentée comme certification légale.

## 7. Critères d’acceptation proposés

1. Le référentiel de produits couvre la version d’Annexe I applicable à la date considérée, y compris exclusions, codes « ex » et entrées différées; la version source est visible dans le dossier.
2. Le benchmark est identique à la source officielle versionnée; aucun résultat par boîte englobante ou note pays statique héritée de l’application historique.
3. Un dossier distingue explicitement benchmark, C5, fournisseur et risque produit/lot; aucun de ces signaux ne crée seul un verdict de conformité.
4. Chaque conclusion et chaque atténuation est motivée, datée, attribuée et reliée aux preuves retenues; le décideur humain peut consulter les versions antérieures.
5. Le modèle sait distinguer rôle amont/aval/commerçant/premier aval/représentant et les deux régimes simplifiés; il ne se base jamais sur un rôle RBAC ou un plan tarifaire pour qualifier l’entité.
6. Un dossier incomplet, une origine manquante, une source non évaluable ou un risque non résolu ne peut pas atteindre « Préparé pour déclaration ».
7. La première version ne soumet rien à l’EUDR-IS, n’invente aucun format et n’affiche jamais « Déclaré »; les exports internes ne sont pas présentés comme des retours officiels.
8. Toutes les nouvelles données sont strictement tenant-scopées, les géométries restent protégées, et les actions critiques figurent dans l’audit trail avec les champs exigés.
9. Les migrations sont additives, les tests nouveaux couvrent le périmètre ci-dessus et aucune écriture sur `production` ni modification du projet historique à la racine n’a lieu.

## 8. Bloquants et risques à lever

- **Documentation API CIRCABC non récupérée dans cette session.** Le contenu de la référence API et son numéro de version, son authentification, ses schémas, ses réponses et son cycle de vie restent inconnus. C’est un blocage pour un connecteur, pas pour un parcours manuel assisté.
- **Interprétation des codes et exclusions de l’Annexe I.** Les entrées « ex », les espèces et conditions d’usage nécessitent un moteur de règles versionné et une revue métier/juridique; une simple correspondance code SH ne suffit pas toujours.
- **Qualification économique.** La taille au sens de la directive comptable, le statut d’opérateur primaire, les rôles combinés et les acteurs non-UE ne doivent pas être déduits automatiquement des données SaaS.
- **Donnée géographique sensible.** Le journal d’audit actuel reproduit la géométrie; les permissions, exportations et conservation doivent rester strictement limitées et auditées.
- **Référentiel dynamique.** Recontrôler benchmark, Annex I, FAQ et guides officiels au démarrage de l’implémentation, notamment les dates d’effet et mises à jour EUDR-IS.
- **Application historique.** Ses sorties `VERIFIED_COMPLIANT` et XML TRACES ne sont pas validées; ne pas les importer dans les dossiers de la nouvelle application.

## 9. Sources officielles consultées

- [Règlement (UE) 2023/1115 consolidé au 26 décembre 2025 (FR)](https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:02023R1115-20251226)
- [Règlement (UE) 2025/2650](https://eur-lex.europa.eu/eli/reg/2025/2650/oj/eng)
- [Orientations de la Commission C/2026/3896](https://eur-lex.europa.eu/eli/C/2026/3896/oj/eng)
- [Règlement d’exécution (UE) 2025/1093 — benchmark pays](https://eur-lex.europa.eu/eli/reg_impl/2025/1093/oj/eng)
- [Liste officielle de classification des pays — Commission européenne](https://green-forum.ec.europa.eu/countries-and-partnerships/country-classification-list_en)
- [Règlement délégué (UE) 2026/2102 — Annexe I](https://eur-lex.europa.eu/eli/reg_del/2026/2102/oj/eng)
- [Règlement d’exécution (UE) 2026/1565 — Information System](https://eur-lex.europa.eu/eli/reg_impl/2026/1565/oj/eng)
- [Information System EUDR — Production, Acceptance, API et documents](https://green-forum.ec.europa.eu/nature-and-biodiversity/deforestation-regulation-implementation/information-system-deforestation-regulation_en)
- [Rôles et responsabilités EUDR — Commission européenne](https://green-forum.ec.europa.eu/nature-and-biodiversity/deforestation-regulation-implementation/roles-and-responsibilities_en)
- [Comprendre la diligence raisonnée — Commission européenne](https://green-forum.ec.europa.eu/nature-and-biodiversity/deforestation-regulation-implementation/understand-due-diligence_en)
- [Dossier officiel CIRCABC des références API EUDR-IS — accès direct essayé, contenu technique non récupéré](https://circabc.europa.eu/ui/group/34861680-e799-4d7c-bbad-da83c45da458/library/3819b9e2-b889-4714-9bb3-b4dde1ebe649?p=1&n=10&sort=modified_DESC)

## 10. Rapport d’implémentation et de validation

### FAIT

- Ajout d’un dossier DDR tenant-scopé par lot, avec origines séparées, benchmark pays versionné, candidats Annex I avec qualificatifs/dates d’effet, constats Article 10, preuves C7 versionnées, mesures Article 11 et décisions humaines immuables.
- Ajout de la migration additive `20260927_0003_risk_ddr.py`, du routeur API et des services d’invalidation des préparations/décisions après modification des lots, produits, fournisseurs ou parcelles.
- Création/remplacement des interfaces `/risks`, `/dds` et `/declarations`; les états et exports restent internes, sans API ni format officiel EUDR-IS.
- Protection de la géolocalisation : rôles lecteur restreints reçoivent des parcelles expurgées; l’export de géodonnées est réservé à admin/conformité, journalisé avec IP et empreinte, et refusé si la préparation est obsolète. La suppression d’une parcelle liée à un dossier est bloquée avec un 409 explicite.
- Le benchmark pays et le catalogue de produits sont fournis comme références versionnées, avec avertissements que les candidats ne sont pas une décision de périmètre.

### NON FAIT / LIMITES DE PÉRIMÈTRE

- Pas de connecteur, authentification, format d’échange ou dépôt à l’EUDR Information System : la spécification CIRCABC n’a pas été récupérée. Aucun statut « Déclaré » n’est produit.
- La déclaration simplifiée distincte de l’article 4 bis, son admissibilité des opérateurs primaires et le rapport annuel de système Article 12 ne sont pas modélisés. La route implémentée est l’évaluation complète ou la diligence simplifiée Article 13; cette dernière demeure une appréciation humaine.
- Les rôles économiques et la taille sont représentés par un profil réduit au dossier; la preuve réglementaire de taille, les rôles combinés et le statut de premier opérateur aval/représentant autorisé nécessitent une qualification métier complémentaire.
- Les résultats C5 ne sont pas automatiquement attachés aux constats DDR; leur ajout comme preuve reste manuel. Les compteurs dashboard/rapports n’ont pas été adaptés à ce chantier.
- La validation sur branche Neon enfant n’a pas été exécutée; seule la compilation hors ligne Alembic et la base SQLite de tests ont été utilisées.

### TESTS / VALIDATION EXÉCUTÉS

- Backend : **113 tests passés**, y compris isolation tenant, rôles, benchmark/candidats Annex I, création/qualification Article 13, blocage d’une décision prématurée, cycle complet de décision humaine et préparation interne, invalidation, contrôle d’export et redaction géographique.
- Migration : montée/descente et génération PostgreSQL compilées hors ligne dans les tests. **Aucune migration appliquée à une base réelle.**
- Frontend : `npm test` **1 test passé**; `npm run typecheck` réussi; `npm run lint` terminé avec **0 erreur et 17 avertissements** préexistants hors des nouvelles pages Risques/DDR/Déclarations; `npm run build` réussi et routes `/risks`, `/dds`, `/declarations` produites.
- `git diff --check` réussi. Aucun commit/push; application historique et `.gitignore` racine inchangés. L’exception ciblée `agent-work/chantiers-c1-c5/.gitignore` rend versionnables les sources sous `frontend/src/lib/`, auparavant masquées par la règle générique `lib/`.

### PROBLÈMES / AVERTISSEMENTS NON BLOQUANTS

- Next.js a détecté le lockfile du projet historique à la racine et celui du frontend imbriqué; il a choisi le lockfile racine pour déterminer le workspace. La compilation reste réussie, mais `turbopack.root` peut être fixé pour supprimer cet avertissement.
- ESLint signale 17 avertissements existants dans configuration, dashboard, analyse, audit log, alertes, contexte auth et helpers historiques. Aucun échec lint.
- Pytest termine avec 324 avertissements de dépréciation/configuration, principalement `datetime.utcnow()` dans la dépendance JWT, la version Argon2 et la portée de fixture `pytest-asyncio`; les tests passent. À traiter lors d’une mise à jour dépendances.
- La trace IP d’audit utilise l’adresse peer directe `request.client.host`; derrière un proxy de production, la configuration d’en-têtes proxy devra être auditée sans faire confiance à des en-têtes client arbitraires.

### RISQUES

- Ce résultat est une aide de gestion et de préparation interne, pas une certification juridique ni une garantie de conformité. Les codes « ex », les exclusions, les critères d’acteur et toute conclusion doivent être revus par la conformité/juridique.
- Le benchmark et l’Annexe I sont figés dans la version de code indiquée; recontrôler les sources officielles et faire revoir les listes avant un déploiement métier.
- Les géodonnées demeurent sensibles dans la base et le journal d’audit. L’accès applicatif a été restreint, mais la conservation, les permissions d’infrastructure et la politique de rétention doivent être confirmées.

### PROCHAINE ÉTAPE

1. Faire relire par conformité/juridique les critères, textes affichés, catalogue Annex I, classification pays et règles de préparation.
2. Valider avec le métier le modèle complet de rôles/tailles et décider du périmètre Article 4 bis et Article 12.
3. Si requis, récupérer puis auditer la spécification CIRCABC officielle avant toute conception de connecteur.
4. Après approbation et avec une configuration sécurisée déjà disponible, appliquer la migration sur une base de test isolée/branche Neon enfant; ne pas toucher à `production`.
5. Corriger les avertissements de lint/build selon priorité avant déploiement, puis refaire la suite complète sur le commit candidat.

---

**Décision de périmètre :** le plan initial a été explicitement validé par l’instruction « réalise et valide le chantier risques-DDR ». Le compte-rendu ci-dessus distingue les éléments livrés de ceux qui restent volontairement ou techniquement non faits.
