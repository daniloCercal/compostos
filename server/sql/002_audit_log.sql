-- =============================================================================
-- AUDIT LOG (schema site)
--   Registra cada request autenticada no painel admin: quem acessou, qual rota,
--   método, status e duração. Alimenta a visão de auditoria restrita ao CEO.
--
-- Como aplicar:
--   psql "$DATABASE_URL" -f sql/002_audit_log.sql
-- =============================================================================

SET search_path TO site;

CREATE TABLE IF NOT EXISTS audit_log (
  id           bigserial   PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  -- Quem (resolvido pelo principal). ON DELETE SET NULL preserva o histórico
  -- mesmo que a conta admin seja removida depois.
  user_id      uuid        REFERENCES admin_users (id) ON DELETE SET NULL,
  user_email   text,
  user_role    text,
  -- O quê
  method       text        NOT NULL,
  path         text        NOT NULL,
  status_code  int,
  duration_ms  int,
  -- Contexto
  ip           text,
  user_agent   text
);

CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at ON audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id    ON audit_log (user_id);
