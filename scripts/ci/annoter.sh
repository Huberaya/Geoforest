#!/usr/bin/env bash
# =============================================================================
# Exécute une commande de contrôle et remonte ses échecs en annotations GitHub.
# =============================================================================
# Pourquoi : le 29/10/2026, l'étape « Cross-tenant database RLS controls » du
#   job Neon a échoué (run 40930475126) et le journal brut n'était pas
#   récupérable depuis l'environnement d'analyse (stockage externe des logs,
#   hors liste d'accès). Les **annotations**, elles, sont exposées par l'API
#   (`check-runs/{id}/annotations`). Chaque harnais du dépôt marque ses échecs
#   par « 🔴 » : ce script relaie ces lignes en `::error::` et la dernière ligne
#   de synthèse en `::notice::`, sans toucher au code de sortie ni au contenu
#   des contrôles.
#
# Usage : bash scripts/ci/annoter.sh <titre> <commande> [args…]
#   bash scripts/ci/annoter.sh "cross-tenant:rls" npm run test:cross-tenant:rls
#
# Hors GitHub Actions (GITHUB_ACTIONS non défini), la commande est exécutée
# telle quelle : aucune annotation n'est émise.
# =============================================================================
set -uo pipefail

TITRE="${1:?titre de l_etape}"; shift
[ "$#" -gt 0 ] || { echo "usage: $0 <titre> <commande> [args…]" >&2; exit 2; }

JOURNAL="$(mktemp /tmp/annoter-XXXXXX.log)"
trap 'rm -f "$JOURNAL"' EXIT

"$@" 2>&1 | tee "$JOURNAL"
CODE=${PIPESTATUS[0]}

if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  # Les annotations sont limitées en nombre par étape (10 erreurs affichées) :
  # on relaie les 20 premières lignes d'échec et la synthèse finale.
  n=0
  while IFS= read -r ligne; do
    n=$((n + 1)); [ "$n" -le 20 ] || break
    # Les retours à la ligne et « : » sont neutralisés pour la commande ouvrière.
    msg="$(printf '%s' "$ligne" | sed 's/^[[:space:]]*//; s/%/%25/g; s/\r/%0D/g')"
    echo "::error title=${TITRE}::${msg}"
  done < <(grep -E '🔴|ÉCHEC|ECHEC|Contrôle interrompu' "$JOURNAL" || true)
  synthese="$(grep -E '[0-9]+ contrôles? (réussi|passé)|échec\(s\)|vérification\(s\)|Résultat :' "$JOURNAL" | tail -n 1 | sed 's/%/%25/g')"
  [ -n "$synthese" ] && echo "::notice title=${TITRE}::${synthese} (code ${CODE})"
fi

exit "$CODE"
