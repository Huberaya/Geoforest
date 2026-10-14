#!/usr/bin/env bash
# Sauvegarde locale de GeoForest (B-2, chantier 5) : base PostgreSQL + stockage des pièces.
#
# Usage :
#   scripts/sauvegarde.sh <dossier_de_destination>
#
# Variables :
#   BACKUP_DATABASE_URL  URL administrateur de la base (sinon DATABASE_URL_ADMIN).
#   GF_STORAGE_DIR       dossier du stockage des pièces (défaut : var/storage).
#   PG_BIN_DIR           dossier des outils pg_dump / psql (défaut : PATH).
#
# Produit dans <destination>/<horodatage>/ :
#   base.dump          pg_dump au format « custom » (privilèges conservés, propriétaire ignoré)
#   stockage.tar.gz    arborescence des pièces
#   sauvegarde.json    méta-données : date, versions d'outils, comptages (sans URL ni secret)
#   MANIFEST.sha256    condensats des trois fichiers ci-dessus, vérifiés à la restauration
#
# ⚠️ Ordre des opérations : la base est vidée en premier, puis le stockage est archivé.
#   Une pièce écrite entre les deux apparaît dans le stockage sans ligne en base : c'est
#   sans gravité. L'ordre inverse produirait des lignes qui pointent vers des fichiers
#   absents. Pour un instantané cohérent, arrêter l'application pendant l'opération.
#
# ⚠️ Ce script ne sauvegarde pas les secrets (.env.local, AUTH_SECRET, mots de passe).
#   Ils se gèrent à part, dans le coffre de l'exploitant. Sans AUTH_SECRET d'origine,
#   les sessions restaurées sont invalides.
#
# ⚠️ Le mot de passe passe dans l'URL, donc dans la liste des processus pendant la
#   durée de pg_dump. Acceptable sur un poste de confiance ; en production, préférer
#   un fichier ~/.pgpass (droits 600) et une URL sans mot de passe.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage : scripts/sauvegarde.sh <dossier_de_destination>" >&2
  exit 2
fi
DESTINATION="$1"

URL="${BACKUP_DATABASE_URL:-${DATABASE_URL_ADMIN:-}}"
if [ -z "$URL" ]; then
  echo "🔴 BACKUP_DATABASE_URL ou DATABASE_URL_ADMIN requis." >&2
  exit 2
fi

STOCKAGE="${GF_STORAGE_DIR:-$(pwd)/var/storage}"
if [ ! -d "$STOCKAGE" ]; then
  echo "🔴 Stockage introuvable : $STOCKAGE" >&2
  exit 2
fi

PG_PREFIXE=""
if [ -n "${PG_BIN_DIR:-}" ]; then PG_PREFIXE="$PG_BIN_DIR/"; fi
PG_DUMP="${PG_PREFIXE}pg_dump"
PSQL="${PG_PREFIXE}psql"

# ---------------------------------------------------------------- Compatibilité
# pg_dump doit être de la même version majeure que le serveur, ou plus récent.
# Un pg_dump plus ancien produit un dump que le serveur ne sait pas toujours relire.
majeure_outil=$("$PG_DUMP" --version | sed -E 's/.* ([0-9]+)\..*/\1/')
majeure_serveur=$("$PSQL" "$URL" -Atqc "show server_version_num" | awk '{print int($1/10000)}')
if [ "$majeure_outil" -lt "$majeure_serveur" ]; then
  echo "🔴 pg_dump majeure $majeure_outil < serveur majeure $majeure_serveur : refus." >&2
  exit 1
fi

HORODATAGE=$(date -u +%Y%m%dT%H%M%SZ)
SORTIE="$DESTINATION/$HORODATAGE"
if [ -e "$SORTIE" ]; then
  echo "🔴 Destination déjà existante : $SORTIE" >&2
  exit 1
fi
mkdir -p "$SORTIE"
debut=$(date +%s)

# ----------------------------------------------------------------- 1. Base
"$PG_DUMP" --format=custom --no-owner --file="$SORTIE/base.dump" "$URL"

# ------------------------------------------------------------- 2. Stockage
tar -C "$STOCKAGE" -czf "$SORTIE/stockage.tar.gz" .

# ----------------------------------------------------------- 3. Méta-données
fichiers_stockage=$(find "$STOCKAGE" -type f | wc -l | tr -d ' ')
octets_stockage=$(find "$STOCKAGE" -type f -exec cat {} + 2>/dev/null | wc -c | tr -d ' ')
versions_outils=$("$PG_DUMP" --version)
version_serveur=$("$PSQL" "$URL" -Atqc "show server_version")
cat > "$SORTIE/sauvegarde.json" <<EOF
{
  "format": "geoforest.sauvegarde/1",
  "horodatage_utc": "$HORODATAGE",
  "outil": "$versions_outils",
  "serveur_postgresql": "$version_serveur",
  "stockage": { "fichiers": $fichiers_stockage, "octets": $octets_stockage }
}
EOF

# ------------------------------------------------------------- 4. Manifeste
(cd "$SORTIE" && sha256sum base.dump stockage.tar.gz sauvegarde.json > MANIFEST.sha256)

fin=$(date +%s)
echo "✅ Sauvegarde écrite : $SORTIE"
echo "   base : $(du -h "$SORTIE/base.dump" | cut -f1), stockage : $fichiers_stockage fichier(s), durée : $((fin - debut)) s"
