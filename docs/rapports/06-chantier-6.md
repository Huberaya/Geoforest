# Chantier 6 — coffre documentaire, légalité et risque

**Version livrée : 0.7.0 · schéma 0006 · branche `chantier-6/documents-legality-risk`.**

**Bilan : PRÊT POUR RECETTE LOCALE AVEC DONNÉES FICTIVES. Pas un GO de production.** Le chantier 7 n’est pas commencé et nécessite un accord distinct.

## 1. Périmètre réalisé

- Coffre privé auto-hébergé, sans cloud engagé : réservations idempotentes, transfert par blocs, reprise, versions sans écrasement, rattachements immuables fournisseur/lot/révision parcellaire.
- SHA-256, quotas globaux par organisation, quarantaine, ClamAV 1.4.6 réel, inspection bornée des PDF/JPEG/PNG, téléchargement privé avec contrôle d’intégrité et audit.
- Revue humaine d’une version : acceptation documentaire, demande de complément ou refus motivé. Retours visibles au fournisseur concerné ; analyses internes non exposées.
- Portail mobile : dépôt, consultation, téléchargement autorisé et nouvelle version conservant les liens fixés par le client.
- Légalité par lot : huit domaines, pays et période, sources/justifications, pièces acceptées, qualification manuelle du cadre.
- Risque : quatorze critères explicites, facteurs et blocages, risque résiduel proposé, refus d’un « négligeable » non justifié, contexte horodaté/empreinté et historique à réexaminer après changement ou ancienneté.
- Actions correctives : responsable de la même organisation, échéance, retard, version optimiste et résolution avec note/preuve. Outbox `NOT_CONFIGURED` ; aucun email envoyé.
- Inventaire d’intégrité et nettoyage hors ligne des seuls temporaires éligibles ; procédure et exercice de sauvegarde/restauration DB + coffre.
- OpenAPI actualisé, guide utilisateur, guide exploitation, ADR et vérification réglementaire complétés.

## 2. Résultats de qualification

| Contrôle | Résultat et portée |
|---|---|
| Backend complet sur base neuve | **683 tests réussis, 13 avertissements**, 302,93 s. Aucun test ignoré annoncé. |
| Sous-ensemble documentaire | **57 tests unitaires + 22 API** inclus dans les 683. Les tests API utilisent un scanner simulé, mais le parseur de format réel. |
| Navigateur, régression 1–6 | **8 scénarios sur 8 réussis**, OIDC réel ; GFC/TMF réels pour le scénario forestier ; ClamAV réel pour les documents. |
| Dernière finition UI documentaire | Scénario documentaire rejoué : **1 réussi en 27,8 s** ; desktop, 768, 390 et 360 px, portail 360 px, aucune erreur JavaScript relevée. |
| Qualité frontend | ESLint, TypeScript et build Next.js réussis ; fichiers dotenv retirés de l’artefact standalone. |
| Qualité Python | Ruff réussi. |
| Dépendances | npm audit et pip-audit : **aucune vulnérabilité connue signalée** à l’exécution ; ce n’est pas une garantie d’absence de faille. |
| Antivirus réel | Pièces fictives propres et fichier de 280 000 octets acceptés ; EICAR rejeté ; timeout et bases invalides indisponibles, sans publication. |
| Migration fraîche | 0001 → 0006, puis second upgrade sans effet ; rôle runtime non superuser/non BYPASSRLS ; garde de quota refusant les contextes absents/étrangers. |
| Migration peuplée | Base 0005 restaurée puis migrée. Lignes antérieures forêt, géolocalisations, contrôles pays et lots comparées à une restauration témoin : préservées. |
| Restauration finale | Nouvelle base et coffre distincts ; **12 blobs référencés, 12 vérifiés**, aucun absent, corrompu ou orphelin ; dix tables métier comparées à l’identique. |
| API après restauration | Téléchargement autorisé avec empreinte exacte ; téléchargement anonyme refusé 401. Sessions et invitations restaurées révoquées ; session temporaire de test révoquée. |

Les 13 avertissements backend concernent les dépréciations Starlette/TestClient et Rasterio ; ils restent visibles dans les preuves.

### Cas de sécurité et d’erreur couverts

Isolation entreprise et fournisseur, absence de contexte RLS, rôles sans écriture, feedback documentaire limité au bon fournisseur, preuve/assignation hors périmètre, quota tenant vu depuis le portail, concurrence de réservations, contexte NULL de la fonction privilégiée, révocation pendant scan, hash/MIME falsifiés, transfert incomplet/rejeu divergent, indisponibilité et détection antivirus, PDF actifs/chiffrés/objets indirects non référencés, dimensions/pages excessives, formats non admis, intégrité du téléchargement, pièces expirées conservées, snapshots devenus périmés et mises à jour concurrentes de tâches.

Le scénario navigateur documentaire vérifie également qu’une pièce peut être versionnée par le fournisseur tout en gardant le lot fixé par son client, qu’un dossier incomplet ne peut pas être signé « négligeable », et qu’une action se résout avec preuve acceptée.

## 3. Problèmes trouvés et traités

1. **Quota sous RLS portail** : une simple somme ne voyait que le fournisseur courant. Remplacée par une fonction SECURITY DEFINER contrôlée, search_path fixé et droit EXECUTE restreint. Dernière revue : traitement explicite des NULL avec `IS DISTINCT FROM` / `IS NOT TRUE`, testé en contexte absent ou étranger.
2. **Réservation concurrente** : verrou par organisation et READ COMMITTED après attente, pas snapshot périmé. Deux réservations concurrentes ne dépassent pas le quota.
3. **Liens de version portail** : conserver le lot/parcelle existant sans exiger la lecture des tables internes ; aucun nouveau rattachement arbitraire.
4. **Téléchargement navigateur** : extension dérivée du MIME réellement validé, jamais d’un nom fourni par l’utilisateur ; en-tête no-store non dupliqué.
5. **Parseur isolé** : sortie sur fichier temporaire avec limite OS 4 Kio et lecture parent bornée ; refus des valeurs PDF actives, y compris objets indirects non atteints depuis le catalogue.
6. **Mémoire de recette** : scanner indisponible sous pression lorsque Keycloak/Chromium étaient actifs sur 2 Gio. Ajout d’un swap temporaire de 1 Gio pour les seules données fictives ; aucun contournement du scan ni allongement de ses limites. Dimensionnement de production non qualifié.
7. **Recette accélérée** : la première exécution groupée a heurté les limites API et échoué sur deux anciens parcours. Les huit scénarios ont ensuite été exécutés séparément avec 61 s entre eux : tous verts, **limiteur inchangé**. Le transfert documentaire gère un 429 de bloc par reprise différée bornée.
8. **Exploitation** : garde d’espace libre avant écritures ; inventaire vérifiant le mode 0400 des blobs et nettoyage limité au staging ancien éligible. Les blobs orphelins restent conservés pour investigation.

## 4. Statut de lancement

| Statut | Éléments |
|---|---|
| **PRÊT** | Démonstration/recette fictive du coffre, revue documentaire, légalité, risque et actions ; tests, preuves et restauration locale. |
| **À FINALISER** | Exploitation UE, chiffrement disque/swap/sauvegardes, sauvegarde hors site et RPO/RTO, dimensionnement, observabilité, limitation edge fiable et sandbox OS sans réseau. |
| **BLOQUÉ POUR PRODUCTION** | Usage de pièces réelles tant que ces qualifications ne sont pas faites. Le Compose standard ne fournit pas le runtime antivirus qualifié et garde le coffre désactivé. |
| **RISQUE RÉGLEMENTAIRE** | Lois nationales/classement pays à vérifier selon contexte ; certifications complémentaires seulement ; « négligeable » humain enregistré ≠ conformité certifiée ou déclaration aux autorités. |
| **PROCHAINE VERSION** | OCR sécurisé, SMTP réel, stockage objet/immutabilité avancée et montée en charge, après cadrage/qualification. Diligence, exports et préparation des déclarations : chantier 7, uniquement après GO. |

Aucune suppression automatique à cinq ans après upload. Aucun prestataire payant engagé, aucun document métier réel utilisé, aucune soumission officielle ni API TRACES revendiquée.

## 5. Livrables et preuves

- [Guide utilisateur](../guide-documents-legalite-risque.md)
- [Exploitation et restauration](../exploitation-documents.md)
- [Fondement réglementaire](../reglementation/06-documents-legalite-risque.md)
- [ADR 006](../adr/006-documents-legality-risk.md)
- [OpenAPI](../openapi.json)
- Dossier `preuves-chantier-6/` : logs backend/build/E2E/audits, `migration.json`, `restauration.json`, `antivirus-reel.json`, synthèse E2E et captures desktop/mobile.

Les sauvegardes et accès de démonstration restent privés, hors Git. Les anciens rapports/captures des chantiers 1–5 ont été préservés. La modification préexistante du mode de `infra/bootstrap-db.sh` n’est pas intégrée à ce travail.

**Publication : livraison locale ; aucun nouveau push GitHub effectué ni ancien token réutilisé. Attendre un accès autorisé pour publier. Aucun GO7 implicite.**
