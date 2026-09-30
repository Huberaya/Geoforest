# Chantier 4 — audit Vercel authentifié

29 septembre 2026. Nouvel accès temporaire fourni par le propriétaire ; **GET uniquement, aucune mutation cloud ni accès Neon**. Preuve filtrée : `preuves-chantier-4/vercel-authenticated/audit.json` (aucun secret, email ou configuration chiffrée enregistré).

> **Rectification du 30 septembre 2026 :** le fichier privé runtime Neon préparé au lot 08b a été retrouvé et testé avec succès. L’absence d’accès Neon évoquée dans les échanges était un diagnostic incomplet, pas une absence de credentials. Voir [la recette 04d](04d-recette-geospatiale-complete.md). Les observations Vercel historiques ci-dessous restent exactes à leur date.

## Cause désormais vérifiée

- Projet frontend `geoforest-eabr`, framework Next.js, racine du dépôt.
- Production READY/PROMOTED : commit **a924ba85839cfb4921d3b1983dbc10d3e3e9299c**, branche `chantier-2/collecte-fournisseurs`, déploiement `dpl_4hpypVn7UZ5ywE9BE3moMRJRCkRt`.
- Preview READY/STAGED : commit **7a2da36a76c7bc16b9bb080853ca649fc0d8b68e**, branche `chantier-8/security-release`, déploiement `dpl_5RKxTvfum6AKc8fKi1BEsncgnC5E` : accueil public et routes de comptes restés en Preview.
- La branche de production automatique configurée pour le lien Git est `main`. Cela ne signifie pas que le commit actuellement promu vient de main : le déploiement actif ci-dessus vient du chantier 2.
- Les six variables visibles (AUTH_PROVIDER, APP_ENV, CLERK_ISSUER et trois NEXT_PUBLIC_CLERK_*) ciblent **Preview seulement**, aucune Production dans cette liste.
- Un seul projet visible avec ce jeton, le frontend. Aucun backend parmi les projets accessibles ; la portée restreinte ne permet pas de conclure à l'absence de tout backend dans d'autres comptes.
- Le déploiement porte le plan **Hobby**. Le détail de facturation équipe n'est pas accessible avec ce jeton ; aucun abonnement n'a été modifié. Ne pas annoncer un lancement commercial qualifié sur ce plan.

## Pourquoi ne pas promouvoir aveuglément la Preview

L'examen local du commit exact 7a2da36 montre encore le repli `/api/*` vers `127.0.0.1:8000` lorsque `API_INTERNAL_URL` manque. Promouvoir ce déploiement rendrait l'accueil visible mais **ne corrigerait pas l'erreur du backend** et publierait une version antérieure aux gardes de routage et aux correctifs récents du chantier 4.

Le code courant refuse désormais ce repli sur Vercel. Le backend actuel exige une configuration qualifiée de production, une identité Clerk appropriée et des credentials Neon runtime minimaux. Les credentials DB présents dans le `.env` local sont uniquement locaux ; ils n'ont pas été utilisés sur le cloud. Ne pas copier ce `.env` vers Vercel.

Le domaine reste différé. Aucun contournement de l'interdiction Clerk développement/DB distante, des gardes RLS ou des prérequis d'hébergement n'est effectué. L'autorisation de publication est acquise mais n'autorise pas à inventer les paramètres manquants ou à annoncer une application prête.

## Choix de périmètre pour l'action suivante

1. **Publication limitée de l'accueil sur Production**, avec état explicite « service métier indisponible » et refus API contrôlé, sans collecter de documents ni simuler une session métier. Ce mode public limité reste à implémenter/tester : aucune promotion n'a été effectuée par cet audit.
2. **Raccordement de l'application complète avant publication** : réunir les paramètres runtime autorisés, résoudre le mode d'identité/hébergement admissible sans achat implicite, qualifier le backend puis publier le bon commit et vérifier les parcours du chantier 4.

Il ne manque plus seulement l'accès Vercel : **la dépendance backend/identité et le périmètre de publication sont maintenant explicites**. Aucun nouveau token GitHub requis pour ce constat ; aucun ancien jeton réutilisé.

## Bilan

- **PRÊT :** cause de l'écart Preview/Production vérifiée via API authentifiée, état de départ enregistré pour une future action contrôlée.
- **À FINALISER :** périmètre public limité ou configuration complète du backend et de l'identité.
- **BLOQUÉ :** recette géospatiale publique, tant que l'API métier n'est pas raccordée.
- **RISQUE RÉGLEMENTAIRE :** accès à un site ou présence de pages de connexion ne prouve ni exploitation sécurisée ni conformité EUDR.
- **PROCHAINE ACTION :** choisir le périmètre ci-dessus puis exécuter une publication réellement vérifiée sur Production ; ne pas repartir sur un autre chantier.
