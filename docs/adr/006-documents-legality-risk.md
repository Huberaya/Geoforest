# ADR 006 — Documents, légalité et risque

28 septembre 2026 — GO6 reçu. Branche `chantier-6/documents-legality-risk`, depuis `0fff6dc`.

**Statut : premier incrément stockage/antivirus implémenté et testé, sans API/UI documentaire. Choix utilisateur confirmé : coffre privé auto-hébergé, pièces fictives pour la recette. Chantier en cours, aucun GO7.**

Une modification locale préexistante de mode de fichier dans `infra/bootstrap-db.sh` a été constatée ; elle n’est ni reprise ni annulée par ce chantier.

## Objectifs et dépendances

Réutiliser OIDC, sessions fournisseur, RBAC, RLS, audit, lots et snapshots de parcelles, observations forestières sourcées. Ajouter un coffre privé versionné, une revue de légalité documentée, une évaluation de risque explicable et des actions correctives. Aucune certification automatique, aucune déclaration officielle (chantier 7).

Le dépôt ne possède pas encore de stockage objet, antivirus, pipeline documentaire ou SMTP. Le middleware limite actuellement les corps ordinaires à 64 Kio et les lit avant authentification : ne pas augmenter globalement cette limite pour les fichiers. Concevoir un chemin de dépôt borné, authentifié, avec réservation/quota et nettoyage des transferts interrompus.

## Séquence d’implémentation proposée

1. **Sources et contrats** : relire articles 2(40), 9–13, lignes directrices 2026, rôle des certifications, rétention ; modèle des versions documentaires, preuves typées et décisions. Identifier les références nationales non qualifiées, sans inventer de checklist mondiale validée.
2. **Coffre et quarantaine** : dépôt PDF/JPEG/PNG initialement, identification réelle du type, taille/quota bornés, clés opaques générées serveur, SHA-256 ; versions immuables au niveau applicatif. Antivirus réel, délai/erreur/base absente = fichier non libéré. Téléchargement uniquement après autorisation fraîche et état admissible ; pas de fichier servi statiquement ni de rendu HTML/PDF actif implicite.
3. **Persistance et API** : migration 0006, contraintes tenant/fournisseur et liens typés fournisseur/parcelle/révision/lot ; états de scan séparés de la revue documentaire. Tests avec rôle PostgreSQL runtime. Pas de publication d’une version incomplète ; cohérence et reprise des erreurs DB/stockage explicites.
4. **Interface entreprise et fournisseur** : dépôt mobile simple, progression, versions, émetteur, période de validité, revue/commentaire motivé. Le fournisseur ne voit ni les autres fournisseurs ni les évaluations internes. Une expiration n’efface pas une preuve historique.
5. **Légalité** : domaines art. 2(40), applicabilité motivée par origine/produit/période, références et versions de preuves ; statut non qualifié tant que les exigences nationales pertinentes ne sont pas établies. Un titre foncier n’est pas imposé universellement. Revue habilitée, jamais authentification juridique du document par son seul antivirus ou OCR.
6. **Risque** : instantané des entrées/règles/observations, facteurs explicites, pièces manquantes/expirées/non revues, inconnues et actions. Aucun score numérique arbitraire, ni compensation d’un blocage par des facteurs favorables. Pays faible risque, certificat ou absence de signal ne créent pas une conformité. Toute conclusion manuelle reste motivée, attribuée, historisée et invalidable par des données nouvelles.
7. **Tâches et notifications** : responsable, échéance, état, preuve de résolution et audit. Rappels internes puis outbox email ; sans fournisseur SMTP autorisé, pas d’envoi réel ni de statut « envoyé ». OCR optionnel local/assisté seulement s’il peut être sécurisé et testé ; pas de transmission de justificatifs à une IA tierce par défaut.
8. **Recette** : falsification MIME, EICAR standard, fichiers tronqués/surdimensionnés, antivirus indisponible, transferts interrompus, courses de versions et permissions, isolation entreprise/fournisseur, preuve manquante/expirée, impossibilité de contourner les blocages ; E2E mobile, migration peuplée et restauration DB + objets cohérents. Documentation API/exploitation/utilisateur, bilan avant GO7.

## Fichiers prévus

- `backend/app/documents/`, `legality/`, `risk/`, `tasks/` ; adaptateurs de stockage et scan séparés du métier.
- `backend/migrations/versions/0006_*`, tests DB/API/unitaires et worker.
- `src/components/documents/` et intégration dans les espaces entreprise/fournisseur.
- `infra/`, Compose et configuration uniquement après choix de stockage et qualification des dépendances.
- `docs/reglementation/06-documents-legalite-risque.md`, OpenAPI, guides, rapport et preuves du chantier 6.

## Risques et limites

Stockage privé n’implique pas à lui seul chiffrement, rétention légale ou immutabilité face à l’administrateur. Sauvegardes des blobs et de la DB doivent être cohérentes. L’environnement de développement utilisera exclusivement des documents fictifs ; résidence, sous-traitance et protections de production à qualifier avant documents réels. Aucun abonnement ou service payant engagé par ce cadrage.

Le guide de la Commission du 13 juillet 2026 est un document d’orientation, pas un amendement du règlement. Il annonce un répertoire de lois pour décembre 2026 : cette annonce ne prouve ni disponibilité aujourd’hui ni qualification mondiale des obligations nationales. Le moteur ne doit pas inventer cette couverture.

## Premier incrément exécuté

Adaptateur local privé, versions de blobs sans écrasement, empreintes vérifiées ; scanner ClamAV 1.4.6 borné et qualifié avec signatures officielles, EICAR, timeout et bases malformées. 30 tests ciblés et 112 tests unitaires forestiers réussis. Métadonnées métier, migration 0006, API, UI, légalité/risque et tâches restent à construire. Détails : `../rapports/06-chantier-6-avancement.md`.

## Livraison du périmètre de recette

Le premier incrément ci-dessus est historique. Migration 0006, API staff/portail, interfaces, huit domaines de légalité, quatorze critères de risque, preuves versionnées et actions correctives sont désormais implémentés. Regroupement du métier dans `backend/app/documents/compliance.py` plutôt que trois sous-packages vides. Le quota global utilise une fonction contrôlée et refuse explicitement les contextes NULL ; conformité en snapshot REPEATABLE READ, réservation en READ COMMITTED après verrou de quota. Aucune fonction de déclaration du chantier 7 n’a été ajoutée.

Voir [bilan final](../rapports/06-chantier-6.md), [guide utilisateur](../guide-documents-legalite-risque.md) et [exploitation](../exploitation-documents.md). Recette locale qualifiée, pas de GO de production : OCR, SMTP, sandbox OS, chiffrement/hébergement UE et exploitation à grande échelle restent non qualifiés.
