-- Délais de sécurité posés sur le rôle applicatif (P1-07).
--
-- ⚠️ Pourquoi au niveau du rôle et non dans le pool :
--   les paramètres `statement_timeout` et `idle_in_transaction_session_timeout`
--   envoyés à la connexion (paramètres de démarrage) sont refusés ou ignorés
--   par le pooleur de Neon (PgBouncer) : la base garde alors ses valeurs par
--   défaut (0 et 5 min), constaté par `scripts/check-sql-limits.ts` le
--   15/10/2026 sur la branche de CI. Un réglage porté par le rôle s'applique à
--   chaque connexion, quel que soit le point d'entrée.
--
-- Valeurs identiques à `src/lib/api/limits.ts` (SQL_STATEMENT_TIMEOUT_MS,
-- SQL_IDLE_IN_TRANSACTION_TIMEOUT_MS). Script idempotent : relancé à chaque
-- migration, il réaffirme les mêmes valeurs.
alter role geoforest_app set statement_timeout = '10s';
alter role geoforest_app set idle_in_transaction_session_timeout = '15s';
