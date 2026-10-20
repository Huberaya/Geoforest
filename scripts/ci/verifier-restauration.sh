#!/usr/bin/env bash
# Preuve de restauration PostgreSQL sur une branche Neon éphémère de CI.
# Le pg_restore réinitialise uniquement cette branche jetable, jamais la branche
# parente : le workflow supprime la branche Neon en fin de job, même en échec.
set -euo pipefail

: "${DATABASE_URL_ADMIN:?DATABASE_URL_ADMIN absent : branche Neon CI non créée}"

for outil in pg_dump pg_restore psql; do
  command -v "$outil" >/dev/null 2>&1 || {
    echo "ERREUR : outil requis absent : $outil" >&2
    exit 1
  }
done

repertoire="$(mktemp -d)"
trap 'rm -rf "$repertoire"' EXIT

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

echo "Étape 1/4 — mesurer les données de la branche Neon éphémère"
compter "$DATABASE_URL_ADMIN" > "$repertoire/attendu.txt"
cat "$repertoire/attendu.txt"

echo "Étape 2/4 — créer une sauvegarde PostgreSQL au format custom"
pg_dump --format=custom --no-owner --no-privileges \
  --file="$repertoire/geoforest.dump" "$DATABASE_URL_ADMIN"
test -s "$repertoire/geoforest.dump"
printf 'Sauvegarde créée : %s octets\n' "$(wc -c < "$repertoire/geoforest.dump")"

echo "Étape 3/4 — restaurer la sauvegarde dans la branche Neon jetable"
# --clean réinitialise les objets issus de l'archive avant de les restaurer.
# La branche parente n'est jamais connectée par ce script.
pg_restore --clean --if-exists --exit-on-error --no-owner --no-privileges \
  --dbname="$DATABASE_URL_ADMIN" "$repertoire/geoforest.dump"

echo "Étape 4/4 — comparer les volumes restaurés"
compter "$DATABASE_URL_ADMIN" > "$repertoire/restaure.txt"
if ! diff -u "$repertoire/attendu.txt" "$repertoire/restaure.txt"; then
  echo "ÉCHEC : les volumes restaurés diffèrent de la sauvegarde." >&2
  exit 1
fi

echo "PREUVE DE RESTAURATION RÉUSSIE : gf_users, gf_plots et gf_documents concordent."
