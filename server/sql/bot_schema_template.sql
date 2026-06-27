-- =============================================================================
-- TEMPLATE DE SCHEMA POR BOT
--
-- Como usar:
--   Substitua "bot_SLUG" pelo slug real do bot (ex: bot_geral, bot_ticket).
--   psql "$DATABASE_URL" -v schema=bot_geral -f sql/bot_schema_template.sql
--
-- Ou simplesmente faça um search/replace de "bot_SLUG" neste arquivo
-- e execute o resultado.
--
-- Relacionamento:
--   bot_id aqui corresponde a site.bots.id
--   Foreign key cross-schema é suportada normalmente pelo PostgreSQL.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS bot_SLUG;

SET search_path TO bot_SLUG;

-- ---------------------------------------------------------------------------
-- 1. bot_logs
--    Registros de eventos do bot (pings, comandos, erros, mensagens do manager).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bot_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id      uuid        NOT NULL,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  type        text        NOT NULL CHECK (type IN ('ping', 'command', 'error', 'manager')),
  data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bot_logs_bot_fk
    FOREIGN KEY (bot_id)
    REFERENCES site.bots (id)
    ON DELETE CASCADE
);

-- Nota: bot_status (heartbeat / online-offline) fica em site.bot_status
--       para que o painel possa consultá-lo sem JOIN cross-schema.

-- ---------------------------------------------------------------------------
-- 3. guild_configs
--    Configuração do bot em cada servidor Discord (guild).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS guild_configs (
  guild_id                 text        PRIMARY KEY,
  bot_id                   uuid        NOT NULL,
  log_channel_id           text        NOT NULL DEFAULT '',
  ticket_category_id       text        NOT NULL DEFAULT '',
  ticket_log_channel_id    text        NOT NULL DEFAULT '',
  whitelist_channel_id     text        NOT NULL DEFAULT '',
  whitelist_log_channel_id text        NOT NULL DEFAULT '',
  whitelist_role_id        text        NOT NULL DEFAULT '',
  verified_role_id         text        NOT NULL DEFAULT '',
  staff_role_id            text        NOT NULL DEFAULT '',
  admin_role_id            text        NOT NULL DEFAULT '',
  max_tickets_per_user     int         NOT NULL DEFAULT 3
                                       CHECK (max_tickets_per_user BETWEEN 1 AND 100),
  ticket_prefix            text        NOT NULL DEFAULT 'ticket',
  whitelist_pass_message   text        NOT NULL DEFAULT '',
  whitelist_fail_message   text        NOT NULL DEFAULT '',
  welcome_message          text        NOT NULL DEFAULT '',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT guild_configs_bot_fk
    FOREIGN KEY (bot_id)
    REFERENCES site.bots (id)
    ON DELETE CASCADE
);

-- =============================================================================
-- FUNÇÕES E TRIGGERS
-- =============================================================================

CREATE OR REPLACE FUNCTION set_guild_configs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guild_configs_updated_at ON guild_configs;

CREATE TRIGGER trg_guild_configs_updated_at
BEFORE UPDATE ON guild_configs
FOR EACH ROW
EXECUTE FUNCTION set_guild_configs_updated_at();

-- =============================================================================
-- ÍNDICES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_bot_logs_bot_id_timestamp
  ON bot_logs (bot_id, "timestamp" DESC);

CREATE INDEX IF NOT EXISTS idx_bot_logs_type
  ON bot_logs (type);

CREATE INDEX IF NOT EXISTS idx_guild_configs_bot_id
  ON guild_configs (bot_id);

-- =============================================================================
-- FIM DO TEMPLATE
-- =============================================================================
