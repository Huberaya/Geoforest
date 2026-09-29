# Préparer et revoir un dossier de diligence

Version 0.8.0 — préparation **assistée**, décisions **manuelles**. Aucun envoi officiel.

## Prérequis

Migration 0007 et activation serveur explicite `DILIGENCE_ENABLED=true` dans un environnement qualifié. Le défaut reste `false`. L’organisation doit disposer de fournisseurs, produits, lots et des éléments documentaires/parcellaires nécessaires. Ne pas utiliser de vraies données confidentielles dans la recette publique.

Admin, Compliance Manager et Procurement peuvent préparer et soumettre à la revue interne. Admin et Compliance Manager prennent les décisions de validation, correction ou retrait. Analyst et Viewer consultent/exportent. Supplier et portail fournisseur n’accèdent pas aux dossiers internes.

## Parcours

1. Sélectionner l’organisation puis **Diligence raisonnée → Nouveau dossier**.
2. Renseigner titre, identité de l’opérateur, adresse et EORI lorsque pertinent. Qualifier le régime et l’opération commerciale avec des références vérifiables. Ne pas choisir « opérateur ordinaire » simplement pour débloquer l’application : les autres parcours restent à qualifier dans ce MVP.
3. Confirmer le champ produit avec une source actuelle et la complétude de la chaîne. Rechercher et sélectionner jusqu’à 20 lots. Pour chaque lot, examiner géolocalisations, essences scientifiques et unités ; une masse nette déclarée n’est pas une conversion calculée arbitrairement à partir d’un volume.
4. **Figer cette révision**. Le serveur relit les données autorisées et conserve un snapshot immuable. Il peut enregistrer un brouillon incomplet : cela ne signifie pas qu’il est validable.
5. Examiner les contrôles, corriger les sources dans les espaces fournisseurs/produits/lots/parcelles/documents/légalité/risque. Puis préparer **une nouvelle révision** : une correction n’écrase jamais l’historique.
6. Justifier la soumission à la revue. Un réviseur habilité examine réellement les pièces et le contexte. La validation interne exige l’absence de blocages et sa confirmation explicite. « Aucun blocage détecté » ne prouve pas la conformité légale.
7. En cas de conflit ou de sources modifiées, actualiser les contrôles et relire la révision courante. Ne pas considérer une ancienne validation comme applicable à des sources nouvelles.
8. Télécharger les exports depuis la révision choisie. Le navigateur vérifie l’empreinte des octets avant de proposer le fichier.

## Choisir un export

| Format | Contenu | Limite |
|---|---|---|
| PDF | Synthèse lisible, lots, revues, références/empreintes des preuves, décisions et avertissements | Pas toutes les géométries ni tous les détails structurés ; joindre le JSON |
| JSON | Snapshot complet, sources structurées, géométries, décisions et contrôles à l’export | Ni pièces binaires ni blocs raster détaillés |
| CSV | Index des lots, état interne, disponibilité de validation, quantités et références | Pas un dossier complet ; cellules potentiellement actives neutralisées |

Les exports restent privés et audités. Leur SHA-256 contrôle l’intégrité technique, pas l’authenticité juridique ni la véracité des données. L’empreinte du snapshot diffère de celle du fichier exporté, qui comprend aussi le contexte et la date d’export.

PDF : 60 pages/80 000 caractères affichés/8 Mio maximum ; JSON et CSV : 2 Mio. Les caractères non couverts par la police embarquée provoquent un refus explicite : utiliser le JSON ou CSV, sans translittérer silencieusement un nom. En cas de PDF occupé, réessayer ; en cas de dépassement, réduire le périmètre ou utiliser le JSON. Aucune troncature silencieuse.

## Saisie officielle assistée, hors GeoForest

**À confirmer réglementairement** : déterminer d’abord l’acteur, le régime et l’obligation applicable avec les sources du registre réglementaire et un responsable compétent. Le régime simplifié n’est pas la déclaration ordinaire.

Pour un opérateur relevant effectivement de la déclaration ordinaire, utiliser le dossier pour rapprocher identité/EORI, produits/codes SH/descriptions/essences, quantités/unités et pays/géolocalisations dans le système officiel. Vérifier les données, les confirmations et les exigences de signature directement dans son interface actuelle. Les exports GeoForest ne sont **pas** des fichiers d’import TRACES qualifiés ; ne pas les téléverser comme tels.

L’API officielle existe, mais son accès authentifié et son contrat ne sont pas qualifiés ici. Aucun connecteur ni bouton de dépôt n’est opérationnel. ACCEPTANCE sert aux essais sans valeur juridique ; il ne faut jamais le confondre avec PRODUCTION.

Le suivi manuel structuré des références externes n’est pas implémenté dans cette version. Ne pas inscrire le **numéro de vérification**, qui est un secret, dans les notes libres/exportables. Une validation ou un retrait dans GeoForest ne déclare ni ne retire rien auprès des autorités. Conserver les preuves officielles dans un dispositif qualifié et respecter les obligations de conservation ; le stockage local de développement ne suffit pas à qualifier l’exploitation en production.
