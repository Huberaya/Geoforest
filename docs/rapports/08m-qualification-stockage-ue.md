# Chantier 8m — Qualification documentaire du stockage UE

29 septembre 2026 · suite du lot 08l, après demande « fait la suite ».

## Résultat en bref

**Le dossier et le diagnostic local sont livrés. Aucun fournisseur n'est validé pour la production et aucune sauvegarde hors site n'est activée.**

- **Scaleway Paris Multi-AZ** reste la première cible de qualification du coffre. Le support exact de `GetPublicAccessBlock` avec quatre booléens vrais n'est pas démontré par les pages consultées.
- **OVHcloud n'est pas compatible en l'état avec notre adaptateur runtime dans les régions classiques** : sa matrice officielle marque `get public access block` comme non pris en charge. Les Local Zones présentent d'autres incompatibilités, notamment la lecture de configuration du chiffrement.
- **OVHcloud Milan Standard 3-AZ** est proposé seulement comme candidat à un dépôt indépendant d'archives chiffrées, sous compte/droits/clés séparés, avec protections à qualifier. Ce n'est pas un bucket de secours runtime interchangeable.
- **37 nouveaux tests locaux réussis + 125 régressions réussies = 162 tests réussis pour cette étape.** Aucun appel API à un stockage cloud, aucune DB démarrée ou modifiée.

Sources décisives : [OVHcloud — compatibilité API](https://docs.ovhcloud.com/en/guides/storage-and-backup/object-storage/s3-s3-compliancy), [Scaleway — politiques et actions](https://www.scaleway.com/en/docs/object-storage/api-cli/bucket-policy/).

## Objectifs et dépendances

Qualifier, sans commande ni transfert métier, la compatibilité du fournisseur avec les protections existantes ; distinguer coffre actif et dépôt de sauvegardes ; préparer droits, conservation, clés, coûts et preuves de restauration.

Dépendances maintenues : Neon + Clerk, backend Vercel préparé mais non déployé, worker antivirus séparé, candidat SQL 0008 hors Alembic, autorisation distincte nécessaire pour tout compte/service payant ou migration cloud supplémentaire. Aucun domaine n'est requis pour les travaux locaux.

## Livrables

| Fichier | Contenu |
|---|---|
| [`../deploiement/qualification-stockage-ue.md`](../deploiement/qualification-stockage-ue.md) | Décision conditionnelle, matrice API, différences IAM, architecture indépendante, clés/rétention, budget, recette, questions fournisseurs non envoyées |
| `backend/app/documents/storage_diagnostic.py` | Observation de quatre GET seulement, réutilisant le garde runtime existant sur des réponses en mémoire |
| `scripts/diagnose-document-storage.py` | Plan hors ligne et diagnostic limité à un émulateur loopback de test |
| `backend/tests/storage_qualification/test_diagnostic.py` | Tests de fonctionnement, erreurs, confidentialité des sorties et refus de configurations interdites |
| [`preuves-chantier-8/storage-qualification/`](preuves-chantier-8/storage-qualification/) | Résultats bruts, plan JSON, notes de sources, budget CSV et empreintes SHA-256 |
| Guides hébergement historique et restauration | Signalement du changement de cible et lien vers la qualification actuelle |

Les recherches ont porté sur les pages publiques officielles. `sources-review.json` conserve des notes datées, pas une attestation signée du fournisseur ni une archive complète des pages. Les empreintes SHA-256 protègent l'intégrité des fichiers de preuve conservés ; elles n'authentifient pas les déclarations commerciales externes.

## Décisions techniques et risques identifiés

### Ne pas affaiblir les protections

Aucun changement dans `s3_store.py`, sa configuration, la récupération, les routes ou les migrations. `GetPublicAccessBlock` n'est remplacé ni par une ACL privée ni par un réglage de visibilité du bucket. Si une capacité manque, l'activation demeure bloquée.

Les documentations actuelles des deux fournisseurs décrivent les conditional writes : les anciens tickets d'incompatibilité ne sont pas utilisés comme preuve actuelle. Les GET de configuration AES256 sont désormais explicitement documentés pour SSE-ONE Scaleway et SSE-OMK OVHcloud ; leur comportement sur nos identités reste à tester.

### IAM non interchangeable

Scaleway documente un langage et une évaluation de politiques spécifiques. OVHcloud documente un repli sur les ACL, susceptible de laisser un propriétaire autorisé malgré une politique Allow restrictive. Le dossier impose des tests négatifs sous les identités runtime réelles ; aucune politique « prête pour production » non vérifiée n'est fournie.

### Sauvegarde indépendante, pas seulement copie supplémentaire

La proposition sépare fournisseur, région, compte, accès administrateurs et récupération des clés. Object Lock et sa portée lors d'une clôture/suspension doivent être vérifiés. Les archives sont chiffrées côté client ; aucune clé n'est jointe au dépôt. Le transport offsite, la planification, le KMS, les alertes et l'exercice cloud de restauration ne sont pas livrés.

Une copie indépendante ne suffit pas pour restaurer immédiatement chez un autre fournisseur : la cible runtime doit aussi passer les protections exactes. Le PRA complet reste à construire.

### Budget et objectifs non contractuels

Le dossier calcule trois scénarios de stockage nominal, **hors réseau et services**, en explicitant le nombre d'archives complètes, les unités GB/Gio, les arrondis et le tarif régional à confirmer. L'unité de prix d'egress Scaleway est ambiguë dans la page consultée : aucun coût complet certain n'est annoncé. Les scénarios dépassent les limites de la recette de sauvegarde actuelle ; ils ne prouvent pas sa capacité de production.

RPO ≤ 24 h et RTO ≤ 8 h sont proposés comme objectifs à mesurer et approuver, jamais comme garanties. La conservation technique courte des sauvegardes ne remplace pas une politique réglementaire de conservation EUDR/RGPD.

## Tests exécutés

| Vérification | Résultat | Portée réelle |
|---|---:|---|
| Diagnostic de configuration et CLI | **37 passed, 0,18 s** | Faux client, connexions socket interdites, pas de fournisseur ni HTTP réel |
| Régressions documentaires unitaires | **96 passed, 3,09 s** | Stockage/scan/S3 émulé ; pas IAM cloud |
| Régressions archive chiffrée | **29 passed, 1,11 s** | Authentification et contraintes locales ; pas de restauration PostgreSQL réexécutée |
| Ruff check | OK | Trois nouveaux fichiers Python |
| Ruff format check | OK | Trois nouveaux fichiers Python |
| pip check | OK | Environnement Python local réinstallé depuis le lock |
| Plan CLI hors ligne | OK | JSON produit sans construction de client |
| Calcul budget | Trois scénarios recalculés avec Decimal | Hypothèses explicites ; pas devis |
| `git diff --check` | OK | Contrôle des modifications |

### Cas couverts par les nouveaux tests

- Quatre lectures exactes, aucun PUT/DELETE/listing/GET d'objet ni reprise réseau supplémentaire.
- Configuration observée conforme, mais `provider_qualified=false` et `production_authorized=false` restent systématiques.
- Chacun des quatre booléens publics refuse `False`, `1`, la chaîne `true` et `None`.
- Versionnement suspendu, chiffrement absent, ACL publique, réponse manquante/malformée : refus ou état non vérifié.
- API non implémentée, accès refusé, configuration absente et erreur inattendue : raisons bornées, pas de message distant privé dans les sorties.
- Pas de bucket, propriétaire ou secret dans le rapport JSON.
- CLI cloud/hors test/localhost ambigu/backend local/query URL refusée avant création d'un client.
- Plan hors ligne indépendant des secrets injectés ; chemin CLI local exercé avec observations positives et négatives synthétiques.

La vérification de permissions concerne ici les limites du diagnostic et les configurations simulées. **Aucun refus IAM réel, isolement inter-comptes ou Object Lock fournisseur n'est démontré.** Pas de modification UI : recette responsive non applicable à ce lot. Pas de suite backend complète, E2E navigateur ni intégration PostgreSQL réexécutée ; les résultats du lot 08l restent historiques.

## Bilan obligatoire

| Statut | Conclusion |
|---|---|
| **PRÊT** | Dossier sourcé, protocole de recette, questions support, diagnostic local en lecture seule, 162 tests locaux réussis |
| **À FINALISER** | Compatibilité effective Scaleway, IAM des deux domaines, devis régional et egress, DPA/SLA, identités/opérateurs, clés et stratégie d'alerte |
| **BLOQUÉ** | Activation coffre sans preuve des protections exactes ; OVHcloud runtime avec l'adaptateur actuel ; backup offsite et PRA cloud non qualifiés |
| **RISQUE RÉGLEMENTAIRE** | Région UE et chiffrement ≠ conformité ; durées, accès support, transferts, contrats et effacement à valider |
| **PROCHAINE VERSION** | Après choix compatible et GO distinct : recette sur données fictives, transport d'archives indépendant, capacité production, planification/alertes, restauration hors source mesurée |

Aucune souscription, aucun essai gratuit, aucune clé cloud utilisée, aucun contact envoyé, aucune publication Vercel ou migration Neon. La modification préexistante de `infra/bootstrap-db.sh` est exclue de ce lot.
