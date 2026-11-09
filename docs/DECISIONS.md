# Décisions de conception tracées

Un choix explicite se relit dans un an. Un choix implicite se relit comme un
oubli. Ce fichier consigne les décisions qui ont un coût, avec leur motif et
la condition qui les ferait changer.

---

## D-001 — Pas de parcours de diligence raisonnée simplifiée

**Date :** 05/11/2026 · **Contexte :** C6e · **Statut :** appliqué

**Décision.** Toutes les origines passent par le **parcours de diligence
raisonnée complet**, y compris celles classées low-risk à l'annexe du règlement
d'exécution (UE) 2025/1093. Aucune pièce n'est allégée, aucun écran n'est
raccourci, aucun avertissement n'allège le parcours.

**Ce que le règlement permet.** L'article 13 du règlement (UE) 2023/1115 ouvre
la **diligence raisonnée simplifiée** aux produits dont toutes les matières
proviennent de pays classés low-risk. Le Ghana, l'Inde, le Kenya, la Thaïlande,
le Vietnam, le Costa Rica et 134 autres pays y sont classés. Un opérateur qui
s'en tient à ces origines pourrait donc, en droit, ne pas mener d'évaluation ni
d'atténuation des risques.

**Pourquoi ne pas l'implémenter.**

1. **La simplification ne vaut que si *tout* est low-risk.** Un seul lot
   d'origine standard dans un produit fait retomber l'ensemble sous le régime
   complet. Un parcours allégé déclenché par le pays d'une parcelle, alors que
   le produit en mélange plusieurs, produirait une diligence insuffisante sur
   un dossier qui se présente comme complet. C'est le sens de l'erreur qui
   coûte cher.
2. **Le mélange et la contournement restent à évaluer** même sous le régime
   simplifié. La simplification ne supprime pas cette étape, elle la déplace.
   Un parcours raccourci devrait donc conserver une partie du travail — ce qui
   rend le gain réel plus faible qu'il n'y paraît.
3. **Le classement est révisable.** L'article 29(2) prévoit une révision
   « aussi souvent que nécessaire ». Une architecture qui suppose des origines
   durablement low-risk devra être défaite à la première révision.
4. **Le coût d'un parcours en trop est nul pour l'opérateur.** Il collecte des
   pièces qu'il possède déjà ; il ne perd aucun droit. Le coût d'un parcours en
   moins est un dossier non opposable.

**Conséquence assumée.** Sur une origine ghanéenne, l'outil impose une
évaluation et une atténuation des risques que le règlement n'exige pas. C'est
un surcroît de travail, pas une non-conformité. Il doit être dit, pas caché :
voir `docs/EUDR_COMPLIANCE_GUIDE.md` §6.

**Ce qui ferait changer la décision.** Une demande commerciale explicite d'un
client dont l'approvisionnement est mono-origine low-risk, **et** la capacité
de vérifier que le produit entier est mono-origine. Le jour où ce besoin
apparaît, la voie raisonnable est un régime simplifié **au niveau du produit**,
jamais au niveau d'une parcelle.

**État du code.** Aucune condition de risque pays ne commande une pièce ou une
étape. `check:parcours-ddr` le vérifie et empêche l'introduction silencieuse
d'un raccourci par niveau de risque.

---

## D-002 — Le référentiel pays est daté et versionné

**Date :** 05/11/2026 · **Contexte :** C6b · **Statut :** appliqué

Le classement low/standard/high vient du règlement d'exécution (UE) 2025/1093,
recopié dans `src/lib/eudr/benchmark-pays.ts` avec sa source et sa date de
vérification. Une classification sans date ne peut pas expliquer une analyse
passée. Toute révision produira une nouvelle version du fichier, jamais une
modification silencieuse.

---

## D-003 — Les frontières pays sont un fichier généré et commité

**Date :** 05/11/2026 · **Contexte :** C6c · **Statut :** appliqué

Natural Earth 1:50m, domaine public, généré par
`scripts/generer-frontieres-pays.ts` et commité. Pas une dépendance : la
résolution du pays d'origine est une donnée réglementaire, elle doit être
stable et auditable. Une bibliothèque qui change sous nos pieds rendrait une
analyse passée inexplicable.

---

## D-004 — Une analyse absente ne produit pas de niveau de risque

**Date :** 05/11/2026 · **Contexte :** C6d · **Statut :** appliqué

`risk_level` d'une parcelle vaut `null` quand aucune analyse n'a été menée, y
compris dans un pays low-risk. Le niveau du pays est une entrée du
raisonnement, jamais son résultat. Voir `src/lib/eudr/risque-parcelle.ts`.

---

## D-004 — Le contrôle du dossier DDR est écrit avant sa correction, et n'entre pas en CI

**Date :** 06/11/2026 · **Contexte :** C7 · **Statut :** révisée le 06/11/2026
après la correction (voir § « Révision »)

**Décision initiale.** `scripts/check-validateur-ddr.ts` est livré **rouge**
(3/9) et **n'est pas branché** dans `.github/workflows/ci.yml`.

**Pourquoi dans cet ordre.** Écrire la correction d'abord, puis un contrôle qui
l'épouse, produit un contrôle vert par construction — il n'a jamais rien
prouvé, il constate ce qu'on vient d'écrire. Ici le contrôle est écrit contre le
défaut : il échoue précisément sur les neuf conditions qu'un dossier devrait
satisfaire, et il passera quand elles seront tenues.

**Pourquoi pas en CI.** Une barrière rouge en permanence ne protège rien : elle
bloque toutes les fusions et pousse à désactiver le dispositif — c'est
exactement ce qui a été reproché au banc pays avant C6c. Le contrôle
`check:parcours-ddr` est en CI **parce qu'il est vert** ; celui-ci attend.

**Falsifiabilité.** Simuler la correction (score retiré du corps, validateur
appelé avant la transition) le fait passer de 3/9 à 5/9. Simuler le retrait du
contrôle aval le fait revenir à 3/9. Il mesure donc bien quelque chose.

**Ce qui le fera changer.** Le jour où la correction est livrée et verte, ce
contrôle rejoint la CI — et cette décision est mise à jour en même temps, pas
contournée.

**Ce que le diagnostic a établi, et qui reste vrai tant que ce contrôle est
rouge.** Un dossier créé par `POST` — `plotsCount: 0`, `completenessScore: 0`,
aucune tâche, aucun fournisseur — peut passer `READY_FOR_DECLARATION` en un
clic, et recevoir `completenessScore: 100` dans la même requête. Le produit
enregistre une affirmation de l'utilisateur ; il ne constate rien.

**Révision du 06/11/2026 — la correction est livrée, le contrôle entre en CI.**

Le contrôle est passé de **3/16** à **16/16**, et il est désormais branché
(étape « Validateur de dossier DDR »). Ce qui a changé :

1. `validateur-dossier.ts` : fonction **pure**, 8 contrôles, réutilise
   `verifierOrigineExportable` au lieu de dupliquer le verdict d'origine.
2. `PATCH status=READY_FOR_DECLARATION` appelle l'examen et renvoie **409** en
   énumérant les manques, avec pour chacun l'action qui le lève.
3. `completenessScore` n'est plus écrit depuis le corps de requête ; il est
   **calculé** par l'examen, et la réponse signale explicitement qu'il a été
   ignoré (`completeness_score_ignore`) plutôt que de laisser croire qu'il a
   été retenu.
4. `plotsCount` et `totalAreaHa` sont dérivés des parcelles examinées.
5. Migration `0008` : `parcel_audits.plot_id`, clé étrangère **composite**
   (parcelle + organisation) — une analyse d'une organisation ne peut pas viser
   la parcelle d'une autre.
6. Les formulaires de parcelle et de dossier transmettent leur fournisseur :
   sans lui, aucune parcelle n'est rattachable à un dossier.

**Ce que la rédaction du contrôle a appris, et qui vaut d'être gardé.**

Le premier jet cherchait `examiner(` entre deux bornes de texte. Après
remplacement de la condition par `if (false)`, il restait **vert** : le texte de
l'appel était intact, simplement inatteignable. C'est le même piège que la
branche `if False:` du backend, rencontré une seconde fois dans le même
chantier. Le contrôle exige désormais la condition **littérale** — toute
élargissement (`&& true`) ou désactivation fait rougir.

Six conditions **exécutent** le validateur plutôt que de lire du code, dont une
qui exige qu'un dossier complet soit **accepté**. Sans elle, un validateur qui
refuse tout passerait les cinq autres : un mur, pas une validation.

---

## D-005 — Le dossier DDR joint ses parcelles par le fournisseur, pas par un lien direct

**Date :** 06/11/2026 · **Contexte :** C7 · **Statut :** appliqué, limite assumée

**Décision.** Le validateur de dossier lit les parcelles par
`gf_plots.supplier_id = gf_due_diligence_statements.supplier_id`. Le schéma ne
porte **aucune** table de liaison dossier ↔ parcelle.

**Pourquoi ce n'est pas le grain idéal.** Un dossier porte sur un produit, et un
fournisseur peut livrer plusieurs produits sur plusieurs parcelles. La jointure
actuelle examine donc potentiellement des parcelles qui ne sont pas dans le lot
déclaré — elle est **plus large** que le dossier, jamais plus étroite. Ce sens
de l'erreur est choisi : mieux vaut examiner une parcelle de trop que déclarer
conforme une parcelle jamais regardée.

**Conséquence visible, et qui doit rester visible.** Un dossier sans fournisseur
n'examine aucune parcelle. Le validateur ne conclut pas « dossier vide » : il
remonte le manque `SANS_PARCELLE`, qui dit à l'utilisateur de rattacher ses
parcelles. Les deux formulaires (parcelle, dossier) exigent désormais le
fournisseur pour cette raison.

**Ce qui ferait changer la décision.** Un client dont les lots mélangent
plusieurs fournisseurs, ou un contrôle qui exige de prouver qu'une parcelle
précise est dans un produit précis. La correction est alors une table de liaison
`gf_dds_plots` (dossier, parcelle, organisation), et la migration correspondante
— jamais un élargissement silencieux de la jointure actuelle.

---

## D-006 — Export TRACES et dossier DDR sont deux constats indépendants

**Date :** 06/11/2026 · **Contexte :** C7 · **Statut :** appliqué, écrit dans l'endpoint

**Décision.** L'export (`POST /api/v1/export/traces`) reste attaché à une
**analyse de parcelle** et ne se rattache pas au dossier. La différence de grain
est écrite dans l'en-tête de la route, pas seulement ici.

**Pourquoi.** Une analyse porte sur une parcelle — une géométrie, une date de
production, une mesure de couvert. Un dossier porte sur un produit — un lot, un
poids net. Un produit peut agréger plusieurs parcelles : rattacher l'export à un
dossier obligerait à choisir quelle parcelle est « la » preuve, et ce choix
serait arbitraire.

**Ce que cela implique pour l'opérateur.** Un dossier « prêt à déclarer » et un
export réussi sont **indépendants** : aucun ne vaut preuve que l'autre a eu
lieu. La déclaration exige les deux, et c'est à l'opérateur de les rapprocher —
aucun composant du produit ne le fait, et le produit ne doit pas laisser croire
le contraire.

---

## D-007 — Un contact de limite n'est pas un recouvrement

**Date :** 06/11/2026 · **Contexte :** C8 · **Statut :** appliqué

**Décision.** La détection de chevauchement rend **trois** états — `AUCUN`,
`CONTACT`, `RECOUVREMENT` — et seul `RECOUVREMENT` est remonté à l'utilisateur.

**Pourquoi trois et pas un booléen.** Deux exploitations voisines partagent une
clôture : leurs polygones se touchent sur un segment, parfois sur une arête
entière, et c'est le cas **normal**. Un booléen « se chevauchent » classerait ce
cas en positif, produirait une alerte sur chaque parcelle voisine, et au bout de
trois alertes plus personne ne lirait rien — y compris le vrai doublon.

**Ce qui a été mesuré.** En promouvant le contact en recouvrement,
`check:chevauchement` passe de 21/21 à 19/21. Le contrôle refuse ce
comportement, ce qui est sa raison d'être.

**Le sens de l'erreur.** Un recouvrement signalé est réel. Une absence de
signal ne prouve rien : ni hors organisation (la RLS interdit de voir), ni pour
les parcelles-points (pas de surface), ni si les cadres englobants n'ont pas été
remplis (`npm run db:backfill-bbox`). Ces trois limites sont écrites dans
`docs/EUDR_COMPLIANCE_GUIDE.md` §3 bis.

---

## D-008 — Le chevauchement est constaté et journalisé, jamais bloquant

**Date :** 06/11/2026 · **Contexte :** C8 · **Statut :** appliqué

**Décision.** Un recouvrement n'empêche pas la création de la parcelle. Il est
renvoyé dans la réponse (`recoupements`) **et** écrit dans le journal d'audit.

**Pourquoi pas de refus en 422.** Refuser bloquerait des découpages légitimes,
et le produit n'a pas à trancher à la place de l'exploitant.

**Pourquoi le journal, et pas seulement la réponse.** Un avertissement qui
n'existe que dans un corps HTTP est perdu dès que l'écran ne l'affiche pas.
C'est le défaut du `completenessScore` reçu du client, corrigé en C7 : un signal
qui ne survit pas à sa requête n'est pas un signal. Le journal, lui, reste
relisible — et c'est ce qui permettra de constater après coup qu'un dossier
s'appuyait sur des parcelles qui se recouvraient.

**Ce qui ferait changer la décision.** Une exigence d'autorité ou d'acheteur
qui demande le blocage. La correction est alors un refus conditionné à un
recouvrement **au-delà d'un seuil de surface** — ce qui suppose d'abord de
savoir calculer cette surface, donc de traiter le point laissé ouvert ci-dessus.
