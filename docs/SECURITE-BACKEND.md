# Sécurité du backend FastAPI — état après C5

**Mesuré le 05/11/2026.** Ce document décrit ce qui a été fermé, ce qui reste
ouvert, et pourquoi.

---

## 1. Ce qui était le cas avant C5

| Défaut | Portée |
|---|---|
| **Aucune authentification** | Toutes les routes, y compris l'écriture |
| `GET /api/v1/audits` sans filtre | Renvoyait `SELECT * FROM parcel_audits ORDER BY created_at` — **tous les dossiers de toutes les organisations** |
| `GET /api/v1/audits/{id}` sans filtre | N'importe quel dossier, par identifiant |
| `CORS` avec joker `*` **et** `allow_credentials=True` | N'importe quelle origine pouvait lire les réponses |
| `/docs`, `/redoc`, `/openapi.json` ouverts | Décrivaient au passant comment interroger une API sans authentification |
| Exposé publiquement | `vercel.json` route `/fastapi/*`, `/backend/*`, `/docs`, `/openapi.json` vers ce service |

Ce n'était pas un risque théorique : l'API était joignable, et la liste des
dossiers renvoyait les noms d'opérateur, les parcelles et les verdicts.

---

## 2. Ce qui est fermé

### Fermé par défaut, pas ouvert par oubli

Sans `BACKEND_API_TOKEN`, **toutes les routes métier répondent `503`**. Un
backend mal configuré ne sert rien, plutôt que de servir tout le monde. C'est
l'inverse du comportement habituel — un service qui démarre en mode dégradé et
se contente d'avertir — et c'est délibéré : la valeur par défaut d'un service
exposé doit être l'indisponibilité.

Seule `/api/v1/health` reste ouverte. Une sonde doit répondre même mal
configurée, sinon un orchestrateur redémarre en boucle un service qui tourne.

### Trois refus distincts

| Statut | Signification | Action attendue |
|---|---|---|
| `503` | Aucun jeton configuré | L'administrateur configure `BACKEND_API_TOKEN` |
| `401` | En-tête absent ou mal formé | L'appelant envoie `Authorization: Bearer <jeton>` |
| `403` | Jeton présent, mais faux | Erreur de configuration ou tentative |

⚠️ `403` et non `401` pour un jeton faux : répondre `401` ferait réessayer
indéfiniment un client dont la configuration est fausse.

⚠️ Comparaison par `hmac.compare_digest` : une comparaison naïve laisse fuir la
longueur du préfixe correct par le temps de réponse.

### `GET /api/v1/audits` : désactivée, pas seulement protégée

Elle répond `410 Gone`.

Un jeton unique prouve « l'appelant peut parler au backend », pas « l'appelant
est cette organisation ». Ce backend n'a aucune notion d'organisation : tant
qu'il en est là, **toute route qui liste des dossiers est inter-tenant par
construction**. La protéger par un jeton aurait donné l'illusion d'une
isolation.

### CORS

Le joker est retiré de la valeur par défaut **et** écarté s'il est configuré
(`settings.cors_valides`). Méthodes limitées à `GET` et `POST`, en-têtes à
`Authorization` et `Content-Type`.

### Documentation interactive

`/docs`, `/redoc` et `/openapi.json` sont fermés sauf `BACKEND_DOCS_ENABLED=true`,
qui n'a de sens qu'en développement.

### Défaut latent corrigé au passage

`/api/v1/health` répondait **500** sur un déploiement nu : `HealthResponse`
n'acceptait que `"live"` et `"deterministic-mock"`, alors que la route produit
`"indisponible"` — précisément quand aucune source satellite n'est configurée.
La sonde tombait donc en panne exactement dans le cas où on en a besoin.

---

## 3. Ce qui reste ouvert — dette assumée

### `GET /api/v1/audits/{audit_id}` : protégée mais inter-tenant

N'importe quel porteur du jeton peut lire n'importe quel dossier, par
identifiant. La route n'est pas fermée parce qu'elle sert le parcours d'export.
La corriger suppose que ce backend connaisse les organisations — ce qui n'est
pas le cas aujourd'hui.

**Condition de sortie :** soit le backend apprend l'organisation (jeton par
organisation, ou jeton portant une revendication d'organisation), soit la route
disparaît au profit de l'application Next.js.

### SQLite

Le backend illustre le produit ; il ne le sert pas. La persistance réelle est
PostgreSQL, dans l'application Next.js, avec RLS.

**Condition de sortie :** décider si le backend est un produit ou une
illustration. Tant que ce n'est pas tranché, il faut qu'il soit fermé — ce qui
est le cas.

### Pas de limitation de débit

Une fois le jeton connu, rien ne borne le nombre d'appels. Ce n'est pas une
faille en soi, mais un jeton fuité n'a pas de fenêtre d'exploitation limitée.

---

## 4. Comment vérifier

```bash
cd backend
python -m pytest tests/test_securite_backend.py -v
```

Douze tests, tous négatifs d'abord : ils vérifient que l'accès **non** autorisé
échoue, puis que l'accès autorisé passe. Un test qui ne vérifierait que le
second cas passerait aussi sur un backend ouvert.

Falsifications effectuées :

| Modification | Effet |
|---|---|
| Retirer la dépendance de jeton des routes | **6 tests rouges** |
| Rouvrir `GET /audits` | **2 tests rouges** |

---

## 5. Ce qu'il faut faire côté déploiement

1. Générer un jeton : `openssl rand -base64 48`
2. Le poser dans Vercel : variable d'environnement `BACKEND_API_TOKEN`
   (⚠️ **pas** `NEXT_PUBLIC_*`)
3. Vérifier que `/fastapi/api/v1/health` répond `200` et que
   `/fastapi/api/v1/audits` répond `410`
4. Vérifier que `/docs` et `/openapi.json` ne répondent plus

⚠️ Tant que le jeton n'est pas posé, les routes métier répondent `503`. C'est
le comportement voulu, mais il faut le savoir avant de conclure à une panne.
