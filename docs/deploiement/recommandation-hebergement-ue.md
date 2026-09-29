# Hébergement UE — recommandation pour GeoForest Trace

29 septembre 2026 · choix demandé : **recommandation, sans souscription**.

## Recommandation

**Retenir Scaleway, région Paris, comme première cible de qualification**, avec PostgreSQL managé + PostGIS, machines virtuelles pour l’application et l’identité, et coffre documentaire auto-hébergé privé. **OVHcloud constitue l’alternative à qualifier** si les tests de droits, restauration, coût ou contrat ne conviennent pas. Hetzner est une option économique à étudier si l’équipe accepte davantage d’administration système/DB.

Ce classement est un choix d’architecture, **pas un achat ni une qualification du fournisseur pour nos données**. Aucune ressource n’a été créée, aucun compte client utilisé, aucun budget engagé. La sélection finale reste à confirmer après devis et POC. Le choix antérieur de coffre auto-hébergé est conservé : aucune migration silencieuse vers S3.

## Comparatif documenté

| Option | Éléments publiés par le fournisseur | Appréciation pour GeoForest | Conditions avant choix |
|---|---|---|---|
| **Scaleway Paris** | La page produit annonce PostgreSQL 14–17, PostGIS et options standalone/HA. La documentation API indique les régions Paris, Amsterdam et Varsovie. [1](https://www.scaleway.com/en/managed-postgresql-mysql/) [3](https://www.scaleway.com/en/developers/api/managed-database-postgre-mysql) | Premier POC proposé : base managée, hébergement des composants et données en région française explicitement choisie | Version et extensions réellement disponibles sur le SKU, droits runtime/migrateur, TLS, sauvegardes et lieux de réplication à prouver |
| **OVHcloud, région française à sélectionner** | La documentation de capacités annonce PostgreSQL 14 à 18. La page française du service décrit PostGIS, réseau privé et PITR. [1](https://help.ovhcloud.com/csm/en-public-cloud-databases-postgresql-capabilities?id=kb_article_view&sysparm_article=KB0049315) [1](https://www.ovhcloud.com/fr/public-cloud/postgresql/) | Alternative solide à comparer sur une configuration équivalente, pas sur un prix de VPS seul | Disponibilité exacte de la région/offre et possibilités SQL de séparation des rôles ; pas de superuser supposé |
| **Hetzner, Allemagne ou Finlande uniquement** | Hetzner propose des implantations en Allemagne, Finlande, mais aussi hors UE : choisir explicitement une implantation UE. [1](https://www.hetzner.com/cloud/) | Variante envisagée : PostgreSQL/PostGIS administré par notre équipe sur VM. Plus de responsabilité d’exploitation ; pas mon choix initial sans DBA/astreinte identifiés | Sauvegardes DB/coffre, correctifs, restauration, chiffrement et supervision sous notre responsabilité |

**Attention aux documentations divergentes :** certaines pages API Scaleway mentionnent encore d’anciennes versions ; la page produit et le changelog des versions listent PostgreSQL 17. Cela justifie un POC plutôt qu’une compatibilité déclarée sur lecture seule. [3](https://www.scaleway.com/en/developers/api/managed-database-postgre-mysql) [1](https://www.scaleway.com/en/managed-postgresql-mysql/) [2](https://www.scaleway.com/en/docs/managed-databases-for-postgresql-and-mysql/reference-content/pg-version-updates/)

La FAQ OVHcloud documente l’usage de `pg_dump`/`pg_restore` et la HA PostgreSQL à partir de deux nœuds. Cela ne prouve pas que nos propriétaires, fonctions SECURITY DEFINER, RLS et rôles fonctionneront sans adaptation. [3](https://docs.ovhcloud.com/en/guides/public-cloud/databases/faq)

## Architecture initiale proposée — à tester, pas déjà déployée

- **Application** : point de départ 4 vCPU / 8 Gio RAM, Next.js + FastAPI derrière un frontal TLS, ports backend et DB non publics. Dimensionnement d’essai, pas garantie de capacité.
- **Identité** : VM séparée, point de départ 2 vCPU / 4 Gio, Keycloak de production avec stockage durable, TLS, correctifs et MFA réellement imposé. Ne pas déployer `start-dev` ni la base embarquée de recette en production.
- **DB** : PostgreSQL 17/PostGIS, rôle runtime non propriétaire et sans privilèges élevés, migrateur séparé, TLS avec vérification du certificat et du nom. Offre HA à comparer pour production ; mode mono-nœud seulement pour pilote explicitement non HA.
- **Coffre** : volume privé initial indicatif de 100 Gio, appartenant à l’API, quotas et alertes. Chiffrement/gestion des clés et sauvegardes à qualifier ; les permissions 0700/0400 ne sont pas du chiffrement.
- **Traitements** : scanner, parseurs et lecteurs raster à isoler au niveau OS/conteneur avec permissions/montages/egress distincts. Le code actuel emploie des sous-processus bornés : cette isolation de production n’est **pas encore livrée**. Ne pas annoncer une file de workers durable.
- **Sauvegardes** : copies chiffrées DB + coffre + versions logicielles/manifeste, dans un domaine de panne distinct et une localisation UE explicitement choisie, avec exercice de restauration. Une réplication DB seule ne sauvegarde pas les pièces.
- **Observabilité** : sondes readiness, alerte espace disque/signatures antivirus/échecs de sauvegarde, métriques sans noms de fournisseurs, coordonnées ni jetons. Désactiver les journaux de requêtes contenant les codes OIDC et liens secrets.

Avec un coffre local et une seule VM applicative, **l’application reste un point de panne unique**, même si PostgreSQL est HA. Je recommande ce compromis uniquement pour un pilote contrôlé avec reprise documentée. Une disponibilité contractuelle de bout en bout exige une architecture supplémentaire à concevoir/tester ; ne pas multiplier les replicas API avec des coffres locaux divergents.

## Coût : enveloppes de planification, pas devis

**Hypothèse de travail à confirmer** : petit pilote B2B, 10 organisations, 50 utilisateurs, 10 000 parcelles, 20 Gio de documents, scans et analyses à la demande. Aucun benchmark de charge sur ce profil n’est revendiqué.

| Scénario proposé | Enveloppe indicative HT/mois | Ce que ce montant signifie |
|---|---:|---|
| Pilote contrôlé, DB mono-nœud | **150–300 €** | Provision de planification pour compute, DB, stockage, sauvegardes et réseau ; pas un tarif fournisseur relevé |
| Première exploitation avec DB HA | **300–600 €** | Provision plus large pour nœud(s) DB supplémentaire(s), marge et sauvegardes ; ne rend pas l’application complète HA |

Ces fourchettes sont **mes estimations d’architecture**, à remplacer par un devis/calculateur une fois volumes et services choisis. Elles excluent temps d’exploitation/astreinte, support premium, audits, travaux de développement, domaine et services externes éventuels. Le poste humain peut dépasser la facture d’infrastructure. Ne pas engager de réservation annuelle avant qualification.

**Repère fournisseur, distinct de ces estimations :** la page française OVHcloud consultée affiche le plan PostgreSQL Production « à partir de 69,277 € HT/mois/nœud » avec deux nœuds, soit un ordre de grandeur minimal calculé de **138,55 € HT/mois pour la DB seule**, à confirmer au panier selon région et offre. Ce n’est pas le coût de GeoForest complet. [1](https://www.ovhcloud.com/fr/public-cloud/postgresql/)

Scaleway publie une tarification séparant les tailles de DB, stockage et sauvegardes ; ne pas comparer une colonne d’engagement ou une promotion à un tarif sans engagement. [1](https://www.scaleway.com/en/pricing/managed-databases/)

## Garde-fous de conservation et résidence

Les sauvegardes de serveur Hetzner sont quotidiennes avec sept emplacements et **n’incluent pas les volumes attachés**. Un coffre placé sur volume nécessite donc une sauvegarde distincte : ne pas cocher « backups activés » comme preuve de sauvegarde documentaire. [1](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/)

Une région UE ne suffit pas à conclure à la conformité RGPD ou EUDR. Avant contrat : vérifier DPA, sous-traitants, support et accès administrateurs, régions des sauvegardes/logs, transferts éventuels, export/réversibilité, effacement et conservation. Une rétention technique de quelques jours n’est pas l’archivage des dossiers de diligence. Les durées et obligations doivent être qualifiées dans la politique de conservation.

## Test éliminatoire avant commande de production

1. Obtenir devis régional et conditions contractuelles, sans engagement long.
2. Vérifier le couple PostgreSQL/PostGIS effectif, installer les migrations 0001→0007 avec les rôles séparés.
3. Prouver que le runtime n’est ni propriétaire ni membre d’un rôle privilégié ; readiness verte ; accès inter-tenant refusés.
4. Tester transactions SERIALIZABLE, verrous advisory, helpers SECURITY DEFINER, PostGIS, chargement des références et restauration des propriétaires/ACL.
5. Tester TLS DB/IdP, certificats, sauvegarde cohérente DB/coffre et révocation des accès restaurés.
6. Qualifier antivirus et sandbox, mémoire/CPU/volumes, egress forestier et alertes avec les modules activés.
7. Mesurer RPO/RTO et charge, documenter les résultats, puis seulement décider de l’ouverture.

**Proposition de décision : autoriser d’abord le dossier de qualification Scaleway Paris, pas la mise en production.** L’infrastructure payante ne doit être créée qu’après validation explicite du devis et du périmètre.
