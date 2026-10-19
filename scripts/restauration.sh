#!/usr/bin/env bash
# Restauration locale de GeoForest (B-2, chantier 5) dans une base NEUVE et un dossier de stockage NEUF.
#
# Usage :
#   scripts/restauration.sh <dossier_de_sauvegarde> <nom_base_cible> <dossier_stockage_cible>
#
# Variables :
#   RESTORE_ADMIN_URL  URL administrateur pointant vers la base de maintenance (ex. …/postgres).
#                      La base cible y est créée. Ne jamais pointer vers la base de production.
#   PG_BIN_DIR         dossier des outils pg_restore / psql (défaut : PATH).
#
# Déroulement, dans l'ordre. Chaque étape peut arrêter la restauration :
#   1. vérification du MANIFEST.sha256 : une sauvegarde altérée n'est jamais restaurée ;
#   2. refus si la base cible existe déjà, ou si le dossier de stockage cible n'est pas vide ;
#   3. création de la base cible, puis pg_restore avec arrêt à la première erreur ;
#   4. extraction du stockage dans le dossier cible ;
#   5. contrôle d'intégrité : scripts/empreinte-sauvegarde.ts (lignes, chaîne, pièces, fichiers).
#
# En cas d'échec après l'étape 3, la base créée est laissée en place pour inspection. Elle
# n'est jamais réutilisée automatiquement : la supprimer, ou la renommer, est une décision
# d'exploitation.

set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage : scripts/restauration.sh <dossier_de_sauvegarde> <nom_base_cible> <dossier_stockage_cible>" >&2
  exit 2
fi
SOURCE="$1"
BASE_CIBLE="$2"
STOCKAGE_CIBLE="$3"

if [ -z "${RESTORE_ADMIN_URL:-}" ]; then
  echo "🔴 RESTORE_ADMIN_URL requis (base de maintenance, ex. postgres://…/postgres)." >&2
  exit 2
fi
if ! [[ "$BASE_CIBLE" =~ ^[a-z][a-z0-9_]{0,62}$ ]]; then
  echo "🔴 Nom de base cible refusé : lettres minuscules, chiffres et _ uniquement." >&2
  exit 2
fi
if [ "$BASE_CIBLE" = "app_db" ]; then
  echo "🔴 Refus : « app_db » est la base de production. Choisir un autre nom." >&2
  exit 2
fi

PG_PREFIXE=""
if [ -n "${PG_BIN_DIR:-}" ]; then PG_PREFIXE="$PG_BIN_DIR/"; fi
PG_RESTORE="${PG_PREFIXE}pg_restore"
PSQL="${PG_PREFIXE}psql"

# ------------------------------------------------- 1. Intégrité de la sauvegarde
if [ ! -f "$SOURCE/MANIFEST.sha256" ]; then
  echo "🔴 MANIFEST.sha256 absent : sauvegarde non vérifiable, restauration refusée." >&2
  exit 1
fi
if ! (cd "$SOURCE" && sha256sum --check --strict MANIFEST.sha256 > /dev/null 2>&1); then
  echo "🔴 Condensats de la sauvegarde ne correspondent pas au manifeste : restauration refusée." >&2
  (cd "$SOURCE" && sha256sum --check --strict MANIFEST.sha256 2>&1 | grep -v ': OK$' || true) >&2
  exit 1
fi
echo "✅ Manifeste vérifié."

# ------------------------------------------------------- 2. Cibles vierges
URL_BASE_CIBLE="${RESTORE_ADMIN_URL%/*}/$BASE_CIBLE"
if [ "$URL_BASE_CIBLE" = "$RESTORE_ADMIN_URL" ]; then
  echo "🔴 RESTORE_ADMIN_URL doit se terminer par le nom de la base de maintenance." >&2
  exit 2
fi
existe=$("$PSQL" "$RESTORE_ADMIN_URL" -Atqc "select count(*) from pg_database where datname = '$BASE_CIBLE'")
if [ "$existe" != "0" ]; then
  echo "🔴 La base « $BASE_CIBLE » existe déjà : restauration refusée." >&2
  exit 1
fi
if [ -e "$STOCKAGE_CIBLE" ] && [ -n "$(ls -A "$STOCKAGE_CIBLE" 2>/dev/null)" ]; then
  echo "🔴 Dossier de stockage cible non vide : restauration refusée." >&2
  exit 1
fi

# --------------------------------------------------------- 3. Base
debut=$(date +%s)
"$PSQL" "$RESTORE_ADMIN_URL" -v ON_ERROR_STOP=1 -qc "create database \"$BASE_CIBLE\""
if ! "$PG_RESTORE" --no-owner --exit-on-error --dbname="$URL_BASE_CIBLE" "$SOURCE/base.dump"; then
  echo "🔴 pg_restore a échoué. Base « $BASE_CIBLE » laissée pour inspection." >&2
  exit 1
fi
echo "✅ Base « $BASE_CIBLE » restaurée."

# ----------------------------------------------------------- 4. Stockage
mkdir -p "$STOCKAGE_CIBLE"
tar -C "$STOCKAGE_CIBLE" -xzf "$SOURCE/stockage.tar.gz"
echo "✅ Stockage extrait dans : $STOCKAGE_CIBLE"

# ------------------------------------------------------ 5. Intégrité après
# Le contrôle d'intégrité n'écrit rien dans la sauvegarde. La comparaison avec l'empreinte
# prise avant sauvegarde se fait à part : `--comparer <empreinte-avant.json>`.
if ! salida=$(npx tsx scripts/empreinte-sauvegarde.ts --url "$URL_BASE_CIBLE" --stockage "$STOCKAGE_CIBLE" 2>&1); then
  echo "$salida" >&2
  echo "🔴 Contrôle d'intégrité après restauration en échec. Base « $BASE_CIBLE » laissée pour inspection." >&2
  exit 1
fi
echo "$salida"

fin=$(date +%s)
echo "✅ Restauration terminée et contrôlée en $((fin - debut)) s."
