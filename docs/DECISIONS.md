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

**Date :** 06/11/2026 · **Contexte :** C7 · **Statut :** appliqué

**Décision.** `scripts/check-validateur-ddr.ts` est livré **rouge** (3/9 au
06/11/2026) et **n'est pas branché** dans `.github/workflows/ci.yml`.

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
