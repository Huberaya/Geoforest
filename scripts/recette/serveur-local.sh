#!/usr/bin/env bash
# =============================================================================
# Base PostgreSQL jetable + rejeu des suites HTTP, sans Neon ni Docker.
# =============================================================================
# Reproduit localement ce que le job « database » de la CI fait sur une branche
# Neon : un cluster neuf, un propriétaire NOSUPERUSER, le rôle applicatif sans
# BYPASSRLS, migration, seed de démonstration, puis chaque suite HTTP contre un
# serveur `next start` **neuf** (le compteur de cadence d'authentification est
# en mémoire : enchaîner les suites sur un même serveur finit en 429 — mesuré).
#
# ⚠️ Jamais une base existante : le cluster vit dans un répertoire temporaire,
#   sur un port dédié ; les mots de passe et secrets sont tirés au sort, écrits
#   dans un fichier d'environnement en 0600 **hors du dépôt**, jamais affichés.
# ⚠️ `kill` sur `npx next start` ne tue pas le `next-server` enfant : un
#   serveur résiduel continuerait à servir l'ancienne version et fausserait la
#   suite suivante. D'où setsid + pkill, et le refus de démarrer s'il en reste un.
#
# Prérequis : binaires PostgreSQL serveur dans PG_BIN (cf. postgresql-recette.sh),
#   `npm ci` fait, `npm run build` fait pour les suites HTTP.
#
# Usage :
#   PG_BIN=… scripts/recette/serveur-local.sh start          # cluster + migrate + seed
#   scripts/recette/serveur-local.sh suite e2e [etiquette]    # une suite : test:e2e
#   scripts/recette/serveur-local.sh suite fournisseur:http
#   scripts/recette/serveur-local.sh stop
#
# Variables : GF_RECETTE_DIR (défaut /tmp/geoforest-serveur-local) — données du
#   cluster, fichier d'environnement et journaux ; GF_RECETTE_PORT (55433).
# =============================================================================
set -uo pipefail

RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
DOSSIER="${GF_RECETTE_DIR:-/tmp/geoforest-serveur-local}"
PORT_DB="${GF_RECETTE_PORT:-55433}"
ENVFILE="$DOSSIER/env.sh"
JOURNAUX="$DOSSIER/journaux"

case "${1:-}" in
  start)
    : "${PG_BIN:?PG_BIN doit pointer vers les binaires PostgreSQL serveur}"
    if [ -d "$DOSSIER/data" ]; then
      echo "🔴 $DOSSIER existe déjà : lancer « stop » d'abord" >&2; exit 2
    fi
    mkdir -p "$DOSSIER" "$JOURNAUX"
    "$PG_BIN/initdb" -D "$DOSSIER/data" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
    "$PG_BIN/pg_ctl" -D "$DOSSIER/data" -l "$DOSSIER/serveur.log" \
      -o "-p $PORT_DB -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DOSSIER -c fsync=off" start >/dev/null
    sleep 1
    MDP_OWNER="$(openssl rand -hex 16)"; MDP_APP="$(openssl rand -hex 16)"; MDP_DEMO="$(openssl rand -hex 12)"
    # Le propriétaire reçoit BYPASSRLS et CREATEDB comme `neondb_owner` chez
    # l'hébergeur : le seed et la preuve de restauration en ont besoin ; la
    # recette postgresql-recette.sh, elle, mesure le cas sans BYPASSRLS.
    "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
create role geoforest_owner login nosuperuser bypassrls createrole createdb password '$MDP_OWNER';
create database geoforest_local owner geoforest_owner encoding 'UTF8' template template0;
revoke all on database geoforest_local from public;
SQL
    umask 077
    cat > "$ENVFILE" <<EOF
export PG_BIN=$PG_BIN
export PGPORT_LOCAL=$PORT_DB
export DATABASE_URL_ADMIN=postgresql://geoforest_owner:$MDP_OWNER@127.0.0.1:$PORT_DB/geoforest_local
export DATABASE_URL=postgresql://geoforest_app:$MDP_APP@127.0.0.1:$PORT_DB/geoforest_local
export GF_BASE_JETABLE=oui
export AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
export GF_STORAGE_SIGNING_SECRET=$(openssl rand -base64 48 | tr -d '\n')
export SEED_DEMO_PASSWORD=$MDP_DEMO
export E2E_PASSWORD=$MDP_DEMO
export E2E_BASE_URL=http://127.0.0.1:3000
EOF
    # shellcheck disable=SC1090
    source "$ENVFILE"
    cd "$RACINE"
    npm run --silent db:migrate | grep -E 'RLS :|✅|🔴'
    # 010 crée geoforest_app NOLOGIN ; le mot de passe est posé par l'exploitant.
    "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d geoforest_local -v ON_ERROR_STOP=1 -q \
      -c "alter role geoforest_app login password '$MDP_APP';"
    npm run --silent test:db | tail -n 1
    npm run --silent seed:auth -- --reset >/dev/null && echo "   · seed de démonstration posé"
    echo "✅ cluster prêt (port $PORT_DB) ; variables dans $ENVFILE (non affichées) ; journaux dans $JOURNAUX"
    ;;

  suite)
    SUITE="${2:?nom de suite, ex. e2e ou fournisseur:http}"
    [ -f "$ENVFILE" ] || { echo "🔴 cluster non démarré ($ENVFILE absent)" >&2; exit 2; }
    # shellcheck disable=SC1090
    source "$ENVFILE"
    cd "$RACINE"
    SHA="$(git rev-parse HEAD)"
    LOG="$JOURNAUX/$(echo "$SUITE" | tr ':' '-')-${3:-$SHA}.log"
    if pgrep -f '^next-server' >/dev/null; then
      echo "🔴 serveur next-server résiduel détecté — abandon (il servirait une autre version)" >&2; exit 3
    fi
    npm run --silent seed:auth -- --reset >/dev/null 2>&1 || { echo "🔴 seed:auth --reset a échoué" >&2; exit 1; }
    NODE_ENV=production setsid nohup npx next start -p 3000 -H 127.0.0.1 > "$JOURNAUX/next-$(echo "$SUITE" | tr ':' '-').log" 2>&1 &
    PGID=$!
    for _ in $(seq 1 60); do curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break; sleep 1; done
    VERSION="$(grep -oE 'Next.js [0-9.]+' "$JOURNAUX/next-$(echo "$SUITE" | tr ':' '-').log" | head -n 1)"
    { echo "# SHA=$SHA  suite=test:$SUITE  serveur=$VERSION  base=PostgreSQL local $PORT_DB"; } > "$LOG"
    npm run --silent "test:$SUITE" >> "$LOG" 2>&1; CODE=$?
    kill -- "-$PGID" >/dev/null 2>&1; pkill -f '^next-server' >/dev/null 2>&1; sleep 1
    echo "test:$SUITE exit=$CODE ($VERSION) — $LOG"
    grep -E '[0-9]+/[0-9]+ |réussi|échec|passé' "$LOG" | tail -n 1
    exit "$CODE"
    ;;

  stop)
    pkill -f '^next-server' >/dev/null 2>&1 || true
    if [ -f "$ENVFILE" ]; then
      # shellcheck disable=SC1090
      source "$ENVFILE"
      "$PG_BIN/pg_ctl" -D "$DOSSIER/data" -m immediate stop >/dev/null 2>&1 || true
    fi
    rm -rf "$DOSSIER/data" "$ENVFILE"
    echo "cluster arrêté (journaux conservés dans $JOURNAUX)"
    ;;

  *) echo "usage: $0 start | suite <nom> [etiquette] | stop" >&2; exit 2;;
esac
