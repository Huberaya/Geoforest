# API du chantier 1

Même origine navigateur. JSON ; identité par cookie opaque, jamais par `user_id` fourni par le client. Toute mutation exige `Origin` correspondant à PUBLIC_ORIGIN et `X-CSRF-Token` obtenu via `/me`.

| Méthode | Chemin | Contrat |
|---|---|---|
| GET | /api/auth/login | Redirection OIDC, PKCE/state/nonce |
| GET | /api/auth/callback | Échange code, validation du jeton ID, session serveur |
| POST | /api/auth/logout | Révocation locale, 204 |
| GET | /api/v1/me | user, csrf_token, organizations, environment, états MFA |
| POST | /api/v1/organizations | `{name}` → organisation 201 ; crée appartenance Admin et audit atomiques |
| PATCH | /api/v1/organizations/{uuid} | `{name,version}` → nouvelle version ; Admin ; conflit 409 |
| GET | /api/v1/organizations/{uuid}/members | Liste limitée à l'organisation ; Admin |
| PUT | /api/v1/organizations/{uuid}/members | `{email,role,supplier_id?}` ; compte déjà connecté avec email vérifié ; UUID supplier obligatoire exclusivement pour Supplier |
| DELETE | /api/v1/organizations/{uuid}/members/{user_uuid} | Révocation ; Admin ; dernier Admin protégé ; 204 |
| GET | /api/v1/organizations/{uuid}/audit?limit=50 | Admin/Compliance Manager ; limite 1..100 ; événements les plus récents |
| GET | /health/live | Vivacité sans accès DB |
| GET | /health/ready | Vérifie version de migration et PostGIS |

401 : session absente/expirée/révoquée. 403 : permissions, MFA ou CSRF. 404 : organisation non accessible. 409 : conflit de version/dernier administrateur/quota. 413 : corps supérieur à 64 Kio. 422 : entrée invalide. 429 : limitation de débit. 503 : DB indisponible, message sans détail SQL.

Les anciennes routes métier, y compris audit/export, répondent 401 sans identité et 410 une fois authentifié. Aucun fallback vers le prototype. Documentation OpenAPI non exposée publiquement ; schéma exportable par le script de documentation. Les DTO frontend sont actuellement typés manuellement, non générés ; génération du client à intégrer au développement des modules métier.
