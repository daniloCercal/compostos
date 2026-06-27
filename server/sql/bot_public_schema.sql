-- =============================================================================
-- SCHEMA PÚBLICO DO BOT (tabelas operacionais)
--
-- Como aplicar no Supabase:
--   SQL Editor → New query → cole este arquivo → Run
--
-- Estas tabelas ficam no schema public e são usadas diretamente pelo bot Go.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- guild_configs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.guild_configs (
  guild_id                 text        PRIMARY KEY,
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
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- tickets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tickets (
  id            bigserial   PRIMARY KEY,
  guild_id      text        NOT NULL,
  channel_id    text        NOT NULL UNIQUE,
  user_id       text        NOT NULL,
  ticket_number int         NOT NULL,
  category      text        NOT NULL DEFAULT '',
  status        text        NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'claimed', 'closed')),
  claimed_staff jsonb       NOT NULL DEFAULT '[]'::jsonb,
  dm_notify     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  close_reason  text        NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_tickets_guild_id
  ON public.tickets (guild_id);

CREATE INDEX IF NOT EXISTS idx_tickets_user_id
  ON public.tickets (guild_id, user_id);

CREATE INDEX IF NOT EXISTS idx_tickets_status
  ON public.tickets (guild_id, status);

-- ---------------------------------------------------------------------------
-- ticket_messages
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id          bigserial   PRIMARY KEY,
  ticket_id   bigint      NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  author_id   text        NOT NULL,
  author_name text        NOT NULL DEFAULT '',
  content     text        NOT NULL DEFAULT '',
  attachments text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id
  ON public.ticket_messages (ticket_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- allowlist_applications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.allowlist_applications (
  id                  bigserial   PRIMARY KEY,
  guild_id            text        NOT NULL,
  user_id             text        NOT NULL,
  channel_id          text        NOT NULL DEFAULT '',
  app_number          int         NOT NULL DEFAULT 0,
  status              text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'theory_passed', 'approved', 'rejected', 'cancelled', 'timed_out')),
  answers             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  current_question    int         NOT NULL DEFAULT 0,
  started_at          timestamptz,
  question_started_at timestamptz,
  reviewed_by         text        NOT NULL DEFAULT '',
  review_note         text        NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_allowlist_apps_guild_user
  ON public.allowlist_applications (guild_id, user_id);

CREATE INDEX IF NOT EXISTS idx_allowlist_apps_status
  ON public.allowlist_applications (guild_id, status);

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id         bigserial   PRIMARY KEY,
  guild_id   text        NOT NULL,
  actor_id   text        NOT NULL,
  action     text        NOT NULL,
  target_id  text,
  meta       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_guild_id
  ON public.audit_logs (guild_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- verification_attempts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.verification_attempts (
  id         bigserial   PRIMARY KEY,
  guild_id   text        NOT NULL,
  user_id    text        NOT NULL,
  success    boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_attempts_guild_user
  ON public.verification_attempts (guild_id, user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- site.bot_actions  (consumidas pelo bot Go via polling a cada 2s)
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS site;

CREATE TABLE IF NOT EXISTS site.bot_actions (
  id           bigserial   PRIMARY KEY,
  guild_id     text        NOT NULL DEFAULT '',
  action_type  text        NOT NULL,
  payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'done', 'failed')),
  result       text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_bot_actions_status
  ON site.bot_actions (status, created_at ASC)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- site.whitelist_questions  (lidas pelo bot Go)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS site.whitelist_questions (
  id            bigserial   PRIMARY KEY,
  bot_id        uuid        NOT NULL,
  order_index   int         NOT NULL DEFAULT 0,
  field_key     text        NOT NULL DEFAULT '',
  question_text text        NOT NULL DEFAULT '',
  correct_answer text       NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whitelist_questions_bot_id
  ON site.whitelist_questions (bot_id, order_index ASC);

-- =============================================================================
-- MIGRAÇÕES — adicionar colunas novas em tabelas existentes
-- (idempotentes: ADD COLUMN IF NOT EXISTS)
-- =============================================================================

ALTER TABLE public.guild_configs
  ADD COLUMN IF NOT EXISTS whitelist_pass_score int NOT NULL DEFAULT 80;

ALTER TABLE public.guild_configs
  ADD COLUMN IF NOT EXISTS panel_configs jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.allowlist_applications
  ADD COLUMN IF NOT EXISTS quiz_state jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE site.whitelist_questions
  ADD COLUMN IF NOT EXISTS question_type text NOT NULL DEFAULT 'open';

ALTER TABLE site.whitelist_questions
  ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE site.whitelist_questions
  ADD COLUMN IF NOT EXISTS correct_index int NOT NULL DEFAULT 0;

-- Permitir status 'timed_out' em aplicações (expiração por inatividade).
ALTER TABLE public.allowlist_applications
  DROP CONSTRAINT IF EXISTS allowlist_applications_status_check;

ALTER TABLE public.allowlist_applications
  ADD CONSTRAINT allowlist_applications_status_check
  CHECK (status IN ('pending', 'theory_passed', 'approved', 'rejected', 'cancelled', 'timed_out'));

-- =============================================================================
-- FIM
-- =============================================================================
