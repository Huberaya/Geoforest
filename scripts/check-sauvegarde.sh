#!/usr/bin/env bash
# Test de sauvegarde et restauration (B-2, chantier 5) : scénario réel sur PostgreSQL local.
#
# Prérequis (voir scripts/sauvegarde.sh) :
#   BACKUP_DATABASE_URL (ou DATABASE_URL_ADMIN), RESTORE_ADMIN_URL, GF_STORAGE_DIR,
#   PG_BIN_DIR (outils pg_dump / pg_restore / psql), application à l'arrêt (base au repos).
#
# Ce script crée des bases de test « gftest_<horodatage>_* » et les supprime à la fin.
# Il ne touche jamais à « app_db ». Il ne lit ni n'écrit aucun secret.
#
# Usage : scripts/check-sauvegarde.sh [dossier_de_travail]

set -uo pipefail

: "${RESTORE_ADMIN_URL:?RESTORE_ADMIN_URL requis}"
: "${GF_STORAGE_DIR:?GF_STORAGE_DIR requis}"
if [ -z "${BACKUP_DATABASE_URL:-${DATABASE_URL_ADMIN:-}}" ]; then
  echo "🔴 BACKUP_DATABASE_URL ou DATABASE_URL_ADMIN requis." >&2
  exit 2
fi
export BACKUP_DATABASE_URL="${BACKUP_DATABASE_URL:-$DATABASE_URL_ADMIN}"

PG_PREFIXE=""
if [ -n "${PG_BIN_DIR:-}" ]; then PG_PREFIXE="$PG_BIN_DIR/"; fi
PSQL="${PG_PREFIXE}psql"

RACINE_DEPOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE_DEPOT"

TRAVAIL="${1:-$(mktemp -d "${TMPDIR:-/tmp}/gf-sauvegarde.XXXXXX")}"
mkdir -p "$TRAVAIL"
RUN=$(date -u +%Y%m%d%H%M%S)
BASE_OK="gftest_${RUN}_ok"
BASE_CONTROLE="gftest_${RUN}_cle"
BASE_INCOMPLETE="gftest_${RUN}_inc"
BASE_NEUVE="gftest_${RUN}_neuve"

reussis=0
echecs=()

verdict() { # verdict <nom> <code de sortie attendu : 0 = réussite> <code obtenu>
  local nom="$1" attendu="$2" obtenu="$3"
  if [ "$attendu" = "ok" ]; then
    if [ "$obtenu" -eq 0 ]; then reussis=$((reussis + 1)); echo "  ✅ $nom"; else echecs+=("$nom (code $obtenu)"); echo "  🔴 $nom (code $obtenu)"; fi
  else
    if [ "$obtenu" -ne 0 ]; then reussis=$((reussis + 1)); echo "  ✅ $nom (refusé, code $obtenu)"; else echecs+=("$nom : accepté alors qu'il devait être refusé"); echo "  🔴 $nom : accepté à tort"; fi
  fi
}

base_existe() { [ "$("$PSQL" "$RESTORE_ADMIN_URL" -Atqc "select count(*) from pg_database where datname = '$1'")" != "0" ]; }
supprimer_base() { "$PSQL" "$RESTORE_ADMIN_URL" -qc "drop database if exists \"$1\"" >/dev/null 2>&1 || true; }
url_de() { echo "${RESTORE_ADMIN_URL%/*}/$1"; }
# Contrôles d'absence et de présence d'une base (le code de sortie suit le verdict attendu).
verdict_absente() { if base_existe "$2"; then verdict "$1" ok 1; else verdict "$1" ok 0; fi; }
verdict_presente() { if base_existe "$2"; then verdict "$1" ok 0; else verdict "$1" ok 1; fi; }

nettoyer() {
  for b in "$BASE_OK" "$BASE_CONTROLE" "$BASE_INCOMPLETE" "$BASE_NEUVE"; do supprimer_base "$b"; done
}
trap nettoyer EXIT

echo "##### Empreinte de référence #####"
npx tsx scripts/empreinte-sauvegarde.ts --json "$TRAVAIL/empreinte-avant.json" > "$TRAVAIL/empreinte-avant.log" 2>&1
verdict "empreinte de référence calculée" ok $?

echo "##### Sauvegarde #####"
scripts/sauvegarde.sh "$TRAVAIL/sauvegardes" > "$TRAVAIL/sauvegarde.log" 2>&1
verdict "sauvegarde réussie" ok $?
SAUV=$(ls -d "$TRAVAIL/sauvegardes"/*/ | head -1)
SAUV="${SAUV%/}"
verdict "manifeste présent avec 3 fichiers" ok "$([ "$(wc -l < "$SAUV/MANIFEST.sha256")" -eq 3 ] && echo 0 || echo 1)"

echo "##### Restauration nominale #####"
scripts/restauration.sh "$SAUV" "$BASE_OK" "$TRAVAIL/stockage-ok" > "$TRAVAIL/restauration-ok.log" 2>&1
verdict "restauration dans base neuve et contrôle d'intégrité" ok $?
npx tsx scripts/empreinte-sauvegarde.ts --url "$(url_de "$BASE_OK")" --stockage "$TRAVAIL/stockage-ok" \
  --comparer "$TRAVAIL/empreinte-avant.json" > "$TRAVAIL/comparaison-ok.log" 2>&1
verdict "empreinte après restauration identique à la référence" ok $?

echo "##### Sauvegarde altérée : refus #####"
cp -r "$SAUV" "$TRAVAIL/alteree-dump"
python3 -c "import sys; p=sys.argv[1]; b=bytearray(open(p,'rb').read()); b[len(b)//2] ^= 0x01; open(p,'wb').write(b)" "$TRAVAIL/alteree-dump/base.dump"
scripts/restauration.sh "$TRAVAIL/alteree-dump" "$BASE_NEUVE" "$TRAVAIL/stockage-x1" > "$TRAVAIL/x1.log" 2>&1
verdict "dump altéré refusé" refus $?
verdict_absente "dump altéré : aucune base créée" "$BASE_NEUVE"

cp -r "$SAUV" "$TRAVAIL/alteree-stock"
python3 -c "import sys; p=sys.argv[1]; b=bytearray(open(p,'rb').read()); b[len(b)//2] ^= 0x01; open(p,'wb').write(b)" "$TRAVAIL/alteree-stock/stockage.tar.gz"
scripts/restauration.sh "$TRAVAIL/alteree-stock" "$BASE_NEUVE" "$TRAVAIL/stockage-x2" > "$TRAVAIL/x2.log" 2>&1
verdict "stockage altéré refusé" refus $?

cp -r "$SAUV" "$TRAVAIL/sans-manifeste"
rm "$TRAVAIL/sans-manifeste/MANIFEST.sha256"
scripts/restauration.sh "$TRAVAIL/sans-manifeste" "$BASE_NEUVE" "$TRAVAIL/stockage-x3" > "$TRAVAIL/x3.log" 2>&1
verdict "sauvegarde sans manifeste refusée" refus $?

echo "##### Cibles non vierges : refus #####"
scripts/restauration.sh "$SAUV" "$BASE_OK" "$TRAVAIL/stockage-x4" > "$TRAVAIL/x4.log" 2>&1
verdict "base cible déjà existante refusée" refus $?
scripts/restauration.sh "$SAUV" "app_db" "$TRAVAIL/stockage-x5" > "$TRAVAIL/x5.log" 2>&1
verdict "nom « app_db » refusé" refus $?
mkdir -p "$TRAVAIL/stockage-plein" && echo x > "$TRAVAIL/stockage-plein/existant.txt"
scripts/restauration.sh "$SAUV" "$BASE_NEUVE" "$TRAVAIL/stockage-plein" > "$TRAVAIL/x6.log" 2>&1
verdict "stockage cible non vide refusé" refus $?
verdict_absente "refus sur stockage non vide : aucune base créée" "$BASE_NEUVE"

echo "##### Sauvegarde cohérente en apparence mais incomplète #####"
# Le manifeste est recalculé après retrait d'une pièce : les condensats sont valides.
# Seul le contrôle d'intégrité (pièces présentes en base et sur le support) peut la refuser.
cp -r "$SAUV" "$TRAVAIL/incomplete"
mkdir -p "$TRAVAIL/incomplete-stock" && tar -C "$TRAVAIL/incomplete-stock" -xzf "$SAUV/stockage.tar.gz"
premier=$(cd "$TRAVAIL/incomplete-stock" && find . -type f | head -1)
rm "$TRAVAIL/incomplete-stock/$premier"
tar -C "$TRAVAIL/incomplete-stock" -czf "$TRAVAIL/incomplete/stockage.tar.gz" .
(cd "$TRAVAIL/incomplete" && sha256sum base.dump stockage.tar.gz sauvegarde.json > MANIFEST.sha256)
scripts/restauration.sh "$TRAVAIL/incomplete" "$BASE_INCOMPLETE" "$TRAVAIL/stockage-inc" > "$TRAVAIL/inc.log" 2>&1
verdict "sauvegarde incomplète refusée au contrôle d'intégrité" refus $?
verdict_presente "base incomplète laissée pour inspection" "$BASE_INCOMPLETE"

echo "##### Sensibilité du comparateur #####"
"$PSQL" "$(url_de "$BASE_OK")" -qc "update gf_documents set sha256 = repeat('0', 64) where id = (select id from gf_documents where storage_key is not null limit 1)" > /dev/null 2>&1
npx tsx scripts/empreinte-sauvegarde.ts --url "$(url_de "$BASE_OK")" --stockage "$TRAVAIL/stockage-ok" \
  --comparer "$TRAVAIL/empreinte-avant.json" > "$TRAVAIL/comparaison-alteree.log" 2>&1
verdict "condensat altéré en base détecté par la comparaison" refus $?

echo
echo "Résultat : $reussis contrôle(s) réussi(s), ${#echecs[@]} échec(s)."
for e in "${echecs[@]+"${echecs[@]}"}"; do echo "  - $e"; done
[ "${#echecs[@]}" -eq 0 ]
