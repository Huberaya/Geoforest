#!/usr/bin/env bash
# =============================================================================
# Recette PostgreSQL serveur — cluster jetable, données synthétiques.
# =============================================================================
# ⚠️ Ce script ne vise **jamais** une base existante : il crée son propre
#   cluster dans un répertoire temporaire, sur un port dédié, avec des rôles et
#   une base neufs, puis détruit tout. Aucun identifiant n'est écrit dans le
#   dépôt : celui du propriétaire et celui du rôle applicatif sont tirés au sort
#   à chaque exécution, et ne sont **jamais affichés**.
#
# Prérequis : binaires PostgreSQL serveur (`initdb`, `pg_ctl`, `psql`).
#   Deux façons de les fournir :
#     · PG_BIN=/usr/lib/postgresql/16/bin      (installation système)
#     · PG_BIN=$(python -c "import pgserver,os;print(os.path.join(os.path.dirname(pgserver.__file__),'pginstall','bin'))")
#       (paquet `pgserver`, qui embarque un PostgreSQL 16 : c'est ainsi que la
#        recette a été exécutée dans un environnement sans démon PostgreSQL)
#
# Usage :
#   PG_BIN=/chemin/vers/bin scripts/recette/postgresql-recette.sh
#
# Ce que le script vérifie, dans l'ordre :
#   1. migrations complètes sur une base **neuve**, sous un rôle propriétaire
#      `NOSUPERUSER NOBYPASSRLS` — donc soumis à `force row level security` ;
#   2. reprise de la migration (idempotence) et maintien de la révocation 023 ;
#   3. privilèges, RLS, cloisonnement, secrets, journal, cadence concurrente
#      (`recette-serveur.test.ts`) ;
#   4. dédoublonnage de `024` sur une base déjà migrée contenant des doublons.
# =============================================================================
set -euo pipefail

: "${PG_BIN:?PG_BIN doit pointer vers les binaires PostgreSQL serveur}"
PORT_DB="${RECETTE_PORT:-55432}"
DOSSIER="$(mktemp -d /tmp/geoforest-recette-XXXXXX)"
RACINE="$(cd "$(dirname "$0")/../.." && pwd)"

nettoyer() {
  # Le statut est passé explicitement : dans un piège de signal, `$?` vaut le
  # statut de la dernière commande (souvent 0), ce qui faisait sortir la
  # recette avec un code de succès après une interruption (V20).
  local statut="${1:-$?}"
  trap - EXIT INT TERM
  if [ -f "$DOSSIER/data/postmaster.pid" ]; then
    "$PG_BIN/pg_ctl" -D "$DOSSIER/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$DOSSIER"
  exit "$statut"
}
trap 'nettoyer $?' EXIT
trap 'nettoyer 130' INT
trap 'nettoyer 143' TERM

echo "== 1. Cluster jetable (port $PORT_DB, répertoire temporaire) =="
"$PG_BIN/initdb" -D "$DOSSIER/data" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
"$PG_BIN/pg_ctl" -D "$DOSSIER/data" -l "$DOSSIER/serveur.log" \
  -o "-p $PORT_DB -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DOSSIER -c fsync=off" \
  start >/dev/null
sleep 1
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d postgres -At \
  -c "select 'version=' || current_setting('server_version')" | sed 's/^/   /'

# Secrets tirés au sort, jamais affichés. Le rôle applicatif est créé par la
# migration sans mot de passe : la recette lui en pose un, comme le ferait
# l'exploitant (docs/DEPLOYMENT_VERCEL.md, § « Rôle applicatif »).
MOTDEPASSE_PROPRIETAIRE="$(openssl rand -hex 16)"
MOTDEPASSE_APP="$(openssl rand -hex 16)"

echo "== 2. Rôles et base =="
# `geoforest_owner` imite le rôle de migration réel : propriétaire de la base,
# capable de créer le rôle applicatif, mais **ni superutilisateur ni BYPASSRLS**.
# C'est le cas le plus exigeant, et c'est celui qui a révélé le défaut corrigé
# dans `010` (cf. rapport, V17).
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
create role geoforest_owner login nosuperuser nobypassrls createrole password '$MOTDEPASSE_PROPRIETAIRE';
create database geoforest_recette owner geoforest_owner encoding 'UTF8' template template0;
revoke all on database geoforest_recette from public;
SQL

URL_ADMIN="postgresql://geoforest_owner:$MOTDEPASSE_PROPRIETAIRE@127.0.0.1:$PORT_DB/geoforest_recette"
URL_APP="postgresql://geoforest_app:$MOTDEPASSE_APP@127.0.0.1:$PORT_DB/geoforest_recette"

echo "== 3. Migrations sur une base neuve (rôle propriétaire sans BYPASSRLS) =="
(
  cd "$RACINE"
  DATABASE_URL_ADMIN="$URL_ADMIN" npm run --silent db:migrate
)

echo "== 4. Mot de passe du rôle applicatif (posé par l'exploitant, comme en production) =="
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d geoforest_recette -v ON_ERROR_STOP=1 \
  -c "alter role geoforest_app login password '$MOTDEPASSE_APP';" >/dev/null
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d geoforest_recette -At \
  -c "select '   geoforest_app : login=' || rolcanlogin || ', bypassrls=' || rolbypassrls || ', super=' || rolsuper from pg_roles where rolname='geoforest_app'"

echo "== 5. Reprise de la migration (idempotence) =="
(
  cd "$RACINE"
  DATABASE_URL_ADMIN="$URL_ADMIN" npm run --silent db:migrate
)
# ⚠️ `010` ré-accorde EXECUTE sur les fonctions d'authentification ; c'est `023`
#   qui le retire, et il s'exécute après (ordre du nom de fichier). Une reprise
#   ne doit donc pas rouvrir la faille : c'est vérifié ici, sur le catalogue.
PRIVILEGES="$("$PG_BIN/psql" "$URL_ADMIN" -At -c "
  select count(*) from information_schema.routine_privileges
   where routine_schema='public'
     and routine_name in ('auth_user_by_email','auth_user_by_id')
     and grantee in ('PUBLIC','geoforest_app')")"
if [ "$PRIVILEGES" != "0" ]; then
  echo "   🔴 les fonctions d'authentification restent accessibles après reprise ($PRIVILEGES)" >&2
  exit 1
fi
echo "   · reprise : aucune réouverture des fonctions d'authentification"

echo "== 6. Privilèges, RLS, secrets, journal, cadence (recette-serveur.test.ts) =="
(
  cd "$RACINE"
  RECETTE_URL_ADMIN="$URL_ADMIN" RECETTE_URL_APP="$URL_APP" \
    npx tsx --test scripts/recette/recette-serveur.test.ts
)

echo "== 6b. Usage légitime de l'authentification (attribut de production) =="
# ⚠️ En production, la connexion d'administration est celle du propriétaire de
#   l'hébergeur (`neondb_owner`), qui porte BYPASSRLS. On reproduit cet attribut
#   le temps d'un appel, pour vérifier que la révocation de `023` n'a **pas**
#   cassé l'authentification. Sans l'attribut, la RLS forcée s'applique au
#   propriétaire : la fonction rend zéro ligne — c'est ce que le contrôle de
#   démarrage (`verifierRoleAdministration`) refuse désormais de laisser
#   passer silencieusement.
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d geoforest_recette -q \
  -c "alter role geoforest_owner bypassrls;"
USER_A="aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
EMAIL="$("$PG_BIN/psql" "$URL_ADMIN" -At -c "select email from auth_user_by_email('b@exemple.test')")"
EMAIL_ID="$("$PG_BIN/psql" "$URL_ADMIN" -At -c "select email from auth_user_by_id('$USER_A'::uuid)")"
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d geoforest_recette -q \
  -c "alter role geoforest_owner nobypassrls;"
if [ "$EMAIL" != "b@exemple.test" ] || [ "$EMAIL_ID" != "a@exemple.test" ]; then
  echo "   🔴 authentification cassée par la révocation : '$EMAIL' / '$EMAIL_ID'" >&2
  exit 1
fi
echo "   · auth_user_by_email et auth_user_by_id répondent au propriétaire"
# Le contrôle de démarrage doit refuser un rôle d'administration soumis à la RLS.
SOUMIS="$("$PG_BIN/psql" "$URL_ADMIN" -At -c "select row_security_active('gf_users'::regclass)")"
if [ "$SOUMIS" != "t" ]; then
  echo "   🔴 le propriétaire sans BYPASSRLS n'est pas soumis à la RLS : mesure invalide" >&2
  exit 1
fi
echo "   · sans BYPASSRLS, le propriétaire est bien soumis à la RLS (contrôle de démarrage justifié)"

echo "== 6c. Reprise de la migration sur une base **peuplée** =="
# ⚠️ L'étape 5 rejoue la migration sur une base vide : le contrôle d'application
#   de 022 y est reporté (« aucune ligne vivante »). Il ne s'exerce qu'ici, une
#   fois que 6 a créé des fournisseurs. Mesuré (PostgreSQL 16.2) : sans
#   l'auto-attribution de SET ROLE ajoutée à 022, cette reprise échouait avec
#   « permission denied to set role "geoforest_app" » — le propriétaire créé
#   par CREATEROLE n'a que l'ADMIN OPTION sur le rôle applicatif. La CI, qui
#   migre en superutilisateur, ne pouvait pas le voir.
# L'étape 6 remet la base à vide derrière elle : on pose ici une organisation
# et un fournisseur synthétiques (sous le propriétaire, dans le périmètre de
# l'organisation), que l'on retire après la reprise.
ORG_6C="cccccccc-6666-4666-8666-cccccccccccc"
"$PG_BIN/psql" "$URL_ADMIN" -v ON_ERROR_STOP=1 -q -o /dev/null <<SQL
begin;
select set_config('app.current_org', '$ORG_6C', true);
insert into gf_organizations (id, name, slug, country) values ('$ORG_6C', 'Org recette 6c', 'org-6c', 'FR');
insert into gf_suppliers (organization_id, name, country, commodity, completeness_score, risk_level, status, plots_count)
values ('$ORG_6C', 'Fournisseur recette 6c', 'FR', 'coffee', 10, 'STANDARD', 'ACTIVE', 0);
commit;
SQL
VIVANTES="$("$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d geoforest_recette -At \
  -c "select count(*) from gf_suppliers where deleted_at is null")"
if [ "$VIVANTES" = "0" ]; then
  echo "   🔴 aucune ligne vivante dans gf_suppliers : la reprise ne prouverait rien" >&2
  exit 1
fi
# Sans BYPASSRLS, le propriétaire ne voit aucune ligne : 022 se déclare « non
# exerçable » (vérifié ci-dessous), puis on rejoue avec l'attribut de
# production (cf. 6b) pour que le contrôle s'exerce réellement.
STATUT_SOUMIS=0
SORTIE_SOUMIS="$(cd "$RACINE" && DATABASE_URL_ADMIN="$URL_ADMIN" npm run --silent db:migrate 2>&1)" || STATUT_SOUMIS=$?
if [ "$STATUT_SOUMIS" != "0" ]; then
  echo "   🔴 reprise de la migration (propriétaire soumis à la RLS) échouée (code $STATUT_SOUMIS)" >&2
  echo "$SORTIE_SOUMIS" | tail -n 20 >&2
  exit 1
fi
if ! grep -q 'gf_suppliers — contrôle non exerçable' <<<"$SORTIE_SOUMIS"; then
  echo "   🔴 sous un propriétaire soumis à la RLS, 022 devait annoncer un contrôle non exerçable" >&2
  echo "$SORTIE_SOUMIS" | tail -n 20 >&2
  exit 1
fi
echo "   · propriétaire soumis à la RLS : 022 annonce « contrôle non exerçable » (pas un faux « appliqué »)"
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d geoforest_recette -q \
  -c "alter role geoforest_owner bypassrls;"
STATUT_PEUPLEE=0
SORTIE_PEUPLEE="$(cd "$RACINE" && DATABASE_URL_ADMIN="$URL_ADMIN" npm run --silent db:migrate 2>&1)" || STATUT_PEUPLEE=$?
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d geoforest_recette -q \
  -c "alter role geoforest_owner nobypassrls;"
if [ "$STATUT_PEUPLEE" != "0" ]; then
  echo "   🔴 reprise de la migration sur base peuplée échouée (code $STATUT_PEUPLEE)" >&2
  echo "$SORTIE_PEUPLEE" | tail -n 20 >&2
  exit 1
fi
if ! grep -q 'gf_suppliers — suppression logique possible' <<<"$SORTIE_PEUPLEE"; then
  echo "   🔴 022 n'a pas exercé la suppression logique sous geoforest_app" >&2
  echo "$SORTIE_PEUPLEE" | tail -n 20 >&2
  exit 1
fi
DROIT_SET="$("$PG_BIN/psql" "$URL_ADMIN" -At -c "
  select coalesce(bool_or(set_option), false) || '/' || coalesce(bool_or(inherit_option), false)
    from pg_auth_members
   where roleid = 'geoforest_app'::regrole and member = 'geoforest_owner'::regrole")"
if [ "$DROIT_SET" != "true/false" ]; then
  echo "   🔴 droit d'endosser geoforest_app inattendu (set/inherit = $DROIT_SET, attendu true/false)" >&2
  exit 1
fi
echo "   · reprise sur $VIVANTES fournisseur(s) vivant(s) : 022 a exercé la suppression logique sous geoforest_app (SET sans héritage)"
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d geoforest_recette -v ON_ERROR_STOP=1 -q <<SQL
delete from gf_suppliers where organization_id = '$ORG_6C';
delete from gf_organizations where id = '$ORG_6C';
SQL

echo "== 7. Dédoublonnage de 024 sur une base déjà migrée =="
# On reconstitue l'état d'avant `024` : index unique retiré, deux lignes pour la
# même clé, compteurs 2 et 3. Le script doit conserver **la somme** (5) : une
# correction ne doit jamais alléger une fenêtre en cours de blocage.
"$PG_BIN/psql" "$URL_ADMIN" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
drop index if exists uq_gf_login_attempts_cle;
delete from gf_login_attempts where window_key = 'recette-dedoublonnage';
insert into gf_login_attempts (window_key, attempts, first_attempt_at, last_attempt_at)
values ('recette-dedoublonnage', 2, now() - interval '10 seconds', now() - interval '5 seconds'),
       ('recette-dedoublonnage', 3, now() - interval '9 seconds', now() - interval '1 second');
SQL
"$PG_BIN/psql" "$URL_ADMIN" -v ON_ERROR_STOP=1 -q \
  -f "$RACINE/scripts/sql/post-migrate/024_cadence_cle_unique.sql" >/dev/null
LIGNES="$("$PG_BIN/psql" "$URL_ADMIN" -At -c "
  select count(*) || '/' || coalesce(max(attempts), 0)
    from gf_login_attempts where window_key = 'recette-dedoublonnage'")"
if [ "$LIGNES" != "1/5" ]; then
  echo "   🔴 dédoublonnage incorrect : lignes/essais = $LIGNES (attendu 1/5)" >&2
  exit 1
fi
echo "   · une seule ligne, compteurs cumulés (1/5)"

echo "== 8. Détection d'altération du journal d'audit =="
# ⚠️ Le scellement par condensats ne vaut que s'il est **relu**. On vérifie ici
#   les deux issues : chaîne intacte (code 0), puis ligne falsifiée par un
#   superutilisateur (code 1). La falsification passe par la désactivation des
#   déclencheurs, que seul un superutilisateur peut faire : c'est la limite
#   connue du dispositif, et elle doit être démontrée, pas supposée.
# ⚠️ Le vérificateur doit lire **toutes** les lignes, hors contexte de tenant :
#   sans BYPASSRLS, la RLS forcée lui rendrait zéro ligne et il conclurait
#   « intacte » sans avoir rien regardé. C'est la même dépendance d'exploitation
#   que pour l'authentification (cf. 6b), et c'est pour cela que le contrôle de
#   démarrage la signale désormais.
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d geoforest_recette -q \
  -c "alter role geoforest_owner bypassrls;"
LIGNES_JOURNAL="$("$PG_BIN/psql" "$URL_ADMIN" -At -c "select count(*) from gf_audit_logs")"
if [ "${LIGNES_JOURNAL:-0}" -lt 1 ]; then
  echo "   🔴 aucune ligne d'audit : le contrôle d'intégrité serait vide" >&2
  exit 1
fi
(
  cd "$RACINE"
  if ! DATABASE_URL_ADMIN="$URL_ADMIN" npx tsx scripts/verifier-chaine.ts --json > "$DOSSIER/chaine-avant.json"; then
    echo "   🔴 la chaîne est signalée rompue alors qu'aucune altération n'a eu lieu" >&2
    exit 1
  fi
  if ! grep -q '"ancre"' "$DOSSIER/chaine-avant.json"; then
    echo "   🔴 le vérificateur n'a lu aucune ligne : résultat non concluant" >&2
    exit 1
  fi
  echo "   · chaîne intacte ($LIGNES_JOURNAL ligne(s) lue(s)) : code 0"
)
"$PG_BIN/psql" "$URL_ADMIN" -v ON_ERROR_STOP=1 -q <<'SQL' >/dev/null
alter table gf_audit_logs disable trigger user;
update gf_audit_logs set details = '{"falsifie":true}'::jsonb where id = (
  select id from gf_audit_logs where organization_id = '11111111-1111-4111-8111-111111111111'
   order by sequence desc limit 1);
alter table gf_audit_logs enable trigger user;
SQL
(
  cd "$RACINE"
  if DATABASE_URL_ADMIN="$URL_ADMIN" npx tsx scripts/verifier-chaine.ts --json > "$DOSSIER/chaine-apres.json"; then
    echo "   🔴 une ligne falsifiée n'a pas été détectée" >&2
    exit 1
  fi
  echo "   · falsification détectée : code 1"
)
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d geoforest_recette -q \
  -c "alter role geoforest_owner nobypassrls;"

echo "== 9. Inventaire des comptes de démonstration (lecture seule) =="
# Un compte actif portant l'ancien mot de passe public doit être signalé, et
# plus du tout après rotation. Le script ne modifie rien : la « rotation » ici
# est simulée en base, par la recette elle-même.
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d geoforest_recette -q \
  -c "alter role geoforest_owner bypassrls;"
"$PG_BIN/psql" "$URL_ADMIN" -v ON_ERROR_STOP=1 -q <<'SQL' >/dev/null
delete from gf_users where email = 'admin@geoforest.eu';
insert into gf_users (organization_id, email, name, role, status, password_hash, password_updated_at, token_version)
values ('11111111-1111-4111-8111-111111111111', 'admin@geoforest.eu', 'Compte de démonstration',
        'admin', 'active', 'condensat-synthetique', '2026-01-05T10:00:00Z', 0);
SQL
(
  cd "$RACINE"
  if DATABASE_URL_ADMIN="$URL_ADMIN" npx tsx scripts/verifier-comptes-demo.ts --apres=2026-10-19 --json \
      > "$DOSSIER/comptes-avant.json"; then
    echo "   🔴 un compte actif avec l'ancien mot de passe n'a pas été signalé" >&2
    exit 1
  fi
  echo "   · compte non tourné : signalé (code 1)"
)
"$PG_BIN/psql" "$URL_ADMIN" -q \
  -c "update gf_users set password_updated_at = now() where email = 'admin@geoforest.eu';" >/dev/null
(
  cd "$RACINE"
  if ! DATABASE_URL_ADMIN="$URL_ADMIN" npx tsx scripts/verifier-comptes-demo.ts --apres=2026-10-19 --json \
      > "$DOSSIER/comptes-apres.json"; then
    echo "   🔴 un compte déjà tourné reste signalé" >&2
    exit 1
  fi
  echo "   · compte tourné : plus signalé (code 0)"
)
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT_DB" -U postgres -d geoforest_recette -q \
  -c "alter role geoforest_owner nobypassrls;"

echo
echo "✅ Recette PostgreSQL serveur terminée sans échec."
