# Chantier 7 — premier incrément

> Historique : chantier 7 désormais clôturé pour le MVP interne. Voir le [bilan final](07d-chantier-7-cloture.md). Les réserves ci-dessous décrivent l’état de cet incrément, pas le bilan courant.
> Historique du premier incrément. Voir le [deuxième incrément backend](07b-chantier-7-backend.md) pour l’état actuel.

29 septembre 2026 · branche `chantier-7/due-diligence-exports`.

**EN COURS — chantier non clôturé.** Le GO7 est reçu ; aucun nouvel accord n’est nécessaire pour poursuivre ce périmètre. Aucun GO8.

## Réalisé

- Relecture des annexes II/III, de la page officielle actuelle du système EUDR et des passages pertinents du règlement d’exécution 2026/1565.
- API officielle existante confirmée ; CIRCABC a renvoyé une page JavaScript sans spécification exploitable. Aucun accès authentifié ni soumission qualifié. Préparation assistée, sans endpoint officiel inventé.
- [ADR 007](../adr/007-due-diligence-exports.md) : workflow, snapshots immuables, rôles, champs, limites et plan de recette.
- [Registre réglementaire](../reglementation/07-diligence-declarations.md) : sources effectivement lues, implications et vérifications restantes.
- Noyau pur `backend/app/diligence/core.py` : typage des faits de préparation, lacunes explicites, régime ordinaire distinct des autres acteurs, unités et masse nette exacte, essences bois, fraîcheur du risque, légalité/preuves/actions, transitions internes et empreintes bornées.
- Aperçus internes JSON/CSV dans `exports.py` : format clairement NON TRACES, contrôle d’intégrité, quantités conservées sans conversion flottante, UTF-8, index CSV protégé contre les formules, noms de fichier UUID et rejet des champs non prévus.

## Tests réellement exécutés

**97 tests unitaires réussis en 0,20 s**, sans DB ni réseau. Ruff sur l’ensemble backend/app et backend/tests : réussi.

Commande ciblée :

```sh
PYTHONPATH=backend .venv/bin/pytest \
  --confcutdir=backend/tests/diligence_unit backend/tests/diligence_unit -q
```

Cas : régimes non qualifiés, données manquantes, risque ancien/futur/modifié/non résolu, absence de preuves/actions ouvertes, transitions/permissions de la politique pure, confirmation obligatoire, absence de transition officielle, précision T→KG indépendante du contexte Decimal, refus de conversion M3→KG inventée, incohérences de masse, JSON surdimensionné/profond/non fini, intégrité et injection de formules CSV (contrôles et préfixes Unicode).

Ces tests **ne prouvent pas** la sécurité d’une API intégrée : les faits devront être reconstruits côté serveur sous RLS et l’identité recontrôlée en transaction. Ils ne remplacent ni la régression des 683 tests du chantier 6 ni une recette navigateur du chantier 7.

## Non livré à ce stade

- Migration 0007, tables de dossiers/révisions/décisions et RLS associée.
- API transactionnelle, persistance/audit des décisions et résolution des faits depuis les données 2–6.
- Dossier complet contenant géométries et références détaillées de preuves ; les aperçus actuels sont explicitement des résumés, pas un dossier final.
- PDF et interface entreprise, suivi éventuel des démarches externes, téléchargements HTTP autorisés.
- Tests API/RLS/concurrence, E2E responsive, lecture indépendante du PDF, migration peuplée, restauration et régression complète.

**Aucune route ni interface nouvelle n’est activée. Version applicative 0.7.0 et schéma 0006 inchangés.** Aucun numéro officiel généré, numéro de vérification stocké, envoi à TRACES ou prestataire payant engagé. L’environnement ACCEPTANCE ne sera jamais présenté comme preuve de déclaration juridiquement valable.

## Prochain bloc du chantier 7

Brancher les faits sur les contextes réels du chantier 6 ; persister révisions et décisions avec RLS/idempotence ; contrôler le contexte avant validation ; ajouter les exports complets et le PDF, puis l’interface et la recette. Conserver les réserves de production du chantier 6.
