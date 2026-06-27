-- Supabase/Postgres schema for bots admin panel (dashboard-only)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  token text NOT NULL DEFAULT '',
  commands jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Backward-compatible migration from legacy discord_* columns
ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS token text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bots'
      AND column_name = 'discord_token'
  ) THEN
    EXECUTE $sql$
      UPDATE public.bots
      SET token = COALESCE(token, discord_token, '')
      WHERE token IS NULL
    $sql$;
  END IF;
END;
$$;

UPDATE public.bots
SET token = ''
WHERE token IS NULL;

ALTER TABLE public.bots
  ALTER COLUMN token SET DEFAULT '';

ALTER TABLE public.bots
  ALTER COLUMN token SET NOT NULL;

ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS commands jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;

UPDATE public.bots
SET is_active = false
WHERE is_active IS NULL;

ALTER TABLE public.bots
  ALTER COLUMN is_active SET DEFAULT false;

ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.bot_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL CHECK (type IN ('ping', 'command', 'error', 'manager')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_logs
  DROP CONSTRAINT IF EXISTS bot_logs_type_check;

ALTER TABLE public.bot_logs
  ADD CONSTRAINT bot_logs_type_check CHECK (type IN ('ping', 'command', 'error', 'manager'));

CREATE TABLE IF NOT EXISTS public.bot_runtime_status (
  bot_id uuid PRIMARY KEY REFERENCES public.bots(id) ON DELETE CASCADE,
  container_name text,
  container_status text,
  health_status text,
  is_running boolean NOT NULL DEFAULT false,
  cpu_percent numeric(8,2),
  memory_usage_bytes bigint,
  memory_limit_bytes bigint,
  memory_percent numeric(8,2),
  health_score int NOT NULL DEFAULT 0,
  last_error text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_runtime_status
  DROP CONSTRAINT IF EXISTS bot_runtime_status_health_score_check;

ALTER TABLE public.bot_runtime_status
  ADD CONSTRAINT bot_runtime_status_health_score_check CHECK (health_score >= 0 AND health_score <= 100);

CREATE INDEX IF NOT EXISTS idx_bots_created_at
  ON public.bots (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_logs_bot_id_timestamp
  ON public.bot_logs (bot_id, "timestamp" DESC);

CREATE INDEX IF NOT EXISTS idx_bot_runtime_status_checked_at
  ON public.bot_runtime_status (checked_at DESC);

CREATE OR REPLACE FUNCTION public.set_bots_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bots_updated_at ON public.bots;
CREATE TRIGGER trg_bots_updated_at
BEFORE UPDATE ON public.bots
FOR EACH ROW
EXECUTE FUNCTION public.set_bots_updated_at();

CREATE OR REPLACE FUNCTION public.set_bot_runtime_status_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bot_runtime_status_updated_at ON public.bot_runtime_status;
CREATE TRIGGER trg_bot_runtime_status_updated_at
BEFORE UPDATE ON public.bot_runtime_status
FOR EACH ROW
EXECUTE FUNCTION public.set_bot_runtime_status_updated_at();
