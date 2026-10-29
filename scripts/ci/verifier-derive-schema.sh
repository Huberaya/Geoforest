#!/usr/bin/env bash
# =============================================================================
# Dérive entre src/db/schema.ts et l'historique Drizzle (drizzle/meta/*).
# =============================================================================
# Pourquoi : la colonne gf_products.country_of_origin a été rendue facultative
#   par un script de sûreté (post-migrate 025) et dans schema.ts, mais jamais
#   dans une migration Drizzle. Résultat mesuré : `drizzle-kit generate`
#   régénérait ces ordres à chaque appel, et `drizzle-kit check` ne voyait
#   rien (il ne compare que les snapshots entre eux). Rien ne le signalait.
#
# Ce que fait ce script, sans base de données ni secret :
#   1. `drizzle-kit check`      — cohérence interne des snapshots ;
#   2. `drizzle-kit generate`   — sur une **copie** de drizzle/, pour ne rien
#                                 écrire dans le dépôt ; toute migration
#                                 produite = dérive non consignée → échec.
#
# Usage : bash scripts/ci/verifier-derive-schema.sh
# =============================================================================
set -euo pipefail

RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$RACINE"

# ⚠️ drizzle-kit préfixe `--out` par « ./ » : un chemin absolu (mktemp) devient
#   « .//tmp/… », introuvable — et la commande sort **en code 0** après avoir
#   affiché l'erreur. Mesuré. La copie reste donc dans le dépôt (ignorée par
#   Git), et la sortie est lue : seul un message explicite vaut résultat.
COPIE=".derive-schema-tmp"
rm -rf "$COPIE"
trap 'rm -rf "$COPIE"' EXIT

echo "== 1. Cohérence interne des snapshots (drizzle-kit check) =="
npx drizzle-kit check

echo "== 2. Dérive schema.ts ↔ dernier snapshot (generate sur une copie) =="
mkdir -p "$COPIE"
cp -R drizzle/. "$COPIE/"
SORTIE="$(npx drizzle-kit generate --dialect postgresql --schema ./src/db/schema.ts --out "./$COPIE" 2>&1)" || {
  echo "$SORTIE" >&2
  echo "🔴 drizzle-kit generate a échoué" >&2
  exit 1
}
if grep -q 'No schema changes' <<<"$SORTIE"; then
  N="$(find drizzle -maxdepth 1 -name '*.sql' ! -name '*.down.sql' | wc -l | tr -d ' ')"
  echo "   · aucune migration à produire : schema.ts et le journal coïncident ($N migration(s) montantes)"
elif grep -q 'Your SQL migration file' <<<"$SORTIE"; then
  echo "🔴 schema.ts n'est pas consigné dans l'historique Drizzle : drizzle-kit produirait" >&2
  for f in "$COPIE"/*.sql; do
    [ -e "drizzle/$(basename "$f")" ] && continue
    echo "--- $(basename "$f")" >&2
    cat "$f" >&2
    echo >&2
  done
  echo "   Générer la migration (npm run db:generate), la nommer, écrire sa descente (.down.sql), puis la relire." >&2
  exit 1
else
  echo "$SORTIE" >&2
  echo "🔴 sortie de drizzle-kit generate non reconnue : résultat non concluant, considéré comme un échec" >&2
  exit 1
fi
echo "✅ Aucune dérive schéma ↔ historique Drizzle."
