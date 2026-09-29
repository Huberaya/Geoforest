# Chantier 8 — Clerk : premier incrément serveur

29 septembre 2026 — **module de vérification développé et testé, non activé dans l’application**.

> Suite livrée : [raccordement local HTTP/frontend et recette automatisée](08d-clerk-raccordement-local.md). Le présent rapport décrit le premier incrément historique.

## Objectif et périmètre

Commencer l’intégration de l’instance Clerk développement fournie, sans remplacer prématurément le parcours OIDC/Keycloak existant, modifier Clerk ou toucher à Neon Production. Les clés réelles restent privées hors dépôt. Aucun achat, changement de compte, création d’utilisateur ou appel réseau à Clerk n’a été effectué pendant ce bloc de développement.

Le précontrôle précédent avait confirmé l’accès Backend API et la correspondance des JWKS public/serveur. Ce précontrôle n’était pas une recette d’authentification utilisateur.

## Fichiers

- `backend/app/clerk_identity.py` : vérificateur indépendant, réservé explicitement aux instances et clés de développement.
- `backend/identity_tests/test_clerk_identity.py` : tests sans PostgreSQL et sans réseau, clés RSA éphémères et profils fictifs `example.invalid`.
- `backend/pytest.ini` et `.github/workflows/ci.yml` : ajout de cette suite aux commandes de recette futures.
- `docs/rapports/preuves-chantier-8/clerk/identity-tests.txt` : résultat local.

Authlib et HTTPX étaient déjà des dépendances déclarées du backend ; pas de nouvelle dépendance applicative ni de migration SQL.

## Contrôles implémentés

- Signature RS256, identifiant de clé, émetteur exact et origine applicative `azp` exacte obligatoire. Absence d’`azp` refusée, y compris si certains navigateurs peuvent omettre Origin.
- Jetons de session Clerk v2 uniquement ; présence et type des dates `iat`, `nbf`, `exp`, expiration, anticipation et durée maximale de cinq minutes ; tolérance horloge de cinq secondes.
- Identifiants utilisateur/session validés avant construction des chemins API ; rejet des sessions pending et des jetons d’impersonation.
- Lecture serveur de la session après vérification cryptographique : statut active et liaison exacte au sujet du jeton.
- Lecture du profil correspondant : compte non bloqué/banni, adresse principale vérifiée, tailles bornées.
- Aucun import de rôles, organisations, métadonnées ou niveau MFA depuis Clerk. Les appartenances et permissions GeoForest restent du ressort de PostgreSQL et des contrôles métier existants.
- URLs du fournisseur fixes, HTTPS, aucune redirection suivie ; secret serveur envoyé exclusivement aux appels Backend API, pas au JWKS public.
- Taille du jeton et des réponses bornée, timeout HTTP configuré. Erreurs de l’amont, réponse invalide, révocation, 429 et panne refusent l’authentification sans exposer de détails dans l’exception remontée.

Le résultat est une identité ponctuellement vérifiée, **pas** une session persistante de huit heures. Il ne doit pas être converti en session longue sans une stratégie explicite d’expiration, de renouvellement et de révocation.

## Recette exécutée

```sh
PYTHONPATH=backend .venv/bin/pytest -q backend/identity_tests
.venv/bin/ruff check backend/app/clerk_identity.py backend/identity_tests
```

**63 tests réussis en 2,80 secondes ; Ruff réussi.** Cas couverts : identité valide, refus des rôles importés, mauvais émetteur/origine, claims absents ou mal typés, expiration, durée excessive, signature et algorithme incorrects, compte bloqué, email non vérifié, session révoquée ou incohérente, timeout, redirection, erreurs API et JWKS invalide/trop volumineux.

Les 863 tests backend historiques n’ont **pas** été relancés dans ce bloc. Les résultats de restauration Neon précédents restent historiques ; ils ne doivent pas être présentés comme la validation du nouveau code. Aucun test navigateur ou mobile réalisé à ce stade, car aucun écran ni route d’authentification n’a encore été changé. L’exécution CI distante n’est pas revendiquée.

## Suite technique et dépendances

1. Raccorder le module à un mode d’authentification explicitement sélectionné et désactivé en production tant que sa qualification est incomplète.
2. Ajouter le parcours de connexion Clerk côté frontend et l’échange serveur protégé contre CSRF/login-CSRF. Lier les identités par `(issuer, subject)`, jamais par rapprochement automatique des e-mails.
3. Conserver les rôles et organisations métier existants, sans attribuer Admin à partir de claims Clerk.
4. Borner la session GeoForest à la validité de la preuve Clerk, avec renouvellement et déconnexion testés ; ne pas laisser une session locale longue survivre implicitement à une révocation Clerk.
5. Ajouter limites de fréquence, cache JWKS borné avec rotation, budget global de temps et maîtrise de la volumétrie d’appels fournisseur avant activation HTTP. Le module actuel effectue jusqu’à trois lectures par vérification valide ; ce comportement ne constitue pas une qualification de charge. Ne pas activer les logs HTTP verbeux susceptibles de contenir des identifiants de profil.
6. Tester intégration DB, erreurs, isolation inter-organisations, MFA, non-régression OIDC et E2E responsive sur base locale distincte de Neon Production. Puis recette de connexion humaine sur l’instance développement, sans fabrication de comptes distants.

Le MFA Clerk n’est pas assimilé à un `acr` OIDC. Une politique spécifique et des tests doivent être définis avant toute activation production ou affirmation d’équivalence.

## Sources de conception

Documentation officielle consultée le 29 septembre 2026 :
- https://clerk.com/docs/guides/sessions/session-tokens — claims v2, `iss`, `azp`, `sid`, dates, `sts`, `fva` et organisation.
- https://clerk.com/docs/reference/backend-api/tag/jwks/get/jwks — Backend API authentifiée et JWKS (consultée au précontrôle).

## Bilan

**PRÊT** : brique de contrôle d’identité développement et tests unitaires isolés.

**À FINALISER** : raccordement HTTP/frontend, sessions locales, contrôle MFA, protections de charge et recette complète.

**NON ACTIVÉ** : connexion Clerk dans l’application ; authentification historique inchangée. Aucun déploiement ni modification de Neon Production. Chantier 8 toujours ouvert.
