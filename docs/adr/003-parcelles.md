# ADR 003 — Parcelles, carte et géolocalisation

Statut : **chantier 3 en cours ; premier incrément technique testé, pas encore intégré à l’application**. Base : `a924ba8` ; branche `chantier-3/parcelles-geolocalisation`. Les chantiers 1 et 2 ont été poussés sur leurs branches dédiées ; `main` est inchangée.

## Objectifs

1. Référentiel parcellaire lié au fournisseur et aux lots, tenanté, versionné et audité.
2. Carte de consultation et dessin avec coordonnées manuelles ; GPS sur action explicite, sans suivi permanent.
3. Imports GeoJSON et KML avec prévisualisation, provenance et confirmation transactionnelle.
4. Contrôles PostGIS de validité et de surface ; doublons/chevauchements expliqués, jamais verdicts de fraude ou déforestation.
5. Collecte géographique du fournisseur séparée du canonique et soumise à revue humaine.

Les résultats de la vérification officielle sont consignés dans `docs/reglementation/03-geolocalisation-verification.md`.

## Fond de carte : confidentialité par défaut

Le choix interactif a été passé. Décision de repli : **aucune requête cartographique externe par défaut**. Il ne s’agit pas d’un consentement à un fournisseur public.

- Option pilote future, sur activation explicite : fond public OpenStreetMap activé explicitement, attribution et politique de tuiles respectées, aucune prélecture hors ligne ; information préalable sur l’IP et les zones affichées. Pas de SLA, pas d’adéquation présumée à une production à grande échelle.
- Option confidentialité stricte : aucune requête de tuiles à un service public ; navigation/grille et géométries fonctionnent sans fond. Un fournisseur contractuel ou un service auto-hébergé devra être configuré pour ajouter un fond géographique.
- Ne pas souscrire de service payant ni transmettre de clé de fournisseur dans le chat. Configuration via environnement sécurisé si un fournisseur existe déjà.

Leaflet local au bundle reste la bibliothèque envisagée. Pas de script CDN. La CSP actuelle et Referrer-Policy=no-referrer ne sont pas compatibles telles quelles avec les tuiles publiques OSM : adapter uniquement les requêtes autorisées, ne pas affaiblir globalement la protection du portail.

## Modèle proposé

- `plots` : organisation, fournisseur, référence, nom, pays déclaré, matière déclarée, statut d’archivage, version.
- `plot_geolocations` : révisions de géométrie EPSG:4326, surface géodésique calculée quand possible, surface déclarée distincte, méthode/source/date, précision GPS si fournie, empreinte de source, auteur et limites.
- `lot_plots` : association par clés composites garantissant organisation et fournisseur cohérents, référence à la version de géolocalisation retenue pour éviter la réécriture de provenance d’un lot.
- Import batch et éléments source : aperçu validé puis application atomique/idempotente ; référence aux résultats de contrôle et version du validateur.
- Propositions portail : isolées par session/fournisseur et tenant, brouillon/soumission/revue/corrections ; pas de modification directe des parcelles de référence par le fournisseur.

La migration définitive sera écrite après fixation des contrats API. Aucune migration de ce chantier n’a été exécutée.

## Géométries et contrôles envisagés

- MVP : Point, Polygon, MultiPolygon ; GeoJSON Geometry/Feature/FeatureCollection. KML Point/Polygon/MultiGeometry polygonale, sans réseau ni ressources externes ; formats non pris en charge refusés explicitement. SHP/KMZ reportés et non simulés.
- Géométries vides, non finies, coordonnées hors plage, anneaux ouverts, auto-intersections, trous invalides, lignes/dimensions non prises en charge : erreurs structurées.
- Aucun ST_MakeValid, recentrage, inversion lon/lat ou simplification destructrice automatique.
- Surface géodésique en hectares ; un point ne possède pas une surface calculable. Avertissements contextualisés sur surface déclarée, seuil de 4 ha hors bovins et profil réglementaire restant à qualifier.
- Trous géométriquement valides conservés avec avertissement d’incompatibilité selon la documentation IS ; aucune promesse d’import officiel.
- Antiméridien, pôles et emprises très grandes : politique explicite, refus guidé des cas non supportés plutôt qu’un calcul ambigu. Tests dédiés avant toute annonce de prise en charge.
- Doublons et intersections uniquement dans le périmètre autorisé ; ne jamais révéler l’existence d’une parcelle d’un autre tenant par un avertissement.
- Budgets initiaux proposés : fichier texte 1 Mio, 100 features, 10 000 positions totales ; limite HTTP dédiée aux routes d’import, limites existantes conservées ailleurs. Bornes à valider par tests de temps et mémoire, pas capacité industrielle annoncée.

## API / UI / fichiers impactés

- `backend/app/plots/` : schémas, géométries, parseurs, services, routes ; appels PostGIS et erreurs métier.
- `backend/migrations/versions/0003_*` : clés composites, index spatiaux GiST, RLS, révisions et audit.
- `backend/app/portal/` : propositions géographiques sous session limitée ; compatibilité des collectes initiales déjà soumises.
- `backend/app/middleware.py` : quotas ciblés sans augmenter indistinctement la surface d’attaque.
- `src/components/plots/` : carte, formulaires, import/aperçu, résultats et provenance.
- `src/app/page.tsx`, `src/app/portail/page.tsx` : intégration des parcours, sans score de conformité.
- `next.config.ts` : réseau du fond de carte explicitement autorisé selon décision.
- Tests backend/E2E, OpenAPI, guides et rapport de recette.

## Permissions et risques

Écriture canonique Admin/Compliance Manager/Procurement ; lecture Analyst/Viewer ; revue réservée Admin/Compliance Manager ; Supplier OIDC et portail limités à leur fournisseur. La collecte fournisseur ne réécrit pas les références de l’entreprise.

Risques principaux : fuite de coordonnées par requête/bbox/cache ou fournisseur de tuiles ; XML hostile ; explosion de complexité ; mélange de versions ; faux sentiment d’exactitude GPS ; mauvaise distinction validité/compatibilité/conformité. Prévoir clés/cache/bbox tenantés, parseur XML sécurisé sans DTD/entités/NetworkLink, quotas, index et transactions, confirmation humaine et libellés explicites.

## Recette de sortie prévue

- Non-régression complète des 78 tests backend et 3 parcours navigateur existants.
- Isolation A/B et fournisseurs, rôles, rattachements lots/parcelles/version, erreurs concurrentes et archives.
- Coordonnées limites/non finies, objets vides/corrompus, anneaux/auto-intersections, trous/multipolygones, très petites/grandes surfaces, antiméridien.
- Tests au seuil 4 ha, limites de troncature à six décimales et perte de validité, sans confondre décimales et précision mesurée.
- Imports malveillants, limites, doublons/replay, rollback complet et aucune récupération réseau depuis le XML.
- Parcours carte/dessin/import, GPS simulé explicitement en test (pas fausse acquisition réelle), refus de permission, correction/revue fournisseur, responsive/clavier et absence de requête externe en mode privé.
- Migrations vierges/répétées, restauration synthétique, lint/types/build/audits, rapport avec réserves explicites.

## État réel au cadrage

FAIT : lecture du code existant, branche dédiée, vérification documentaire ciblée, plan et risques ; noyau de validation PostGIS non destructif et lecteurs GeoJSON/KML bornés, testés.
NON FAIT : migration parcellaire, persistance et API autorisées, carte/dessin/GPS, intégration portail, nouvelles recettes navigateur et qualification complète.
DÉFAUT RETENU : aucune requête de fond de carte externe ; fond contractuel ou public à configurer ultérieurement sur décision explicite.
PROCHAINE ÉTAPE : poursuivre le même chantier avec le modèle persistant, les API/RLS et les parcours carte/portail ; ne pas démarrer le chantier 4 avant livraison et nouveau GO.
