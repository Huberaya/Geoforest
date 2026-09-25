# Intégration complémentaire des chantiers C1–C5

Cette branche conserve sans suppression l'application et l'historique présents sur `main`. Le workspace produit dans le cadre des chantiers 1 à 5 est ajouté séparément sous [`agent-work/chantiers-c1-c5/`](agent-work/chantiers-c1-c5/).

## Ce que contient l'arborescence ajoutée

- Le code et les rapports locaux des chantiers C1–C5, dont le dépistage C5, ses tests et l'interface dédiée.
- Un projet autonome avec sa propre structure backend/frontend, ses fichiers de dépendances et ses exemples de configuration.
- Aucun fichier de l'ancienne application à la racine n'est supprimé ni remplacé. Seuls ce document et le lien de découverte ajouté au README sont nouveaux/modifiés à la racine.

## Limite importante

L'ajout est **complémentaire dans le dépôt, pas une fusion de runtime**. Le backend historique à la racine n'a pas le modèle d'organisation/authentification multi-tenant ni le journal d'audit attendu par C5. Les routes C5 et l'interface ajoutées dans `agent-work/chantiers-c1-c5/` ne sont donc pas câblées à l'ancienne application. Le dépistage live GFW y reste désactivé et nécessite une validation de contrat non-production.

Avant d'intégrer l'une des deux applications à la racine, faire une revue d'architecture et porter les fondations une par une. Ne pas supprimer cette arborescence ni remplacer les chemins existants sans décision explicite.
