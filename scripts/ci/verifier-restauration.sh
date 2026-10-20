#!/usr/bin/env bash
# Preuve de restauration PostgreSQL sur une base jetable de la branche Neon CI.
# Ne jamais appeler ce script avec une URL de production : il crée puis détruit
# une base distincte, nommée à partir de l'identifiant du run GitHub.
set -euo pipefail

: "${DATABASE_URL_ADMIN:?DATABASE_URL_ADMIN absent : branche Neon CI non créée}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID absent}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT absent}"

for outil in pg_dump pg_restore psql node; do
  command -v "$outil" >/dev/null 2>&1 || {
    echo "ERREUR : outil requis absent : $outil" >&2
    exit 1
  }
done

repertoire="$(mktemp -d)"
base="gf_restore_check_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
base_creee=0

nettoyer() {
  if [[ "$base_creee" == "1" ]]; then
    # La base cible est créée par ce script dans la branche Neon éphémère CI.
    psql "$DATABASE_URL_ADMIN" -X -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS $base WITH (FORCE)" >/dev/null 2>&1 || true
  fi
  rm -rf "$repertoire"
}
trap nettoyer EXIT

compter() {
  local url="$1"
  psql "$url" -X -v ON_ERROR_STOP=1 -qAt -F '|' -c "
    SELECT 'gf_users', count(*) FROM public.gf_users
    UNION ALL
    SELECT 'gf_plots', count(*) FROM public.gf_plots
    UNION ALL
    SELECT 'gf_documents', count(*) FROM public.gf_documents
    ORDER BY 1;
  "
}

echo "Étape 1/5 — mesure des données de la base source éphémère"
compter "$DATABASE_URL_ADMIN" > "$repertoire/attendu.txt"
cat "$repertoire/attendu.txt"

echo "Étape 2/5 — création d'une sauvegarde PostgreSQL au format custom"
pg_dump --format=custom --no-owner --no-privileges \
  --file="$repertoire/geoforest.dump" "$DATABASE_URL_ADMIN"
test -s "$repertoire/geoforest.dump"
printf 'Sauvegarde créée : %s octets\n' "$(wc -c < "$repertoire/geoforest.dump")"

echo "Étape 3/5 — création d'une base de restauration distincte"
psql "$DATABASE_URL_ADMIN" -X -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE $base" >/dev/null
base_creee=1

url_restauration="$(DATABASE_URL_ADMIN="$DATABASE_URL_ADMIN" GF_RESTORE_DB="$base" node -e '
  const url = new URL(process.env.DATABASE_URL_ADMIN);
  url.pathname = "/" + process.env.GF_RESTORE_DB;
  console.log(url.toString());
')"

echo "Étape 4/5 — restauration complète dans la base jetable"
pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname="$url_restauration" "$repertoire/geoforest.dump"

echo "Étape 5/5 — comparaison des volumes restaurés"
compter "$url_restauration" > "$repertoire/restaure.txt"
if ! diff -u "$repertoire/attendu.txt" "$repertoire/restaure.txt"; then
  echo "ÉCHEC : les volumes restaurés diffèrent de la source." >&2
  exit 1
fi

echo "PREUVE DE RESTAURATION RÉUSSIE : gf_users, gf_plots et gf_documents concordent."
