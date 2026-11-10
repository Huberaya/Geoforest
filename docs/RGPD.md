# RGPD — ce que GeoForest fait, et ce qu'il ne fait pas

**Dernière vérification : 06/11/2026.** Ce document est vérifié par
`npm run check:rgpd` (33 contrôles), qui échoue si le code et le texte
divergent : une colonne personnelle ajoutée au schéma sans être déclarée sur la
carte des données fait échouer la commande.

---

## 1. Qui est responsable de quoi

| Rôle | Qui | Ce que cela implique |
|---|---|---|
| **Responsable de traitement** | L'organisation cliente, opérateur ou négociant EUDR | Choisit les finalités, répond des demandes d'accès et d'effacement de ses propres utilisateurs et fournisseurs |
| **Sous-traitant** | L'éditeur de GeoForest | Traite les données pour le compte du responsable, sur instruction, et ne les utilise à aucune autre fin — en particulier jamais pour du profilage ou de la publicité |
| **Hébergeur** | Le prestataire d'hébergement de l'application et de la base | Conserve les journaux d'infrastructure et les sauvegardes ; ce ne sont pas des données auxquelles le produit a accès |

**Point de contact pour toute demande ou violation :** `dpo@geoforest.eu`.
**Décision en cas de violation :** le responsable de traitement de l'organisation
concernée, sur alerte de l'éditeur. **Exécution technique :** l'exploitant de la
plateforme pour l'éditeur, l'administrateur de l'organisation pour le client.

⚠️ Cette répartition est celle d'un éditeur de logiciel. Si une organisation
cliente utilise GeoForest pour **son propre** compte sans la vendre, elle devient
responsable ET sous-traitant : c'est à elle de tenir son registre. Ce document
décrit ce que le produit fait, pas ce que chaque client doit écrire.

---

## 2. La carte des données

La source de vérité est **le code** : `src/lib/rgpd/carte-donnees.ts`. Elle est
publiée ici pour être consultable par qui doit tenir le registre, mais c'est la
structure TypeScript qui est confrontée au schéma réel à chaque exécution de
`check:rgpd`.

| Donnée | Où | Finalité | Base légale | Conservation |
|---|---|---|---|---|
| Identité et e-mail de l'utilisateur | `gf_users` | Authentifier, attribuer des droits | Contrat (art. 6.1.b) | Relation + 5 ans |
| Adresse IP, agent utilisateur | `gf_sessions` | Détecter un vol de jeton | Intérêt légitime (6.1.f) | **90 jours** après expiration, puis effacés |
| Clé de fenêtre de connexion | `gf_login_attempts` | Limiter le bourrage d'identifiants | Intérêt légitime (6.1.f) | **7 jours**, puis supprimés |
| Journal d'audit | `gf_audit_logs` | Traçabilité des diligences | Obligation légale (6.1.c) | 5 ans (EUDR art. 12) |
| Coordonnées de contact fournisseur | `gf_suppliers` | Obtenir les pièces de légalité | Contrat / intérêt légitime | Relation + 5 ans |
| Producteur, opérateur | `parcel_audits` | Identifier l'origine | Obligation légale (6.1.c) | 5 ans (EUDR art. 12) |
| Géométrie de parcelle | `gf_plots`, `parcel_audits` | Localiser, analyser, déclarer | Obligation légale — art. 9.1.d EUDR | 5 ans |
| Adresse, EORI de l'organisation | `gf_organizations` | Mention obligatoire de la déclaration | Obligation légale (6.1.c) | Durée de vie + 5 ans |

**Une donnée personnelle n'est jamais conservée « au cas où ».** Chaque ligne du
tableau porte une durée, et la purge (§4) l'applique pour ce qui est technique.

---

## 3. Les droits des personnes, et comment ils s'exercent

| Droit | Ce qui existe dans le produit |
|---|---|
| **Accès (art. 15)** | `GET /api/v1/rgpd/export` rend toutes les données de l'organisation, avec la carte des données. Réservé aux administrateurs (`org:manage`) : l'export contient les données de tous les membres. |
| **Portabilité (art. 20)** | Le même export, en JSON structuré. |
| **Rectification (art. 16)** | Les écrans d'édition des fournisseurs, parcelles et utilisateurs. |
| **Effacement (art. 17)** | Partiel, et c'est **assumé** : voir ci-dessous. |
| **Opposition (art. 21)** | Le produit ne profile personne et n'envoie aucune prospection. Il n'y a donc rien à quoi s'opposer — c'est vérifié, pas supposé. |

### Pourquoi l'effacement est partiel

Le droit à l'effacement ne s'applique pas lorsqu'une **obligation légale** impose
la conservation (art. 17.3.b). L'EUDR impose de conserver 5 ans les preuves de
diligence : un dossier, une parcelle, une analyse ne s'effacent pas sur demande,
parce qu'ils sont la preuve qu'un opérateur a fait son travail.

Ce qui **s'efface** effectivement :

- les données de sécurité (adresse IP, agent utilisateur) après la fenêtre de
  purge ;
- les coordonnées de contact d'un fournisseur, sur demande, lorsque la relation
  est terminée ;
- les données personnelles recopiées dans le journal d'audit **à l'écriture**
  (`assainir-audit.ts`) — parce que le journal est immuable, et qu'un effacement
  qui laisserait la donnée dans une copie ne serait qu'un déplacement.

⚠️ **Ce que le produit ne fait pas encore :** il n'existe pas de route
d'effacement en libre-service. Une demande d'effacement se traite par
l'administrateur de l'organisation, avec l'assistance de l'éditeur. C'est une
lacune d'ergonomie, pas de conformité — mais elle est écrite, parce qu'un
document qui ne liste pas ses manques se lit comme complet.

---

## 4. La purge et son exécution

```bash
npm run db:purge-rgpd -- --essai                      # compte, n'efface rien
GF_PURGE_CONFIRMEE=2026-11-06 npm run db:purge-rgpd   # exécute
```

- **Sessions expirées depuis plus de 90 jours :** `ip` et `user_agent` passent à
  `NULL`. ⚠️ La **ligne** est conservée : la famille de jetons sert à détecter
  la réutilisation d'un jeton volé, et supprimer la ligne détruirait cette
  capacité. Ce qui n'a plus de finalité, ce sont les données personnelles.
- **Tentatives de connexion de plus de 7 jours :** lignes supprimées. La table ne
  sert qu'à compter dans une fenêtre glissante.

**Garde-fous**, vérifiés par exécution : refus si `NODE_ENV=production`, refus si
la base n'est pas déclarée jetable et qu'aucune confirmation datée du jour n'est
fournie. Une purge accidentelle ne se rattrape pas.

**Ce que la purge ne touche jamais :** les données métier (dossiers, parcelles,
analyses, documents) et le journal d'audit.

### Fréquence

La purge doit être **planifiée** — un cron mensuel suffit pour les durées en jeu.
⚠️ **Elle ne l'est pas encore.** Tant que personne ne l'exécute, les durées du
tableau §2 sont une intention, pas un fait. C'est le seul point de ce document
qui dépend d'une action d'exploitation, et il est nommé pour cette raison.

---

## 5. Violation de données : la procédure des 72 heures

L'article 33 impose de notifier à l'autorité de contrôle **dans les 72 h** après
avoir eu connaissance de la violation. Sans procédure écrite, ce délai est perdu
avant que quiconque sache par où commencer.

### Qui fait quoi

| Quand | Qui | Quoi |
|---|---|---|
| H+0 | Toute personne constatant l'incident | Alerte `dpo@geoforest.eu`. Ne rien supprimer, ne rien « réparer » avant d'avoir conservé les traces. |
| H+2 | Responsable de traitement de l'organisation concernée | Qualifie : données concernées, personnes touchées, risque encouru. Décide de notifier. |
| H+24 | Exploitant de la plateforme | Contient : révoque les jetons, coupe l'accès compromis, préserve les journaux. |
| **H+72 au plus tard** | Responsable de traitement | **Notification à la CNIL** si le risque est avéré. |
| Après | Responsable de traitement | Information des personnes concernées si le risque est **élevé** (art. 34). |

### Ce que l'on peut retrouver, et ce que l'on ne peut pas

- **Peut** : le journal d'audit est chaîné par empreinte et append-only. Une
  ligne supprimée ou modifiée rompt la chaîne à cet endroit précis — on saura
  qu'une altération a eu lieu, et où.
- **Peut** : les sessions portent IP et agent utilisateur, ce qui permet de
  repérer une connexion depuis un contexte inhabituel.
- **Ne peut pas** : le produit ne conserve **aucun** jeton en clair. Un jeton
  volé est donc indétectable par sa valeur ; il ne se voit que par son usage.

### Ce qu'il faut consigner dans le registre des violations

Date de connaissance, nature, données et personnes concernées, conséquences
probables, mesures prises, décision de notifier ou non — et la **raison** de
cette décision. Une non-notification doit être motivée : elle peut être
contrôlée.

---

## 6. Quota de stockage

`ORGANIZATION_STORAGE_QUOTA` (en octets, défaut **20 Go**) borne ce qu'une
organisation peut déposer. Ce n'est pas une limite commerciale : le stockage est
un répertoire partagé, et sans quota une organisation remplit le disque de
toutes les autres. Un dépassement est refusé **avant écriture**, en **413**, avec
l'usage et la limite annoncés.

⚠️ Le quota compte l'usage déclaré en base (somme des tailles de versions), pas
les octets réellement présents sur le disque. L'écart, constitué des pièces
orphelines, est rattrapé par la purge des pièces détachées (`depot.ts`).

---

## 7. Traceurs et cookies

**Aucun traceur publicitaire ou analytique n'est posé**, et c'est **vérifié** par
`check:rgpd` : la commande échoue si `gtag`, Google Tag Manager, Plausible,
Hotjar, Matomo ou un pixel de réseau social apparaît dans le code source ou les
dépendances.

Le seul cookie écrit est celui de session, nécessaire au service : il est donc
exempté de consentement (art. 82 de la loi Informatique et Libertés). **Il n'y a
donc pas de bandeau de consentement, et son absence est correcte** — poser une
bannière qui ne recueille rien serait du théâtre.

⚠️ Le jour où un traceur serait ajouté, `check:rgpd` passera au rouge et
réclamera un consentement. C'est le garde-fou : on ne peut pas introduire un
traceur par inadvertance.

---

## 8. Ce qui n'est pas fait, et qui reste dû

Ce document serait faux s'il s'arrêtait avant cette section.

| Point | État | Ce qu'il faudrait |
|---|---|---|
| **Facturation** | **Absente du produit** — aucun code, aucun prestataire | Un compte prestataire et une décision commerciale. Ce n'est pas un chantier technique : c'est une décision que le dépôt ne peut pas prendre. |
| **Conditions générales** | **Absentes** | Un texte juridique engageant, rédigé et relu par un juriste. Un fichier de plus dans `docs/` ne vaudrait pas CGU. |
| **Purge planifiée** | **Non planifiée** | Un cron mensuel. Le script existe, personne ne l'appelle. |
| **Effacement en libre-service** | **Absent** | Une route et un écran. Aujourd'hui : traitement manuel par l'administrateur. |
| **Registre des sous-traitants** | **Non tenu** | La liste des prestataires (hébergeur, e-mail, antivirus s'il est activé) avec leur localisation. Dépend de l'exploitation réelle. |
| **Analyse d'impact (AIPD)** | **Non faite** | Le produit traite des données de localisation à grande échelle : une AIPD est probablement requise. À décider avec le responsable de traitement. |
| **Transferts hors UE** | **Non évalués** | Dépend de l'hébergeur et du fournisseur satellite retenus. Non tranchable depuis le code. |
| **Chemin GFW réel** | **Non vérifié** | Aucune clé n'a jamais été configurée : le fournisseur satellite n'a jamais répondu en situation réelle (C9). Sans effet sur le RGPD tant qu'aucune donnée ne sort. |

---

## 9. Comment vérifier ce document

```bash
npm run check:rgpd          # 33 contrôles : carte, export, purge, journal, quota, traceurs, procédure
npm run db:purge-rgpd -- --essai   # ce que la purge effacerait, sans rien effacer
```

`check:rgpd` confronte le texte de ce document et la carte des données au code
réel. Si une colonne personnelle est ajoutée au schéma sans être déclarée, la
commande échoue : ce document ne peut pas vieillir en silence.
