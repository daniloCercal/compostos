-- =============================================================================
-- SCHEMA PRINCIPAL DO SITE (painel admin)
--
-- Estrutura de schemas:
--   site          → este arquivo — painel admin, sessões, registro de bots
--   bot_<slug>    → criado por bot — logs, status de container, guild_configs
--
-- Como aplicar:
--   psql "$DATABASE_URL" -f sql/site.sql
--
-- Requisitos:
--   PostgreSQL 14+
--   O role que executar este script precisa de CONNECT + CREATE no banco.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS site;

-- Todas as instruções abaixo usam o schema site por padrão.
SET search_path TO site;

-- ---------------------------------------------------------------------------
-- Extensões  (executadas no schema public — padrão do PostgreSQL)
-- ---------------------------------------------------------------------------

-- gen_random_uuid() está disponível nativamente no PostgreSQL 13+.
-- Se precisar de uuid_generate_v4(), descomente a linha abaixo:
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public;

-- ---------------------------------------------------------------------------
-- 1. admin_users
--    Contas do painel admin.
--    Roles:
--      ceo   → acesso total, único que pode criar contas "admin"
--      admin → gerencia usuários "user" e todos os bots
--      user  → somente leitura nos bots
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin_users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL,
  display_name  text        NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  password_hash text        NOT NULL,
  role          text        NOT NULL CHECK (role IN ('ceo', 'admin', 'user')),
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,

  CONSTRAINT admin_users_email_unique UNIQUE (email),
  CONSTRAINT admin_users_email_format CHECK (email = lower(trim(email)))
);

-- ---------------------------------------------------------------------------
-- 2. user_sessions
--    Sessões Lucia Auth — IDs opacos aleatórios, sem JWT.
--    csrf_token é gerado no login e validado em todas as mutações.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_sessions (
  id          text        PRIMARY KEY,
  user_id     uuid        NOT NULL,
  expires_at  timestamptz NOT NULL,
  csrf_token  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_sessions_user_fk
    FOREIGN KEY (user_id)
    REFERENCES admin_users (id)
    ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 3. bots
--    Registro central de bots.
--    Cada bot pode ter um schema próprio (bot_<slug>) para suas tabelas
--    operacionais (logs, status de runtime, guild_configs).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bots (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text    NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  token      text    NOT NULL DEFAULT '',          -- encriptado em repouso (AES-256-GCM) quando BOT_TOKEN_ENC_KEY definido
  token_hash text    NOT NULL DEFAULT '',          -- SHA-256(token) hex; lookup determinístico usado pelo bot
  commands   jsonb   NOT NULL DEFAULT '[]'::jsonb,
  is_active  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Migração idempotente para bancos existentes.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS token_hash text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_bots_token_hash ON bots (token_hash) WHERE token_hash <> '';

-- ---------------------------------------------------------------------------
-- 4. admin_user_bot_access
--    Controla quais bots cada admin/user pode visualizar e gerenciar.
--    ceo não precisa de linha aqui — seu scope é "all" por role.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin_user_bot_access (
  user_id    uuid        NOT NULL,
  bot_id     uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, bot_id),

  CONSTRAINT admin_user_bot_access_user_fk
    FOREIGN KEY (user_id)
    REFERENCES admin_users (id)
    ON DELETE CASCADE,

  CONSTRAINT admin_user_bot_access_bot_fk
    FOREIGN KEY (bot_id)
    REFERENCES bots (id)
    ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 5. bot_status
--    Escrito pelo bot (DisCloud) via heartbeat a cada 30s.
--    O painel lê e deriva is_online = last_seen_at > now() - 2 min.
--
--    Contrato de escrita para o bot Go:
--      • Na inicialização  → upsert com status='online', started_at=now()
--      • A cada 30s        → UPDATE last_seen_at, guilds_count, latency_ms
--      • Em erro           → UPDATE status='error', error_message=...
--      • No shutdown       → UPDATE status='offline'
--      • Após restart      → UPDATE started_at=now() (limpa restart_requested_at)
--
--    Contrato de escrita para o painel Node.js:
--      • Ao clicar "reiniciar" → UPDATE restart_requested_at=now()
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bot_status (
  bot_id               uuid        PRIMARY KEY,
  status               text        NOT NULL DEFAULT 'offline'
                                   CHECK (status IN ('online', 'offline', 'error')),
  last_seen_at         timestamptz,
  started_at           timestamptz,
  restart_requested_at timestamptz,
  guilds_count         int,
  latency_ms           int,
  error_message        text,
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bot_status_bot_fk
    FOREIGN KEY (bot_id)
    REFERENCES bots (id)
    ON DELETE CASCADE
);

-- =============================================================================
-- FUNÇÕES E TRIGGERS (updated_at automático)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- admin_users → updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_admin_users_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON admin_users;

CREATE TRIGGER trg_admin_users_updated_at
BEFORE UPDATE ON admin_users
FOR EACH ROW
EXECUTE FUNCTION set_admin_users_updated_at();

-- ---------------------------------------------------------------------------
-- bot_status → updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_bot_status_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bot_status_updated_at ON bot_status;

CREATE TRIGGER trg_bot_status_updated_at
BEFORE UPDATE ON bot_status
FOR EACH ROW
EXECUTE FUNCTION set_bot_status_updated_at();

-- ---------------------------------------------------------------------------
-- bots → updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_bots_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bots_updated_at ON bots;

CREATE TRIGGER trg_bots_updated_at
BEFORE UPDATE ON bots
FOR EACH ROW
EXECUTE FUNCTION set_bots_updated_at();

-- =============================================================================
-- ÍNDICES
-- =============================================================================

-- admin_users
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email
  ON admin_users (email);

-- user_sessions
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
  ON user_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at
  ON user_sessions (expires_at);

-- bots
CREATE INDEX IF NOT EXISTS idx_bots_created_at
  ON bots (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bots_is_active
  ON bots (is_active)
  WHERE is_active = true;

-- admin_user_bot_access
CREATE INDEX IF NOT EXISTS idx_admin_user_bot_access_user_id
  ON admin_user_bot_access (user_id);

CREATE INDEX IF NOT EXISTS idx_admin_user_bot_access_bot_id
  ON admin_user_bot_access (bot_id);

-- bot_status
CREATE INDEX IF NOT EXISTS idx_bot_status_last_seen_at
  ON bot_status (last_seen_at DESC);

-- =============================================================================
-- FIM DO SCHEMA SITE
--
-- Próximo passo: para cada bot, criar o schema operacional dele com:
--   server/sql/bot_schema_template.sql
-- =============================================================================
