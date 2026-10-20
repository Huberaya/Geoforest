#!/usr/bin/env bash
# Preuve de restauration PostgreSQL dans une base distincte d'une branche Neon
# éphémère. Le workflow supprime ensuite la branche entière, même en échec.
set -euo pipefail

: "${DATABASE_URL_ADMIN:?DATABASE_URL_ADMIN absent : branche Neon CI non créée}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID absent}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT absent}"

for outil in pg_dump pg_restore psql; do
  command -v "$outil" >/dev/null 2>&1 || {
    echo "ERREUR : outil requis absent : $outil" >&2
    exit 1
  }
done

repertoire="$(mktemp -d)"
trap 'rm -rf "$repertoire"' EXIT
base="gf_restore_check_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"

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

echo "Étape 1/5 — mesurer les données de la base source éphémère"
compter "$DATABASE_URL_ADMIN" > "$repertoire/attendu.txt"
cat "$repertoire/attendu.txt"

echo "Étape 2/5 — créer une sauvegarde PostgreSQL au format custom"
pg_dump --format=custom --no-owner --no-privileges \
  --file="$repertoire/geoforest.dump" "$DATABASE_URL_ADMIN"
test -s "$repertoire/geoforest.dump"
printf 'Sauvegarde créée : %s octets\n' "$(wc -c < "$repertoire/geoforest.dump")"

echo "Étape 3/5 — créer une base de restauration neuve"
# L'identifiant est construit uniquement à partir des nombres fournis par GitHub.
# La base neuve évite toute collision de propriétaire avec les objets source.
psql "$DATABASE_URL_ADMIN" -X -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE $base" >/dev/null

# Remplacer le nom de base dans l'URI sans afficher ni reconstruire les secrets.
sans_query="${DATABASE_URL_ADMIN%%\?*}"
query=""
if [[ "$DATABASE_URL_ADMIN" == *\?* ]]; then
  query="?\${DATABASE_URL_ADMIN#*\?}"
fi
prefixe="${sans_query%/*}"
url_restauration="${prefixe}/${base}${query}"

echo "Étape 4/5 — restaurer intégralement dans la base neuve"
pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname="$url_restauration" "$repertoire/geoforest.dump"

echo "Étape 5/5 — comparer les volumes restaurés"
compter "$url_restauration" > "$repertoire/restaure.txt"
if ! diff -u "$repertoire/attendu.txt" "$repertoire/restaure.txt"; then
  echo "ÉCHEC : les volumes restaurés diffèrent de la sauvegarde." >&2
  exit 1
fi

echo "PREUVE DE RESTAURATION RÉUSSIE : gf_users, gf_plots et gf_documents concordent."
