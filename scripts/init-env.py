"""Create development-only secrets. Never overwrites an existing environment."""

from pathlib import Path
from secrets import token_urlsafe

path = Path(".env")
if path.exists():
    raise SystemExit(".env already exists; refusing to overwrite it")
app, migrator, db, session, oidc, kc = [token_urlsafe(40) for _ in range(6)]
values = {
    "APP_ENV": "development",
    "PUBLIC_ORIGIN": "http://localhost:3000",
    "ALLOWED_HOSTS": "localhost,127.0.0.1,frontend,backend",
    "DATABASE_URL": f"postgresql+psycopg://geoforest_app:{app}@db:5432/geoforest",
    "MIGRATION_DATABASE_URL": f"postgresql+psycopg://geoforest_migrator:{migrator}@db:5432/geoforest",
    "APP_DB_PASSWORD": app,
    "MIGRATOR_DB_PASSWORD": migrator,
    "POSTGRES_PASSWORD": db,
    "SESSION_SECRET": session,
    "OIDC_CLIENT_SECRET": oidc,
    "OIDC_CLIENT_ID": "geoforest",
    "OIDC_ISSUER": "http://localhost:3000/identity/realms/geoforest",
    "OIDC_BACKCHANNEL_ORIGIN": "http://keycloak:8080",
    "KC_BOOTSTRAP_ADMIN_USERNAME": "local-admin",
    "KC_BOOTSTRAP_ADMIN_PASSWORD": kc,
    "ADMIN_ACR": "",
    "SESSION_HOURS": "8",
    "API_INTERNAL_URL": "http://backend:8000",
    "KEYCLOAK_INTERNAL_URL": "http://keycloak:8080",
}
path.write_text("\n".join(f"{k}={v}" for k, v in values.items()) + "\n")
path.chmod(0o600)
print("Development .env created with unique secrets. No secret printed.")
