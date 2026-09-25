# Chantier 5 — Analyse géospatiale de perte de couvert arboré

**État : ANALYSE, PLAN ET IMPLÉMENTATION LOCALE EFFECTUÉS; validation GFW live et mise en production NON FAITES.**  
**Audit et tests : 25 septembre 2026.**  
La demande « chantier 5 » a été interprétée comme un feu vert général pour implémenter le MVP; elle ne constitue pas un accord distinct de l'utilisateur sur chacun des choix méthodologiques. Ce document conserve l'audit initial et indique ci-dessous les choix effectivement mis en œuvre, les écarts et les points restant à valider.

## 1. Résumé et choix appliqués au MVP

Le MVP implémente un **dépistage géospatial d'un signal de perte de couvert arboré**, daté relativement au 31/12/2020, pour une parcelle. Il ne dit jamais « conforme EUDR » ou « déforestation confirmée » sur la seule base d'une couche satellitaire.

Les choix ci-dessous ont été appliqués comme hypothèses de travail à la suite de la demande « chantier 5 »; ils n'ont pas tous été confirmés séparément par l'utilisateur et peuvent être ajustés avant activation en production.

1. Source primaire : Global Forest Watch (GFW) Data API, jeu `umd_tree_cover_loss`, version **figée** à `v1.13` pour ce MVP, sans bascule vers des données simulées. Les appels live restent bloqués tant que clé, `GFW_LIVE_ENABLED=true` et `GFW_CONTRACT_VERIFIED=true` ne sont pas configurés; le mapping de seuil est également refusé pour une version non prise en charge.
2. Périmètre : analyse de polygones/multipolygones validés. Pour les points, aucun tampon géométrique arbitraire; résultat `non évaluable` tant qu'une méthode ponctuelle n'a pas été validée séparément.
3. Seuil temporel : l'année cartographiée **2021 ou ultérieure** déclenche un signal à examiner; 2021 est spécialement marqué « proximité de la date butoir / année incertaine ». Une perte annuelle n'établit ni la date exacte ni la conversion en usage agricole.
4. Couvert initial : le MVP utilise le seuil de couvert arboré de 10 % comme filtre de dépistage, et compare 30 % en sensibilité. Pour `v1.13`, la table officielle code ces seuils respectivement par `1` et `5`; le code utilise ces codes et refuse tout mapping d'une version non vérifiée. Les valeurs ont été vérifiées dans les métadonnées publiques, mais leur comportement n'a pas été testé par un appel live.
5. Seuil de surface : aucun seuil de perte ne servira de zone de sécurité juridique. Renvoyer la surface estimée et la fraction observée; préserver tout signal non nul interprétable. Tout seuil technique éventuel devra être documenté et validé séparément.
6. Résultat : états descriptifs (`signal_post_2020`, `aucun_signal_observé`, `non_évaluable`, `source_indisponible`) et avertissements; **pas de booléen `compliant`**, pas de score de confiance inventé, pas de certification.
7. Persistance : chaque tentative et son résultat/provenance sont stockés dans les champs `new_data`/`previous_data` du modèle `AuditEvent`, tenant-scopés et horodatés. Aucun nouveau modèle ni migration C5 n'a été ajouté; aucune migration n'a été lancée. Les éventuels changements de base hors de ce périmètre restent conditionnés à la clarification C3.

## 2. Audit de l'existant

### 2.1 Fondations disponibles

- Le chantier 4 fournit des parcelles WGS84 validées et rattachées à un lot et à une organisation, avec validation géométrique et isolation tenant.
- Le modèle `PlotStatus.analyzed` existe, mais C4 précise qu'une géométrie valide n'est pas une analyse de déforestation.
- L'API `/plots` offre CRUD et validation technique. Aucun endpoint d'analyse C5 n'a été trouvé.
- La page `/analysis` est encore un placeholder. Les anciens types frontend `SatelliteCheckResult`, `ParcelAuditResponse` et `AuditSummary` encodent notamment `compliant` et `confidence_score`; ils ne sont pas reliés à un workflow d'analyse observé.
- L'audit métier existant enregistre déjà l'acteur, l'action, la date, l'objet, les états avant/après et l'IP. Les coordonnées sont des données sensibles : toutes les nouvelles routes et requêtes devront conserver l'isolation stricte par `organization_id`.

### 2.2 Ancien service satellite — non réutilisable tel quel

`backend/app/services/satellite/satellite_checker.py` contient deux chemins qui doivent être séparés avant toute intégration :

- **Moteur déterministe de démonstration** : hotspots, fractions de perte et confiances construites par code/hash; il peut être appelé après échec du service live. Il produit donc des nombres qui ressemblent à des observations, sans en être. Un tel repli serait trompeur en production.
- **Moteur live GFW** : un signal post-2020 au-dessus d'un seuil codé `max(0,01 ha, 0,5 % de la parcelle)` devient `compliant=False`; l'absence de perte significative devient `compliant=True` et reçoit une confiance fixe de 0,95. Ni ce seuil ni cette confiance ne sont étayés comme seuils juridiques ou mesures de confiance propres à la parcelle.
- Le service transforme toute perte de couvert arboré post-2020 en non-conformité. C'est trop affirmatif : l'EUDR définit la déforestation comme conversion d'une forêt vers un usage agricole; la perte de couvert arboré peut également venir de la récolte forestière, d'un feu, d'une maladie ou d'une tempête, et peut concerner des plantations.
- Les points sont artificiellement bufferisés de `0,0005°` (environ 55 m à l'équateur); cette empreinte n'est pas issue de la géométrie déclarée et ne doit pas être traitée comme la parcelle réelle.
- Les classes pays sont résolues avec des boîtes approximatives et mélangées au résultat de perte. Elles ne doivent pas être utilisées comme substitut à l'analyse de parcelle; la classification réglementaire pays doit rester un indicateur distinct, versionné et sourcé.
- Le chemin live utilise le champ `umd_tree_cover_density_2000__threshold = 30`. La fiche officielle du champ présente des valeurs codées 1 à 7 (dont le code 5 signifie 30); la signification de la comparaison SQL actuelle n'est donc pas démontrée. L'API référence également des couches nommées par seuil (`...__10`, `...__30`, etc.). Le filtre réel devra être vérifié contre le schéma/version de données avant usage.
- Le chemin live n'a pas été appelé avec une clé de service pendant cet audit; son contrat d'exécution, son authentification, ses quotas et ses réponses réelles ne sont donc pas déclarés testés.

### 2.3 Vérification de la documentation GFW actuelle

La documentation officielle GFW Data API **0.3.0** publie bien une route `/dataset/{dataset}/{version}/query`, mais cette opération est marquée **deprecated** et annonce une réponse de redirection HTTP 308. L'opération documentée actuelle est `POST /dataset/{dataset}/{version}/query/json`; son schéma accepte une géométrie GeoJSON et une requête SQL. Le code historique vise donc une route réelle mais dépréciée — il ne faut pas la conserver comme contrat futur sans test de redirection et de compatibilité.

L'API publique consultée indique pour `umd_tree_cover_loss` :

- portée globale hors Antarctique et de certaines îles arctiques, résolution annoncée de 30 m et fréquence annuelle;
- version courante vérifiée `v1.13`, mise à jour incluant des pertes jusqu'en 2025; la réponse de cette version expose les années jusqu'à 2025;
- définition de « tree cover » incluant la végétation de plus de 5 m, qu'elle soit forêt naturelle ou plantation; la « perte » correspond à une perturbation/remplacement du couvert et peut avoir diverses causes;
- le fournisseur avertit que la perte de couvert ne signifie pas nécessairement déforestation; il recommande la prudence pour les comparaisons temporelles, car la méthode 2011–2025 a été mise à jour sans retraitement uniforme de toute l'histoire;
- la fiche rapporte, d'après l'évaluation de la publication d'origine, environ 13 % de faux positifs et 12 % de faux négatifs, avec une précision variable selon les biomes; elle indique aussi 75 % de confiance pour l'année attribuée et 97 % à ±1 an. Ces chiffres sont des limites de la source, **pas** un score de confiance calculable pour une parcelle donnée.

Ces caractéristiques en font une **source de dépistage**, pas une preuve complète de la définition EUDR. L'API n'a pas été sollicitée avec des coordonnées réelles pendant l'audit.

## 3. Références vérifiables et limites d'interprétation

1. [Règlement (UE) 2023/1115, version consolidée consultée au 26/12/2025](https://eur-lex.europa.eu/eli/reg/2023/1115/2025-12-26/eng), notamment art. 2(3), 2(4), 2(13), 3 et 9(1)(d) : date butoir du 31/12/2020; définition de la forêt et de la déforestation; géolocalisation des parcelles. Revalidation juridique requise avant tout gel de règles de conformité.
2. [Règlement d'exécution (UE) 2025/1093](https://eur-lex.europa.eu/eli/reg_impl/2025/1093/oj/eng) : classification des pays EUDR à faible/risque élevé; Belarus, Corée du Nord, Myanmar et Russie sont listés « high risk », les autres pays non listés restant au niveau standard. Cette classification n'est **pas** un résultat satellite parcellaire et devra être gérée séparément si elle est conservée.
3. [Documentation officielle GFW Data API / OpenAPI](https://data-api.globalforestwatch.org/) et [spécification OpenAPI JSON](https://data-api.globalforestwatch.org/openapi.json) : opérations, versions, schémas et dépréciation des routes.
4. [Métadonnées GFW — `umd_tree_cover_loss`](https://data-api.globalforestwatch.org/dataset/umd_tree_cover_loss), [version `v1.13`](https://data-api.globalforestwatch.org/dataset/umd_tree_cover_loss/v1.13) et [champs de `v1.13`](https://data-api.globalforestwatch.org/dataset/umd_tree_cover_loss/v1.13/fields) : version, résolution, couverture, période, champs, limites, licence et codage des valeurs. Les réponses de ces pages sont des métadonnées dynamiques; archiver les valeurs effectivement utilisées dans chaque analyse.
5. Le dépôt C4 (`CHANTIER_4.md`) et les fichiers audités cités ci-dessus constituent la référence d'implémentation locale.

**Conséquence centrale :** `année de perte de couvert arboré > 2020` est un signal géospatial à examiner, pas la preuve qu'une forêt EUDR a été convertie en usage agricole ni une conclusion juridique absolue. Le jeu ne contrôle pas à lui seul la légalité, l'usage agricole réel, la qualification de forêt et la dégradation forestière EUDR (notamment les critères spécifiques au bois).

## 4. Plan d'implémentation et état d'exécution

Les phases ci-dessous ont guidé le MVP local. Les contrats documentaires, garde-fous, routes, persistance d'audit et interface sont implémentés; la validation du contrat GFW avec une clé autorisée et une géométrie de test reste NON FAITE. Voir le rapport réel en §7.

### Phase A — contrat source et décision géométrique

1. Vérifier le schéma officiel, la version/dataset, la clé et l'authentification serveur, les réponses réelles et le champ de couvert arboré; utiliser `query/json` et une version explicitement enregistrée (pas une version silencieusement mouvante `latest`).
2. Tester uniquement avec une géométrie publique de démonstration ou synthétique et une clé de service autorisée; ne pas transmettre de parcelle producteur avant validation sécurité/confidentialité.
3. Mesurer la réponse pour polygone, multipolygone et point. Tant que le résultat d'un point n'est pas interprétable, le refuser comme `non_évaluable` sans tampon implicite.
4. Si l'API n'est pas disponible ou si la réponse est invalide, renvoyer `source_indisponible`/échec traçable; ne jamais retourner les valeurs du moteur mock.

### Phase B — modèle de dépistage explicable

1. Remplacer le contrat `compliant`/`confidence_score` par un résultat descriptif, par exemple :
   - `screening_status`: `signal_post_2020`, `aucun_signal_observe`, `non_evaluable` ou `source_indisponible`;
   - `review_required: true` dès qu'un signal ou une incertitude doit être examiné;
   - périodes et agrégats séparés : pertes cartographiées jusqu'en 2020 et à partir de 2021, surface intersectée estimée (ha), part de la parcelle et, si fiable, nombre de pixels;
   - géométrie analysée (référence/hash), version dataset, date de requête, résolution, filtre canopy, emprise/couverture retournée, date butoir appliquée, provenance, limites et erreurs;
   - aucune probabilité maison ni résultat binaire de conformité.
2. Méthode temporelle initiale : comparer l'année raster à 2020; isoler 2021 comme signal proche de la date butoir avec incertitude temporelle; afficher 2022+ comme signal annuel postérieur plus éloigné du seuil, tout en exigeant une revue humaine. Ne pas transformer l'année raster en date exacte.
3. Filtre canopy : évaluer 10 % comme dépistage large et 30 % comme analyse de sensibilité; figer seulement après validation de la sémantique des couches. Aucun niveau de canopy ne constitue à lui seul la définition réglementaire de « forêt ».
4. Seuil de perte : ne pas appliquer le seuil historique de 0,5 %/0,01 ha comme « tolérance ». Conserver les intersections détectées et exposer la résolution/erreur. Si un seuil anti-bruit est démontré nécessaire par les essais, l'afficher comme paramètre technique versionné; il ne peut jamais transformer « signal sous seuil » en « conforme ».
5. Stocker un résultat d'analyse versionné plutôt que d'écraser une conclusion précédente. Un changement de géométrie rend l'analyse précédente obsolète pour l'état courant, sans l'effacer de l'historique.

### Phase C — intégration métier et interface

1. Ajouter des opérations dédiées à l'analyse d'une parcelle et à la consultation de son historique; vérifier le tenant sur chaque chargement et mutation.
2. Persister au minimum l'acteur, l'horodatage, l'organisation, l'identifiant de parcelle, la version de géométrie, la source/version de données, les paramètres/méthode, le résultat, l'état (succès/échec) et le détail d'erreur non sensible.
3. Ajouter un événement `plot.deforestation_screened` (ou équivalent) au journal d'audit avec `actor/action/date/object/previous/new/IP`, sans secret API. Contrôler l'accès aux résultats comme aux coordonnées.
4. L'interface doit afficher la formulation : **« Signal de perte de couvert arboré — revue humaine requise; ce résultat n'est pas une certification EUDR. »** Distinguer visuellement absence de signal, signal observé, données incomplètes et fournisseur indisponible. Ne jamais afficher « conforme » à la suite d'une réponse vide.
5. Ne pas faire passer automatiquement un lot au statut « analysé », « prêt » ou « déclaré » sur la seule base de cette couche. « Préparé pour déclaration » et « Déclaré » restent des états distincts.

### Phase D — persistance et migration

L'implémentation actuelle réutilise `AuditEvent` pour l'historique des dépistages; aucun nouveau modèle, table ou migration C5 n'est nécessaire dans ce périmètre. La base cible C3 n'a pas été identifiée et aucune migration n'a été exécutée. Si un stockage dédié est demandé ultérieurement, la baseline et le scénario de base cible devront être clarifiés avant de générer/appliquer une migration.

## 5. Tests et critères d'acceptation proposés

### Tests fonctionnels et scientifiques

- frontière temporelle exacte : 2020 n'est pas classé post-cutoff; 2021 déclenche un avertissement de proximité/incertitude; années ultérieures restent des signaux à examiner;
- réponse vide et absence de perte significative : jamais `compliant=true`; états distincts de l'échec fournisseur et des données incomplètes;
- calcul de l'intersection, surface et fraction sur fixtures synthétiques connues; limites de pixels, géométries partielles et couverture hors domaine;
- comparaison/sensibilité des filtres canopy 10 % et 30 %; validation de la signification exacte des champs GFW et de la conversion pixels→ha;
- géométries invalides refusées; points non bufferisés; tests d'anti-méridien/limites et multipolygones si supportés;
- mises à jour de parcelle : résultat antérieur conservé mais marqué obsolète pour la géométrie modifiée.

### Tests intégration, sécurité et résilience

- succès GFW avec réponses conformes au schéma; version source persistée;
- route dépréciée/308, clé invalide, 401/403, 429, timeout, 5xx, JSON invalide et champ inconnu; aucun repli simulé;
- absence de fuite de clé dans logs, réponse, audit ou frontend;
- tests inter-tenant (lecture/écriture/historique : ressource d'un autre tenant inaccessible), rôles, audit trail complet et accès à l'IP;
- aucun envoi de géométrie au frontend vers GFW; appel backend uniquement;
- tests backend C5 + suite backend complète, build/typecheck frontend, puis test/migration PostgreSQL uniquement sur une base de test contrôlée.

### Critères de sortie C5

- le service ne présente aucune donnée synthétique comme observation réelle et ne produit pas de verdict juridique automatique;
- la provenance, les paramètres, l'incertitude et la version des données sont visibles et persistés;
- les résultats « aucun signal », « signal », « non évaluable » et « fournisseur indisponible » sont distincts;
- isolation tenant et audit événementiel vérifiés;
- seuils et champ canopy testés; limites 30 m / annuel / version historique affichées;
- tests et typage/build passent; toute migration est validée sur une base explicitement identifiée avant déploiement.

## 6. Risques et points à confirmer

| Point | Évaluation | Traitement proposé |
|---|---|---|
| GFW compare perte arborée et déforestation EUDR | Risque majeur de faux verdict | Sortie signal seulement; revue humaine; wording explicite |
| Période annuelle et seuil 31/12/2020 | 2021 peut chevaucher la frontière temporelle réelle | Marqueur proche-seuil; ne pas prétendre connaître le jour exact |
| Couvert 30 m, erreurs et biomes | Faux positifs/négatifs, mise à jour historique non homogène | Source/version, résolution, limites visibles; tests de sensibilité |
| API actuelle | Route `/query/json` implémentée; aucune requête live/clé exécutée et la forme réelle de la réponse n'est pas validée | Clé autorisée + géométrie synthétique en environnement non-production; ne lever les deux drapeaux live qu'après validation |
| Géométries ponctuelles | Surface/voisinage non déductible d'un point seul | Pas de buffer arbitraire; `non_évaluable` jusqu'à protocole validé |
| Multi-tenant / données sensibles | Coordonnées producteur très sensibles | Appels serveur uniquement; contrôle tenant et audit complet |
| Base de données | Pas de modèle/table C5 ajouté; historique stocké dans `AuditEvent`. La base cible C3 reste inconnue | Aucune migration C5 nécessaire ni exécutée; clarifier C3 avant tout changement de schéma futur |
| Classification des pays | Source officielle distincte de la perte de parcelle | Ne pas intégrer au score de parcelle; revérifier la liste réglementaire avant tout usage |

## 7. Rapport d'état — 25 septembre 2026

- **FAIT :** service backend C5 sans repli simulé; route documentée GFW `POST /dataset/umd_tree_cover_loss/v1.13/query/json`, redirections refusées; seuils v1.13 corrigés et versionnés (`10 % → code 1`, `30 % → code 5`, vérifié dans les métadonnées publiques); appels live bloqués derrière clé + `GFW_LIVE_ENABLED` + `GFW_CONTRACT_VERIFIED`; routes candidats/lancement/historique tenant-scopées; résultat et historique tracés via `AuditEvent`; aucune géométrie renvoyée à l'interface; points non bufferisés; valeurs des surfaces `null` lorsque la source ne fournit aucune mesure; interface C5 descriptive, sans verdict juridique et sans affichage de faux zéros en indisponibilité; exemples d'environnement et Docker Compose documentés. Un CLI de probe isolé, `backend/scripts/probe_gfw_contract.py`, permet un test ultérieur sur polygone synthétique sans ouvrir les routes live de l'application.
- **FAIT — TESTS :** 14 tests C5 passent; suite backend complète : **85 réussites, 0 échec** (`GFW_LIVE_ENABLED=false`); frontend `npm run typecheck` et `npm run build` passent. Les tests backend émettent des avertissements de dépréciation existants (JWT `datetime.utcnow`, réglage de portée des fixtures pytest et passlib), sans échec.
- **NON FAIT :** aucun appel GFW live, aucune vérification réelle avec clé, aucune validation de la forme/unité exacte des réponses et des quotas; aucun test sur des coordonnées de producteur; aucune migration ni test d'une base de production; aucun déploiement. Les flags live sont désactivés dans les exemples (`GFW_LIVE_ENABLED=false`, `GFW_CONTRACT_VERIFIED=false`).
- **PROBLÈMES / LIMITES :** l'implémentation du contrat est vérifiée par tests simulant le fournisseur, pas par un échange réel; la table des seuils est confirmée par métadonnées, pas par requête live. Les surfaces fournies en production restent à comparer à un cas de référence avant activation.
- **RISQUES :** perte de couvert ≠ déforestation EUDR; résolution annuelle de 30 m, erreurs et année de 2021 incertaine; version méthodologique hétérogène. L'activation exige une clé autorisée, un test non-production sur géométrie synthétique et une validation explicite du contrat. `GFW_CONTRACT_VERIFIED=true` ne doit être défini qu'après cette validation.
- **PROCHAINE ÉTAPE :** injecter une clé autorisée via un gestionnaire de secrets en environnement non-production, puis lancer depuis `backend/` `python scripts/probe_gfw_contract.py --confirm-synthetic-polygon` avec `ENVIRONMENT=test` et `GFW_LIVE_TEST_ENABLED=true`. Le probe exige que les deux flags de l'application restent désactivés et utilise uniquement un polygone synthétique fixe. Vérifier/documenter réponse, années, unités, surfaces, quota et erreurs; le probe seul ne valide pas la précision scientifique. Ensuite seulement décider de lever les garde-fous live et confirmer les choix méthodologiques avec l'utilisateur; ne pas lancer de migration sans nécessité et sans base cible explicitement identifiée.
