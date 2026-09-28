# Chantier 3 — livraison parcelles et géolocalisation

**28 septembre 2026 · GeoForest Trace 0.4.0 · migration 0003**
Branche : `chantier-3/parcelles-geolocalisation`
**Statut : PRÊT pour validation fonctionnelle locale du périmètre chantier 3, pas pour lancement en production.**

Le chantier demandé est implémenté et recetté. Le [point d’avancement initial](03-chantier-3-avancement.md) reste une archive du premier incrément ; ses éléments « non faits » ne décrivent plus cette livraison. **Aucun chantier 4 commencé ; nouveau GO obligatoire.**

## 1. FAIT

| Domaine | Livraison et garde-fous |
|---|---|
| Référentiel parcellaire | Fournisseur, référence, pays/matière déclarés, géométrie, surface déclarée et calculée distinctes, méthode/source/précision/date ; création, modification, archivage |
| Versions et provenance | Géolocalisations append-only pour le runtime ; consultation des anciennes révisions, acteur, date, analyse et origine |
| Lots | Association à une révision explicite, mêmes tenant/fournisseur garantis par clés composites ; modifier une parcelle ne réécrit pas un lot |
| Carte privée | Leaflet embarqué, navigation, sélection, emprise, points/contours, poignées ; aucune requête de tuiles ou CDN |
| Saisie et GPS | Longitude/latitude manuelles, dessin, GeoJSON ; GPS sur action explicite, date et précision annoncée, refus et indisponibilité gérés |
| Imports | GeoJSON/KML texte, aperçu/carte/erreurs/avertissements, confirmation, transaction atomique, replay sans doublons ; source brute privée et empreinte conservées |
| Contrôles | Structure/bornes/topologie, surfaces sphéroïdales PostGIS, simulation séparée de troncature à six décimales, trous/seuil conditionnel de surface ; pas de réparation silencieuse |
| Relations spatiales | Doublon, chevauchement et intersection dans le seul périmètre autorisé, résultats bornés et troncature signalée ; aucun verdict de fraude ou déforestation |
| Portail fournisseur | Proposition distincte de la collecte initiale, brouillon, transmission immuable, corrections et resoumission ; aucune écriture directe dans le référentiel entreprise |
| Revue entreprise | Admin/Compliance Manager, note, version et confirmation explicite côté API ; adoption créant une nouvelle parcelle, sans écrasement ni lien lot automatique |
| Sécurité | RLS sur six nouvelles tables, rôle runtime non propriétaire/NOBYPASSRLS, CSRF/Origin, limites ciblées, XML sans réseau/entités, permissions et isolation fournisseur/tenant |
| Documentation | ADR, vérification réglementaire ciblée, guide utilisateur, sécurité/exploitation, OpenAPI et preuves actualisées |

### Carte sans fond externe : décision explicite de confidentialité

La carte affiche les géométries sur une **grille décorative**, sans fond géographique/cadastral. Ce n’est pas une carte satellite ni une graduation géographique. La fonctionnalité de navigation/dessin est réelle ; un fond géographique nécessitera une activation et un fournisseur qualifié séparés. Aucun abonnement ou transfert de coordonnées vers un service cartographique tiers n’a été activé.

### Parcelles et conformité restent distinctes

Les documents officiels ont été consultés avant l’implémentation des avertissements : [vérification et sources](../reglementation/03-geolocalisation-verification.md). Le seuil conditionnel est **plus de 4 ha hors bovins**, pas « au moins 4 ha ». Une surface inconnue n’est jamais remplacée par 4 ha. La transformation à six décimales n’écrase pas la géométrie source.

Le validateur initial, historisé sous `plots-v1-draft`, est une règle technique non homologuée pour un échange officiel. Aucun test dans TRACES/IS ni acceptation par une autorité n’est prétendu réalisé.

## 2. TESTS EXÉCUTÉS

| Contrôle | Résultat final | Preuve |
|---|---|---|
| Backend complet, PostgreSQL/PostGIS réels | **152 réussis**, 1 avertissement de dépréciation TestClient/httpx | [pytest.txt](preuves-chantier-3/pytest.txt) |
| Ruff + format | Réussis | [ruff.txt](preuves-chantier-3/ruff.txt) |
| TypeScript / ESLint | Réussis | [types.txt](preuves-chantier-3/types.txt), [lint.txt](preuves-chantier-3/lint.txt) |
| Build Next standalone 0.4.0 | Réussi | [build.txt](preuves-chantier-3/build.txt) |
| Navigateur Chromium, vrai Keycloak, API et DB | **5 parcours réussis, aucun ignoré** | [e2e.txt](preuves-chantier-3/e2e.txt) |
| Audit dépendances npm | Aucun avis détecté | [npm-audit.txt](preuves-chantier-3/npm-audit.txt) |
| Audit versions Python épinglées | Aucun avis connu détecté, mode sans résolution pip | [pip-audit.txt](preuves-chantier-3/pip-audit.txt) |
| Migration 0002 peuplée → 0003, puis répétition | Réussie ; payload du lot existant inchangé ; six tables RLS | [migration.txt](preuves-chantier-3/migration.txt) |
| Sauvegarde / restauration isolée | Comptages et empreintes identiques, RLS et privilèges vérifiés, sessions restaurées révoquées | [restauration.txt](preuves-chantier-3/restauration.txt) |
| Readiness API | `0003`, PostGIS disponible | [readiness.json](preuves-chantier-3/readiness.json) |
| Scan ciblé de secrets | Pas de PAT/clé privée ou secrets privés courants détectés dans les fichiers candidats ; pas de dotenv à la racine du standalone | [secrets.txt](preuves-chantier-3/secrets.txt) |

### Ce que couvre la recette

- Géométries vides/corrompues/non finies, budgets, anneaux ouverts, auto-intersections, trous et multipolygones, petites/grandes surfaces, antiméridien, seuil exact de 4 ha, troncature pouvant invalider une forme.
- Imports hostiles et paramètres invalides ; aperçu, source privée, conflits, replay, rollback atomique et limites HTTP ciblées.
- CRUD et historique, contrôle de version, immutabilité runtime, cohérence des relations, lien lot conservé sur v1 après passage de la parcelle à v2.
- Rôles, isolation d’organisations et de fournisseurs, absence de fuite spatiale inter-tenant, CSRF, métadonnées GPS, révocation portail.
- Navigation/dessin/import entreprise ; acquisition GPS **simulée explicitement**, refus de permission simulé ; proposition mobile, correction, resoumission et adoption humaine ; GeoJSON corrompu et changement de saisie sans plantage.
- Responsive : 1440 px desktop, 768/390/360 px entreprise et 390/360 px portail ; absence de débordement horizontal vérifiée. Pas d’erreur JavaScript ni requête externe dans le parcours parcellaire instrumenté.
- Non-régression connexion/organisations et collecte fournisseurs/produits/lots, vrai OIDC. Il ne s’agit pas de mocks de l’authentification ou de la base.

### Conditions exactes

La recette navigateur utilise une passerelle TLS **locale** et la résolution du hostname de test vers cette passerelle. Elle ne prouve pas l’accès via le proxy public de la sandbox : l’essai externe sans mécanisme d’accès de la plateforme retourne HTTP 403. L’ouverture publique reste à qualifier.

Le quota réel de 120 requêtes/minute par pair réseau n’a pas été augmenté. Les suites denses partageant le proxy local ont rencontré le limiteur ; `E2E_RATE_PACE=1` ménage une fenêtre de 65 secondes avant la collecte. Les répétitions ont aussi atteint le quota d’organisations : nettoyage ciblé de fixtures synthétiques identifiées, puis dernière recette sur la base dédiée `geoforest_acceptance`. Aucun nettoyage de données de production.

L’audit Python standard a expiré lors d’une résolution réseau PyPI. Le contrôle final utilise `pip-audit --disable-pip --no-deps -r backend/requirements.lock`, avec versions transitives épinglées. Il ne faut pas le présenter comme une nouvelle résolution des dépendances ou un audit des images Docker.

### Corrections issues de la recette

- Erreur de sérialisation UUID dans une réponse d’avertissement HTTP 409.
- Priorité des routes d’archivage pour éviter l’interception par la route générique approvisionnement.
- Saisie de coordonnées négatives/décimales, synchronisation de la saisie GeoJSON et maintien de la zone d’édition ouverte.
- Dessin et édition protégés contre les géométries de brouillon corrompues.
- Cadrage après import et à l’ouverture d’une carte repliée ; filtre d’emprise testé sur les géométries réellement visibles.
- Rafraîchissement du portail : ne pas proposer de confirmer une ancienne version pendant le chargement de la proposition modifiée.
- Provenance du fichier source affichée selon la révision consultée, pas seulement selon la révision courante.

## 3. BASES ET MIGRATIONS : état réel

**0003 appliquée aux bases synthétiques locales, pas à une production.**

- `geoforest_test` : pytest destructif sur fixtures uniquement.
- `geoforest` : première recette navigateur synthétique, montée jusqu’à 0003.
- `geoforest_acceptance` : base dédiée de la recette navigateur finale, chaîne vierge jusqu’à 0003 puis répétition de `upgrade head` ; runtime de démonstration configuré sur cette base.
- `geoforest_upgrade_test` : exercice 0002 peuplée → 0003 ; lot d’avant migration inchangé.
- `geoforest_restore_test` : restauration isolée d’un instantané synthétique, pas du dernier état de chaque base après toutes les répétitions.

La restauration contrôlée contenait **12 parcelles, 17 révisions géographiques, 5 liens de lots, 5 imports, 2 propositions et 4 snapshots transmis**. Les empreintes EWKB/payload/analyses, sources d’import et snapshots sont identiques à l’instantané source. Zéro géométrie invalide ; zéro parcelle/révision visible sans contexte runtime ; UPDATE des révisions et DELETE des sources non accordés. Sessions OIDC et portail restaurées révoquées.

Les premières restaurations ont révélé les permissions d’extension/COPY PostGIS ; la procédure corrigée est dans [Sécurité et exploitation](../SECURITE_ET_EXPLOITATION.md). Les commentaires DB ne sont pas restaurés par la variante testée. Aucun downgrade destructif, `push --force` de schéma, effacement d’une base réelle ou migration de production.

## 4. LIMITES / NON FAIT

| Statut | Élément |
|---|---|
| **À FINALISER avant production** | Hébergement/proxy/TLS, MFA IdP réelle, secrets de production, sauvegardes chiffrées et RPO/RTO, observabilité, accessibilité complète, scans d’images, Docker/CI distante et tests de charge |
| **BLOQUÉ — publication Git du chantier 3** | Travail finalisé localement sur sa branche. Aucun mécanisme GitHub authentifié disponible ; anciens tokens exposés non réutilisés. Authentification sécurisée à fournir hors chat pour le push. |
| **À QUALIFIER — accès externe** | Proxy public sandbox renvoie 403 sans mécanisme d’accès plateforme ; recette TLS locale concluante, pas de disponibilité publique garantie |
| **RISQUE RÉGLEMENTAIRE** | Géométrie valide ≠ lieu réel/propriété/légalité/absence de déforestation. Produit, acteur, régime applicable, exhaustivité des établissements/parcelles et futur échange officiel restent à qualifier. |
| **PROCHAINE VERSION / choix distinct** | Fond cartographique tiers ou auto-hébergé, SHP/KMZ, édition graphique avancée des trous/multipolygones, antiméridien/pôles, industrialisation des grands volumes |
| **CHANTIERS SUIVANTS NON ENGAGÉS** | Sources GIS qualifiées, déforestation, documents/légalité/risque, dossiers et exports/déclarations officiels |

Budgets actuels : source 1 Mio, 100 éléments/10 000 positions cumulées ; HTTP géographique 2 Mio ; géométrie individuelle 10 000 positions ; plafond technique 100 000 ha ; refus des polygones traversant l’antiméridien ou dépassant 85° de latitude. Pas de prétention à supporter des millions de parcelles avec la carte de cette version. La RLS ne prétend pas résister à la compromission complète du serveur ou au DBA.

## 5. GIT / LIVRABLES

- Branche finale dédiée : `chantier-3/parcelles-geolocalisation`, à partir du chantier 2, avec l’incrément `926ce76` et la finalisation de cette livraison.
- Les chantiers 1 et 2 avaient été poussés sur leurs branches ; **aucun nouveau push du chantier 3**, aucune fusion, aucun changement de `main`.
- Sources, migrations, tests, OpenAPI, guides et preuves inclus dans la livraison locale. Les captures historiques des chantiers 1/2 sont préservées ; les captures de non-régression courantes sont rangées dans `preuves-chantier-3`.
- Aucun token ou mot de passe n’est inclus dans ce rapport ou le dépôt. Le runtime sandbox et ses dépendances ne remplacent pas un déploiement durable ; les relancer selon le README après restauration de l’environnement.

### Documents et captures

- [Guide utilisateur parcelles](../GUIDE_PARCELLES.md)
- [API](../API.md) · [OpenAPI JSON](../openapi.json)
- [Architecture ADR 003](../adr/003-parcelles.md)
- [Sécurité et exploitation](../SECURITE_ET_EXPLOITATION.md)
- [Vérification réglementaire](../reglementation/03-geolocalisation-verification.md)
- [Parcelles desktop](preuves-chantier-3/parcelles-desktop.png)
- [Parcelles mobile](preuves-chantier-3/parcelles-mobile.png)
- [Proposition fournisseur mobile](preuves-chantier-3/parcelle-portail-mobile.png)

## Décision de sortie

**Chantier 3 terminé dans son périmètre fonctionnel MVP et validé localement.** La publication GitHub et la qualification de production restent distinctes et explicitement ouvertes. La prochaine action est la validation du propriétaire et la mise en place de l’accès Git sécurisé ; le chantier 4 exige ensuite un nouveau GO.
