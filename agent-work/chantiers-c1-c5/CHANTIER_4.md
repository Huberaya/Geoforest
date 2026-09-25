# Chantier 4 — Parcelles & moteur géospatial

**État : livré et validé pour le périmètre MVP du chantier.**  
Le module permet de saisir, importer, visualiser, corriger et valider techniquement des géométries rattachées aux lots. Il ne réalise pas d'analyse de déforestation et ne délivre aucune certification juridique.

---

## 1. Analyse

### Besoin métier
Les parcelles — ou les établissements d'élevage dans le cas des bovins — doivent être reliés à un lot et rester strictement isolés par organisation. Les coordonnées étant des données sensibles, les accès, les changements et les suppressions doivent être traçables.

### Règles EUDR contrôlées
Références officielles consultées :
- [Règlement (UE) 2023/1115 — texte consolidé au 26 décembre 2025](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A02023R1115-20251226), notamment articles 2(28) et 9(1)(d).
- [Règlement modificatif (UE) 2025/2650](https://eur-lex.europa.eu/eli/reg/2025/2650/oj/eng).

Conséquences retenues dans ce module :
- au moins **six chiffres décimaux** pour les coordonnées;
- le périmètre polygonal s'applique aux parcelles **strictement supérieures à 4 ha** pour les commodités concernées autres que les bovins;
- pour les bovins, la géolocalisation concerne les **établissements** où les animaux ont été gardés;
- le règlement modificatif prévoit aussi une option d'adresse postale pour certains opérateurs primaires micro/petits admissibles; **ce parcours n'est pas implémenté** ici.

Le seuil et l'exception bovins sont présentés comme des contrôles de saisie techniques, pas comme un avis juridique. La date butoir de déforestation du **31/12/2020** reste une référence EUDR, mais aucun contrôle temporel de couvert forestier n'est réalisé dans ce chantier.

---

## 2. Plan exécuté

1. Créer le modèle et les schémas de parcelle, avec bornes défensives sur les GeoJSON.
2. Ajouter un validateur WGS84 pour la précision, la topologie, les surfaces et le seuil polygonal.
3. Fournir les routes CRUD/validation en conservant l'isolation multi-tenant et les transitions de statut des lots.
4. Ajouter les parcours frontend d'import, de dessin et de capture GPS.
5. Étendre le journal d'audit aux changements critiques de l'organisation, de la chaîne d'approvisionnement, des parcelles et des utilisateurs.
6. Couvrir les règles et flux par les tests backend, puis reconstruire et vérifier le typage frontend.

---

## 3. Implémentation

### Backend — parcelles et validation
- Modèle `Plot` rattaché à un lot et à une organisation; métadonnées de surface, type géométrique, centroïde, bbox, précision source, année de récolte et capture GPS.
- Géométries GeoJSON acceptées : `Point`, `MultiPoint`, `Polygon`, `MultiPolygon`, `Feature`, `FeatureCollection` et `GeometryCollection` (les types de géométrie non pris en charge sont signalés).
- Validations : coordonnées WGS84 dans l'ordre `[longitude, latitude]`, au moins 6 décimales, anneaux fermés, topologie Shapely, surface géodésique WGS84 via PyProj, seuil strict `> 4 ha` hors bovins.
- Limites défensives : **10 Mo** et **100 000 positions** par GeoJSON. Une géométrie invalide est conservée pour permettre son affichage et sa correction, avec les erreurs associées.
- Routes ajoutées sous `/api/v1` :

| Méthode | Chemin | Fonction |
|---|---|---|
| GET | `/plots` | Liste paginée, filtres et agrégats tenant |
| POST | `/plots` | Création et validation initiale |
| GET | `/plots/{id}` | Détail tenant |
| PATCH | `/plots/{id}` | Modification et revalidation si nécessaire |
| POST | `/plots/{id}/validate` | Relance explicite de la validation technique |
| DELETE | `/plots/{id}` | Suppression avec événement d'audit |

Les écritures sont réservées aux rôles admin, conformité, achats et analyste. Les recherches filtrent sur `organization_id`; une ressource d'un autre tenant n'est pas révélée.

### Workflow lots et dashboard
- À la création d'une première parcelle, un lot `draft` passe à `awaiting_data`.
- Si la dernière parcelle est supprimée, le lot revient à `draft` seulement s'il est encore `awaiting_data`; un état métier plus avancé n'est pas écrasé.
- `plots_analyzed` ne compte que le statut `analyzed`. Une géométrie simplement valide **ne signifie pas** qu'une analyse de déforestation a été exécutée.

### Frontend
- Page `/plots` : import de fichiers GeoJSON/JSON, KML et CSV/TXT, collage de contenu, dessin de polygone Leaflet, capture GPS navigateur avec horodatage et précision rapportée, liste, filtres, validation et correction.
- La précision de format GPS n'est pas présentée comme une précision topographique. Le fond OpenStreetMap est attribué; si le fond externe est indisponible, les autres données restent consultables.
- Page `/audit-log` mise à jour : événements de l'organisation, utilisateurs, fournisseurs, produits, lots et parcelles; filtres par type d'objet; accès limité aux rôles admin et conformité.

### Audit trail
Le journal enregistre acteur, action, date, objet, snapshots avant/après et IP directe (ainsi que le user-agent), dans la transaction métier :
- inscription organisation/utilisateur;
- créations/modifications/archivages des fournisseurs et produits, créations/modifications/suppressions de lots et invitations fournisseurs;
- création/modification/validation/suppression de parcelles;
- modification de profil, changement de mot de passe, invitation et désactivation d'un membre.

Les snapshots de comptes excluent `password_hash` et `refresh_token_jti`; un changement de mot de passe est journalisé par son état métier, jamais par le mot de passe ou son hash. Le token d'invitation fournisseur n'est pas inclus. Les comptes sans organisation ne peuvent pas effectuer une mutation nécessitant ce journal tenant.

### Dépendances de test
- `aiosqlite` a été ajouté aux dépendances backend, car la configuration documentée des tests et du mode SQLite l'exigeait.
- `requests` est passé de `2.32.0` à `2.32.5` après détection à l'installation d'un pin 2.32.0 retiré (yanked).

---

## 4. Tests et validation

### Backend
Commande :
```bash
GFW_LIVE_ENABLED=false python -m pytest -q
```
Résultat final : **66 passed**.

Les tests couvrent notamment : précision lexicale GeoJSON, seuil exactement 4 ha versus strictement supérieur, exception bovins, création/correction/suppression, isolation inter-tenant, workflow des lots, audit de la supply chain et des actions utilisateur, absence de secrets dans l'audit, et KPI dashboard.

### Frontend
Commandes exécutées :
```bash
npm run build
npm run typecheck
```
Résultat : build Next.js réussi, **20 routes** générées; TypeScript sans erreur.

Le backend émet encore des avertissements non bloquants de dépréciation provenant de `passlib`/Argon2, `python-jose` (`datetime.utcnow`) et de la configuration de portée de boucle pytest-asyncio. Ils n'empêchent pas les tests de passer.

---

## 5. Bilan FAIT / NON FAIT

### FAIT
- Modèle et API des parcelles avec isolation multi-tenant.
- Validation géométrique WGS84 et règles de précision/seuil vérifiées contre les textes officiels cités.
- Import GeoJSON/KML/CSV, dessin sur carte, capture GPS navigateur et parcours de correction.
- Transition de lot `draft` → `awaiting_data` et retour conditionnel à la suppression de la dernière parcelle.
- Journal d'audit étendu aux actions critiques utilisateur et chaîne d'approvisionnement; secrets exclus des snapshots.
- Dashboard sans fausse déclaration d'analyse.
- Suite backend complète et build/typecheck frontend validés.

### NON FAIT — hors périmètre du chantier
- Analyse satellite ou historique du couvert forestier; contrôle effectif du critère de déforestation au 31/12/2020.
- Contrôle de légalité documentaire et génération d'une déclaration de diligence raisonnée.
- Parcours d'adresse postale pour les opérateurs admissibles au régime modificatif 2025/2650.
- Envoi réel d'emails d'invitation et intégration officielle à TRACES. Aucune déclaration n'est présentée comme déposée.
- Migration Alembic du schéma livré : le dépôt ne contient pas encore de révisions dans `backend/alembic/versions/` et le démarrage actuel s'appuie sur `Base.metadata.create_all`.

---

## 6. Problèmes et risques

- **Déploiement base de données :** aucune révision Alembic n'existe encore. Avant mise à niveau d'une base persistante, créer et tester une baseline/migration couvrant les modèles livrés; `create_all` ne remplace pas un plan de migration de production.
- **Indexation géospatiale :** la géométrie est stockée comme JSON/JSONB et traitée par Shapely/PyProj, pas dans une colonne spatiale PostGIS indexée. C'est adapté au MVP, mais les requêtes spatiales et volumes importants nécessiteront une évolution.
- **Échelle interface :** l'écran charge au plus 500 parcelles et 500 lots à la fois; ajouter une pagination/virtualisation avant des volumes importants.
- **Intégrité d'audit :** l'immutabilité est empêchée par les événements SQLAlchemy ORM et l'API est en lecture seule; ce n'est pas encore un stockage WORM ni une preuve cryptographique contre un administrateur de base de données.
- **Avertissements dépendances :** les avertissements listés ci-dessus devront être traités lors d'un chantier de durcissement/maintenance.

---

## 7. Chantier suivant

Le **chantier 5** a fait l'objet d'un audit, d'un plan et d'un MVP local; son intégration GFW live n'est pas encore validée. Voir [`CHANTIER_5_RAPPORT.md`](CHANTIER_5_RAPPORT.md) et [`CHANTIER_5_AUDIT_PLAN.md`](CHANTIER_5_AUDIT_PLAN.md). La clé et les deux drapeaux d'activation restent désactivés tant qu'un test GFW autorisé en non-production n'a pas été documenté. Le périmètre d'un chantier ultérieur n'est pas défini ici.
