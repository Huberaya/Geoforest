# ADR 007 — Dossiers de diligence, validation interne et exports

Statut : accepté pour implémentation après GO7 ; chantier EN COURS, non clôturé.
Date : 29 septembre 2026. Branche : `chantier-7/due-diligence-exports`.

## Objectif

Assembler les éléments des chantiers 2–6 dans un dossier reproductible, justifier ses lacunes, conserver les décisions humaines et exporter un dossier privé PDF/JSON/CSV. Aucun export ne vaut soumission aux autorités.

## Décisions

1. **Séparer les états** : brouillon, en revue, corrections demandées, validation interne, retrait interne. Un retrait interne ne retire rien dans TRACES. La préparation, la validation interne et le signalement manuel d’une démarche externe sont des concepts distincts.
2. **Versions immuables** : chaque révision capture données fournisseur/produit/lot, géométries et révisions, références et empreintes de preuves, légalité, risque, tâches et qualification manuelle du régime. SHA-256 canonique et version de méthode. Aucun remplacement d’une ancienne version ; aucune suppression automatique.
3. **Validation humaine** : Admin/Compliance Manager, identité serveur et note requise. Avant validation : relecture du contexte actuel et comparaison d’empreintes ; aucun risque périmé/non négligeable ni action ouverte. Les autres rôles internes habilités préparent/lisent selon RBAC ; Supplier et portail exclus des dossiers internes.
4. **Applicabilité explicite** : distinguer opérateur, acteur aval, trader et micro/petit opérateur primaire. Ne pas imposer une déclaration annexe II à tous. Premier parcours de validation : opérateur, régime ordinaire, champ produit vérifié manuellement. Les autres régimes restent identifiés « parcours à qualifier », sans prétendre qu’une interdiction du logiciel est une obligation légale.
5. **Champs annexe II** : nom/adresse opérateur, EORI si import/export, code SH, description commerciale, noms scientifiques complets du bois, quantités et unités pertinentes, pays de production, toutes géolocalisations, période du dossier et identification humaine. Pas de conversion volume/masse inventée ; T→KG exacte seulement. Les unités supplémentaires nécessitent qualification humaine.
6. **Exports** : format interne documenté, pas format d’import TRACES revendiqué. JSON préserve le détail et la précision ; CSV neutralise les formules et précise qu’il s’agit d’un index ; PDF lisible, contenu échappé, sans ressource réseau, contexte de préparation visible. Bornes sur taille/pages/nombre de pièces, téléchargement privé et audit avant réponse. Aucun secret OIDC, chemin de stockage, jeton portail ou numéro de vérification TRACES exporté.
7. **Externe** : API officielle existante, accès/documentation exploitable non qualifiés dans cet environnement. Pas d’endpoint inventé ni d’appel authentifié engagé. Si une référence externe est consignée manuellement, conserver environnement, preuve et auteur ; la présenter comme déclaration rapportée non vérifiée. ACCEPTANCE ne peut jamais devenir « déclaré légalement ».
8. **Risque des autorités** : non visible à l’utilisateur du système officiel selon le règlement d’exécution amendé. Ne pas l’inférer d’une référence ou d’un résultat GeoForest.

## Plan et dépendances

- Relecture réglementaire et qualification des sources : `docs/reglementation/07-diligence-declarations.md`.
- Noyau pur de cohérence, transitions et formats : `backend/app/diligence/` ; tests unitaires sans réseau/DB.
- Migration 0007 et API transactionnelle : tables dossiers/révisions/décisions, RLS tenant, idempotence et version optimiste ; réutilisation des contextes du chantier 6, audit transactionnel et stockage de preuves existant.
- UI entreprise : liste/recherche, choix du lot, préparation, blocages, revue, versions et exports ; pas de publication vers le portail fournisseur.
- Tests intégration et sécurité : multi-tenant, rôles, sessions révoquées, révisions périmées, concurrence, export incomplet/falsifié/formule CSV, limites et absence de secrets.
- Recette : OIDC, parcours desktop/360px, exports lus par parseur indépendant, migration vide/peuplée, restauration des dossiers, régression complète 1–7 ; bilan puis attente GO8.

## Risques

Une attestation humaine ne prouve pas la véracité des sources saisies. Les données métier incomplètes ne doivent pas être remplacées par des valeurs par défaut réglementaires. La consolidation de décembre 2025 ne couvre pas seule l’amendement ultérieur de l’annexe I. Les structures d’acteurs et simplifications doivent être qualifiées avant extension des parcours. Bornes MVP explicites plutôt qu’un export géant qui sature le service. Le PDF ne constitue pas une signature électronique qualifiée.

## État de ce premier incrément

Cadrage, noyau pur et aperçus internes JSON/CSV implémentés avec 97 tests unitaires ; migration/API/UI/PDF et recette finale non livrés à ce stade. Le schéma actif demeure 0006 et la version de l’application demeure 0.7.0 jusqu’à intégration testée. Aucun GO8.
