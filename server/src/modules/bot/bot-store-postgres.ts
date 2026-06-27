import { Pool } from "pg";

import type { Bot, BotCommand, BotLog, BotStatus, GuildConfig, WhitelistQuestion, ExtendedGuildConfig, Ticket, PanelEmbedConfig, PanelConfigs } from "../../types";
import { createId } from "../../utils/id";
import { encryptSecret, decryptSecret, tokenHash } from "../../utils/crypto";
import { buildPostgresSsl } from "../../utils/pg";
import { env } from "../../config/env";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type BotRow = {
  id: string;
  name: string;
  token: string;
  commands: unknown;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type BotLogRow = {
  id: string;
  bot_id: string;
  timestamp: Date | string;
  type: "ping" | "command" | "error" | "manager";
  data: unknown;
  created_at: Date | string;
};

type BotStatusRow = {
  bot_id: string;
  bot_name: string;
  is_active: boolean;
  bot_updated_at: Date | string;
  status: "online" | "offline" | "error";
  last_seen_at: Date | string | null;
  started_at: Date | string | null;
  restart_requested_at: Date | string | null;
  guilds_count: number | null;
  latency_ms: number | null;
  error_message: string | null;
  status_updated_at: Date | string | null;
};

type WhitelistQuestionRow = {
  id: string;
  bot_id: string;
  order_index: number;
  field_key: string;
  question_text: string;
  correct_answer: string;
  question_type: string;
  options: unknown;
  correct_index: number;
};

type GuildConfigRow = {
  guild_id: string;
  log_channel_id: string;
  ticket_category_id: string;
  ticket_log_channel_id: string;
  whitelist_channel_id: string;
  whitelist_log_channel_id: string;
  whitelist_role_id: string;
  verified_role_id: string;
  staff_role_id: string;
  admin_role_id: string;
  max_tickets_per_user: number | string;
  ticket_prefix: string;
  whitelist_pass_message: string;
  whitelist_fail_message: string;
  welcome_message: string;
  whitelist_pass_score: number | string;
  panel_configs: unknown;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type ExtendedGuildConfigRow = {
  guild_id: string;
  embed_color: number;
  ticket_image_url: string;
  welcome_image_url: string;
  dm_notify_default: boolean;
};

type TicketRow = {
  id: string | number;
  guild_id: string;
  channel_id: string;
  user_id: string;
  ticket_number: number | string;
  category: string;
  status: string;
  dm_notify: boolean;
  created_at: Date | string;
  closed_at: Date | string | null;
  close_reason: string | null;
};

type UpdatableBotFields = {
  name: string;
  token: string;
  commands: BotCommand[];
  isActive: boolean;
};

// ---------------------------------------------------------------------------
// DDL — banco novo, sem DDL de migração legada
// ---------------------------------------------------------------------------

const CREATE_BOTS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS bots (
    id         uuid    PRIMARY KEY,
    name       text    NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    token      text    NOT NULL DEFAULT '',
    commands   jsonb   NOT NULL DEFAULT '[]'::jsonb,
    is_active  boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`;

// token_hash: lookup determinístico do bot por token (SHA-256), permitindo que
// a coluna `token` seja encriptada em repouso sem quebrar o ResolveBotID do bot.
const ALTER_BOTS_TOKEN_HASH_DDL = `
  ALTER TABLE bots ADD COLUMN IF NOT EXISTS token_hash text NOT NULL DEFAULT ''
`;

const CREATE_BOTS_TOKEN_HASH_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_bots_token_hash ON bots (token_hash) WHERE token_hash <> ''
`;

const CREATE_BOT_LOGS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS bot_logs (
    id          uuid        PRIMARY KEY,
    bot_id      uuid        NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    "timestamp" timestamptz NOT NULL DEFAULT now(),
    type        text        NOT NULL CHECK (type IN ('ping', 'command', 'error', 'manager')),
    data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
  )
`;

const CREATE_BOT_STATUS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS bot_status (
    bot_id               uuid        PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
    status               text        NOT NULL DEFAULT 'offline'
                                     CHECK (status IN ('online', 'offline', 'error')),
    last_seen_at         timestamptz,
    started_at           timestamptz,
    restart_requested_at timestamptz,
    guilds_count         int,
    latency_ms           int,
    error_message        text,
    updated_at           timestamptz NOT NULL DEFAULT now()
  )
`;

const CREATE_GUILD_CONFIGS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS guild_configs (
    guild_id                 text        PRIMARY KEY,
    bot_id                   uuid        NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
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
  )
`;

const CREATE_SET_BOTS_UPDATED_AT_FN_DDL = `
  CREATE OR REPLACE FUNCTION set_bots_updated_at()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
`;

const DROP_BOTS_UPDATED_AT_TRIGGER_DDL = `
  DROP TRIGGER IF EXISTS trg_bots_updated_at ON bots
`;

const CREATE_BOTS_UPDATED_AT_TRIGGER_DDL = `
  CREATE TRIGGER trg_bots_updated_at
  BEFORE UPDATE ON bots
  FOR EACH ROW EXECUTE FUNCTION set_bots_updated_at()
`;

const CREATE_SET_BOT_STATUS_UPDATED_AT_FN_DDL = `
  CREATE OR REPLACE FUNCTION set_bot_status_updated_at()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
`;

const DROP_BOT_STATUS_UPDATED_AT_TRIGGER_DDL = `
  DROP TRIGGER IF EXISTS trg_bot_status_updated_at ON bot_status
`;

const CREATE_BOT_STATUS_UPDATED_AT_TRIGGER_DDL = `
  CREATE TRIGGER trg_bot_status_updated_at
  BEFORE UPDATE ON bot_status
  FOR EACH ROW EXECUTE FUNCTION set_bot_status_updated_at()
`;

const CREATE_SET_GUILD_CONFIGS_UPDATED_AT_FN_DDL = `
  CREATE OR REPLACE FUNCTION set_guild_configs_updated_at()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
`;

const DROP_GUILD_CONFIGS_UPDATED_AT_TRIGGER_DDL = `
  DROP TRIGGER IF EXISTS trg_guild_configs_updated_at ON guild_configs
`;

const CREATE_GUILD_CONFIGS_UPDATED_AT_TRIGGER_DDL = `
  CREATE TRIGGER trg_guild_configs_updated_at
  BEFORE UPDATE ON guild_configs
  FOR EACH ROW EXECUTE FUNCTION set_guild_configs_updated_at()
`;

const CREATE_BOTS_CREATED_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_bots_created_at ON bots (created_at DESC)
`;

const CREATE_BOT_LOGS_BOT_TIMESTAMP_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_bot_logs_bot_id_timestamp
  ON bot_logs (bot_id, "timestamp" DESC)
`;

const CREATE_BOT_STATUS_LAST_SEEN_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_bot_status_last_seen_at
  ON bot_status (last_seen_at DESC)
`;

const CREATE_GUILD_CONFIGS_BOT_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_guild_configs_bot_id ON guild_configs (bot_id)
`;

const CREATE_WHITELIST_QUESTIONS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS whitelist_questions (
    id             uuid        PRIMARY KEY,
    bot_id         uuid        NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    order_index    int         NOT NULL DEFAULT 0,
    field_key      text        NOT NULL,
    question_text  text        NOT NULL DEFAULT '',
    correct_answer text        NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (bot_id, field_key)
  )
`;

const CREATE_WHITELIST_QUESTIONS_BOT_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_whitelist_questions_bot_id
  ON whitelist_questions (bot_id, order_index)
`;

const ALTER_GUILD_CONFIGS_EMBED_COLOR_DDL = `
  ALTER TABLE guild_configs ADD COLUMN IF NOT EXISTS embed_color int NOT NULL DEFAULT 9175040
`;

const ALTER_GUILD_CONFIGS_TICKET_IMAGE_DDL = `
  ALTER TABLE guild_configs ADD COLUMN IF NOT EXISTS ticket_image_url text NOT NULL DEFAULT ''
`;

const ALTER_GUILD_CONFIGS_WELCOME_IMAGE_DDL = `
  ALTER TABLE guild_configs ADD COLUMN IF NOT EXISTS welcome_image_url text NOT NULL DEFAULT ''
`;

const ALTER_GUILD_CONFIGS_DM_NOTIFY_DDL = `
  ALTER TABLE guild_configs ADD COLUMN IF NOT EXISTS dm_notify_default boolean NOT NULL DEFAULT true
`;

const CREATE_BOT_ACTIONS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS bot_actions (
    id           bigserial   PRIMARY KEY,
    guild_id     text        NOT NULL DEFAULT '',
    action_type  text        NOT NULL,
    payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    status       text        NOT NULL DEFAULT 'pending',
    result       text        NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz
  )
`;

const ALTER_PUBLIC_TICKETS_DM_NOTIFY_DDL = `
  ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS dm_notify boolean NOT NULL DEFAULT true
`;

const ALTER_GUILD_CONFIGS_PASS_SCORE_DDL = `
  ALTER TABLE guild_configs ADD COLUMN IF NOT EXISTS whitelist_pass_score int NOT NULL DEFAULT 80
`;

const ALTER_GUILD_CONFIGS_PANEL_CONFIGS_DDL = `
  ALTER TABLE guild_configs ADD COLUMN IF NOT EXISTS panel_configs jsonb NOT NULL DEFAULT '{}'::jsonb
`;

const ALTER_WHITELIST_QUESTIONS_TYPE_DDL = `
  ALTER TABLE whitelist_questions ADD COLUMN IF NOT EXISTS question_type text NOT NULL DEFAULT 'open'
`;

const ALTER_WHITELIST_QUESTIONS_OPTIONS_DDL = `
  ALTER TABLE whitelist_questions ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '[]'::jsonb
`;

const ALTER_WHITELIST_QUESTIONS_CORRECT_INDEX_DDL = `
  ALTER TABLE whitelist_questions ADD COLUMN IF NOT EXISTS correct_index int NOT NULL DEFAULT 0
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutos sem heartbeat = offline

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function toNullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function toNullableInt(value: number | null): number | null {
  if (value === null) return null;
  return Number.isFinite(value) ? Math.round(value) : null;
}

function normalizeCommands(value: unknown): BotCommand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const cmd = item as Record<string, unknown>;
    if (typeof cmd.name !== "string" || typeof cmd.response !== "string") return [];
    return [{ name: cmd.name, response: cmd.response }];
  });
}

function normalizeLogData(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function postgresErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function rowToBot(row: BotRow): Bot {
  return {
    id: row.id,
    name: row.name,
    // Desencripta de forma transparente; valores legados (sem prefixo) passam direto.
    token: decryptSecret(row.token, env.BOT_TOKEN_ENC_KEY),
    commands: normalizeCommands(row.commands),
    isActive: Boolean(row.is_active),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToBotLog(row: BotLogRow): BotLog {
  return {
    id: row.id,
    botId: row.bot_id,
    timestamp: toIso(row.timestamp),
    type: row.type,
    data: normalizeLogData(row.data),
    createdAt: toIso(row.created_at),
  };
}

function rowToBotStatus(row: BotStatusRow): BotStatus {
  const lastSeenAt = row.last_seen_at ? toIso(row.last_seen_at) : null;
  const isOnline =
    lastSeenAt !== null &&
    Date.now() - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;

  return {
    botId: row.bot_id,
    botName: row.bot_name,
    isActive: Boolean(row.is_active),
    botUpdatedAt: toIso(row.bot_updated_at),
    status: row.status ?? "offline",
    lastSeenAt,
    startedAt: toNullableIso(row.started_at),
    restartRequestedAt: toNullableIso(row.restart_requested_at),
    guildsCount: toNullableInt(row.guilds_count),
    latencyMs: toNullableInt(row.latency_ms),
    errorMessage: row.error_message,
    statusUpdatedAt: toNullableIso(row.status_updated_at),
    isOnline,
  };
}

function rowToGuildConfig(row: GuildConfigRow): GuildConfig {
  return {
    guildId: row.guild_id,
    logChannelId: row.log_channel_id ?? "",
    ticketCategoryId: row.ticket_category_id ?? "",
    ticketLogChannelId: row.ticket_log_channel_id ?? "",
    whitelistChannelId: row.whitelist_channel_id ?? "",
    whitelistLogChannelId: row.whitelist_log_channel_id ?? "",
    whitelistRoleId: row.whitelist_role_id ?? "",
    verifiedRoleId: row.verified_role_id ?? "",
    staffRoleId: row.staff_role_id ?? "",
    adminRoleId: row.admin_role_id ?? "",
    maxTicketsPerUser:
      typeof row.max_tickets_per_user === "number"
        ? row.max_tickets_per_user
        : Number.parseInt(String(row.max_tickets_per_user), 10) || 3,
    ticketPrefix: row.ticket_prefix ?? "ticket",
    whitelistPassMessage: row.whitelist_pass_message ?? "",
    whitelistFailMessage: row.whitelist_fail_message ?? "",
    welcomeMessage: row.welcome_message ?? "",
    whitelistPassScore:
      typeof row.whitelist_pass_score === "number"
        ? row.whitelist_pass_score
        : Number.parseInt(String(row.whitelist_pass_score ?? "80"), 10) || 80,
    panelConfigs: normalizePanelConfigs(row.panel_configs),
    createdAt: toNullableIso(row.created_at as Date | string | null),
    updatedAt: toNullableIso(row.updated_at as Date | string | null),
  };
}

function normalizePanelEmbed(v: unknown): PanelEmbedConfig {
  const o = typeof v === "object" && v !== null ? v as Record<string, unknown> : {};
  return {
    title: String(o.title ?? ""),
    description: String(o.description ?? ""),
    buttonLabel: String(o.buttonLabel ?? o.button_label ?? ""),
    placeholder: String(o.placeholder ?? ""),
  };
}

function normalizePanelConfigs(v: unknown): PanelConfigs {
  const o = typeof v === "object" && v !== null ? v as Record<string, unknown> : {};
  return {
    whitelist: normalizePanelEmbed(o.whitelist),
    tickets: normalizePanelEmbed(o.tickets),
    verification: normalizePanelEmbed(o.verification),
  };
}

function normalizeOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string") as string[];
}

function rowToWhitelistQuestion(row: WhitelistQuestionRow): WhitelistQuestion {
  return {
    id: row.id,
    botId: row.bot_id,
    orderIndex: Number(row.order_index),
    fieldKey: row.field_key,
    questionText: row.question_text,
    correctAnswer: row.correct_answer,
    questionType: row.question_type === "quiz" ? "quiz" : "open",
    options: normalizeOptions(row.options),
    correctIndex: Number(row.correct_index ?? 0),
  };
}

function rowToExtendedConfig(row: ExtendedGuildConfigRow): ExtendedGuildConfig {
  return {
    guildId: row.guild_id,
    embedColor: Number(row.embed_color) || 0x8B0000,
    ticketImageUrl: row.ticket_image_url ?? "",
    welcomeImageUrl: row.welcome_image_url ?? "",
    dmNotifyDefault: Boolean(row.dm_notify_default),
  };
}

function rowToTicket(row: TicketRow): Ticket {
  return {
    id: Number(row.id),
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    ticketNumber: Number(row.ticket_number),
    category: row.category ?? "",
    status: row.status ?? "open",
    dmNotify: Boolean(row.dm_notify),
    createdAt: toIso(row.created_at),
    closedAt: row.closed_at ? toIso(row.closed_at) : null,
    closeReason: row.close_reason ?? "",
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class BotStorePostgres {
  private readonly pool: Pool;
  private readyPromise: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    const normalized = databaseUrl.trim();
    if (!normalized) throw new Error("DATABASE_URL invalido");

    this.pool = new Pool({
      connectionString: normalized,
      ssl: buildPostgresSsl(normalized),
      options: "-c search_path=site",
    });
  }

  async list(): Promise<Bot[]> {
    await this.ensureReady();
    const result = await this.pool.query<BotRow>(
      `SELECT id, name, token, commands, is_active, created_at, updated_at
       FROM bots ORDER BY created_at DESC`
    );
    return result.rows.map(rowToBot);
  }

  async listStatus(): Promise<BotStatus[]> {
    await this.ensureReady();
    const result = await this.pool.query<BotStatusRow>(
      `SELECT
         b.id          AS bot_id,
         b.name        AS bot_name,
         b.is_active,
         b.updated_at  AS bot_updated_at,
         COALESCE(s.status, 'offline') AS status,
         s.last_seen_at,
         s.started_at,
         s.restart_requested_at,
         s.guilds_count,
         s.latency_ms,
         s.error_message,
         s.updated_at  AS status_updated_at
       FROM bots b
       LEFT JOIN bot_status s ON s.bot_id = b.id
       ORDER BY b.created_at DESC`
    );
    return result.rows.map(rowToBotStatus);
  }

  async getById(id: string): Promise<Bot | null> {
    await this.ensureReady();
    const result = await this.pool.query<BotRow>(
      `SELECT id, name, token, commands, is_active, created_at, updated_at
       FROM bots WHERE id = $1 LIMIT 1`,
      [id]
    );
    const row = result.rows[0];
    return row ? rowToBot(row) : null;
  }

  async create(input: Bot): Promise<Bot> {
    await this.ensureReady();
    const result = await this.pool.query<BotRow>(
      `INSERT INTO bots (id, name, token, token_hash, commands, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING id, name, token, commands, is_active, created_at, updated_at`,
      [input.id, input.name, encryptSecret(input.token, env.BOT_TOKEN_ENC_KEY), tokenHash(input.token),
       JSON.stringify(input.commands), input.isActive, input.createdAt, input.updatedAt]
    );
    const row = result.rows[0];
    if (!row) throw new Error("falha ao criar bot");
    return rowToBot(row);
  }

  async updateById(id: string, input: UpdatableBotFields): Promise<Bot | null> {
    await this.ensureReady();
    const result = await this.pool.query<BotRow>(
      `UPDATE bots
       SET name=$2, token=$3, token_hash=$4, commands=$5::jsonb, is_active=$6, updated_at=now()
       WHERE id=$1
       RETURNING id, name, token, commands, is_active, created_at, updated_at`,
      [id, input.name, encryptSecret(input.token, env.BOT_TOKEN_ENC_KEY), tokenHash(input.token),
       JSON.stringify(input.commands), input.isActive]
    );
    const row = result.rows[0];
    return row ? rowToBot(row) : null;
  }

  async touchUpdatedAt(id: string): Promise<Bot | null> {
    await this.ensureReady();
    const result = await this.pool.query<BotRow>(
      `UPDATE bots SET updated_at=now() WHERE id=$1
       RETURNING id, name, token, commands, is_active, created_at, updated_at`,
      [id]
    );
    const row = result.rows[0];
    return row ? rowToBot(row) : null;
  }

  async requestRestart(botId: string): Promise<void> {
    await this.ensureReady();
    // Upsert: cria linha se ainda não existe, depois sinaliza restart.
    await this.pool.query(
      `INSERT INTO bot_status (bot_id, restart_requested_at)
       VALUES ($1, now())
       ON CONFLICT (bot_id) DO UPDATE SET restart_requested_at = now()`,
      [botId]
    );
  }

  async deleteById(id: string): Promise<boolean> {
    await this.ensureReady();
    const result = await this.pool.query(
      `DELETE FROM bots WHERE id=$1`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listLogsByBot(botId: string, limit: number): Promise<BotLog[] | null> {
    await this.ensureReady();
    const exists = await this.pool.query<{ id: string }>(
      `SELECT id FROM bots WHERE id=$1 LIMIT 1`,
      [botId]
    );
    if (exists.rowCount === 0) return null;

    const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
    const result = await this.pool.query<BotLogRow>(
      `SELECT id, bot_id, "timestamp", type, data, created_at
       FROM bot_logs
       WHERE bot_id=$1
       ORDER BY "timestamp" DESC
       LIMIT $2`,
      [botId, bounded]
    );
    return result.rows.map(rowToBotLog);
  }

  async getGuildConfig(guildId: string, botId: string): Promise<GuildConfig | null> {
    await this.ensureReady();
    // Filtra por bot_id: um guild pertence a exatamente um bot (guild_id é PK).
    // Sem isso, um admin de um bot poderia ler a config de guilds de outro bot.
    const result = await this.pool.query<GuildConfigRow>(
      `SELECT guild_id, bot_id, log_channel_id, ticket_category_id,
              ticket_log_channel_id, whitelist_channel_id, whitelist_log_channel_id,
              whitelist_role_id, verified_role_id, staff_role_id, admin_role_id,
              max_tickets_per_user, ticket_prefix, whitelist_pass_message,
              whitelist_fail_message, welcome_message,
              COALESCE(whitelist_pass_score, 80) AS whitelist_pass_score,
              COALESCE(panel_configs, '{}') AS panel_configs,
              created_at, updated_at
       FROM guild_configs WHERE guild_id=$1 AND bot_id=$2 LIMIT 1`,
      [guildId, botId]
    );
    const row = result.rows[0];
    return row ? rowToGuildConfig(row) : null;
  }

  async upsertGuildConfig(
    botId: string,
    guildId: string,
    fields: Omit<GuildConfig, "guildId" | "createdAt" | "updatedAt">
  ): Promise<GuildConfig> {
    await this.ensureReady();
    const passScore = typeof fields.whitelistPassScore === "number" && fields.whitelistPassScore > 0
      ? fields.whitelistPassScore : 80;
    const panelConfigsJson = JSON.stringify(fields.panelConfigs ?? {});
    const result = await this.pool.query<GuildConfigRow>(
      `INSERT INTO guild_configs (
         guild_id, bot_id, log_channel_id, ticket_category_id, ticket_log_channel_id,
         whitelist_channel_id, whitelist_log_channel_id, whitelist_role_id,
         verified_role_id, staff_role_id, admin_role_id,
         max_tickets_per_user, ticket_prefix, whitelist_pass_message,
         whitelist_fail_message, welcome_message, whitelist_pass_score, panel_configs
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
       ON CONFLICT (guild_id) DO UPDATE SET
         bot_id                   = EXCLUDED.bot_id,
         log_channel_id           = EXCLUDED.log_channel_id,
         ticket_category_id       = EXCLUDED.ticket_category_id,
         ticket_log_channel_id    = EXCLUDED.ticket_log_channel_id,
         whitelist_channel_id     = EXCLUDED.whitelist_channel_id,
         whitelist_log_channel_id = EXCLUDED.whitelist_log_channel_id,
         whitelist_role_id        = EXCLUDED.whitelist_role_id,
         verified_role_id         = EXCLUDED.verified_role_id,
         staff_role_id            = EXCLUDED.staff_role_id,
         admin_role_id            = EXCLUDED.admin_role_id,
         max_tickets_per_user     = EXCLUDED.max_tickets_per_user,
         ticket_prefix            = EXCLUDED.ticket_prefix,
         whitelist_pass_message   = EXCLUDED.whitelist_pass_message,
         whitelist_fail_message   = EXCLUDED.whitelist_fail_message,
         welcome_message          = EXCLUDED.welcome_message,
         whitelist_pass_score     = EXCLUDED.whitelist_pass_score,
         panel_configs            = EXCLUDED.panel_configs,
         updated_at               = now()
       RETURNING guild_id, bot_id, log_channel_id, ticket_category_id,
         ticket_log_channel_id, whitelist_channel_id, whitelist_log_channel_id,
         whitelist_role_id, verified_role_id, staff_role_id, admin_role_id,
         max_tickets_per_user, ticket_prefix, whitelist_pass_message,
         whitelist_fail_message, welcome_message,
         COALESCE(whitelist_pass_score, 80) AS whitelist_pass_score,
         COALESCE(panel_configs, '{}') AS panel_configs,
         created_at, updated_at`,
      [guildId, botId,
       fields.logChannelId, fields.ticketCategoryId, fields.ticketLogChannelId,
       fields.whitelistChannelId, fields.whitelistLogChannelId, fields.whitelistRoleId,
       fields.verifiedRoleId, fields.staffRoleId, fields.adminRoleId,
       fields.maxTicketsPerUser, fields.ticketPrefix,
       fields.whitelistPassMessage, fields.whitelistFailMessage, fields.welcomeMessage,
       passScore, panelConfigsJson]
    );
    const row = result.rows[0];
    if (!row) throw new Error("falha ao salvar configuracao do servidor");

    // Sync to public.guild_configs so the Go bot reads the same data
    await this.pool.query(
      `INSERT INTO public.guild_configs (
         guild_id, log_channel_id, ticket_category_id, ticket_log_channel_id,
         whitelist_channel_id, whitelist_log_channel_id, whitelist_role_id,
         verified_role_id, staff_role_id, admin_role_id,
         max_tickets_per_user, ticket_prefix, whitelist_pass_message,
         whitelist_fail_message, welcome_message, whitelist_pass_score, panel_configs
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
       ON CONFLICT (guild_id) DO UPDATE SET
         log_channel_id           = EXCLUDED.log_channel_id,
         ticket_category_id       = EXCLUDED.ticket_category_id,
         ticket_log_channel_id    = EXCLUDED.ticket_log_channel_id,
         whitelist_channel_id     = EXCLUDED.whitelist_channel_id,
         whitelist_log_channel_id = EXCLUDED.whitelist_log_channel_id,
         whitelist_role_id        = EXCLUDED.whitelist_role_id,
         verified_role_id         = EXCLUDED.verified_role_id,
         staff_role_id            = EXCLUDED.staff_role_id,
         admin_role_id            = EXCLUDED.admin_role_id,
         max_tickets_per_user     = EXCLUDED.max_tickets_per_user,
         ticket_prefix            = EXCLUDED.ticket_prefix,
         whitelist_pass_message   = EXCLUDED.whitelist_pass_message,
         whitelist_fail_message   = EXCLUDED.whitelist_fail_message,
         welcome_message          = EXCLUDED.welcome_message,
         whitelist_pass_score     = EXCLUDED.whitelist_pass_score,
         panel_configs            = EXCLUDED.panel_configs,
         updated_at               = now()`,
      [guildId,
       fields.logChannelId, fields.ticketCategoryId, fields.ticketLogChannelId,
       fields.whitelistChannelId, fields.whitelistLogChannelId, fields.whitelistRoleId,
       fields.verifiedRoleId, fields.staffRoleId, fields.adminRoleId,
       fields.maxTicketsPerUser, fields.ticketPrefix,
       fields.whitelistPassMessage, fields.whitelistFailMessage, fields.welcomeMessage,
       passScore, panelConfigsJson]
    );

    return rowToGuildConfig(row);
  }

  async listWhitelistQuestions(botId: string): Promise<WhitelistQuestion[]> {
    await this.ensureReady();
    const result = await this.pool.query<WhitelistQuestionRow>(
      `SELECT id, bot_id, order_index, field_key, question_text, correct_answer,
              COALESCE(question_type, 'open') AS question_type,
              COALESCE(options, '[]'::jsonb) AS options,
              COALESCE(correct_index, 0) AS correct_index
       FROM whitelist_questions WHERE bot_id = $1 ORDER BY order_index ASC`,
      [botId]
    );
    return result.rows.map(rowToWhitelistQuestion);
  }

  async saveWhitelistQuestions(
    botId: string,
    questions: Array<{
      fieldKey: string;
      questionText: string;
      correctAnswer: string;
      orderIndex: number;
      questionType?: string;
      options?: string[];
      correctIndex?: number;
    }>
  ): Promise<WhitelistQuestion[]> {
    await this.ensureReady();

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM whitelist_questions WHERE bot_id = $1`, [botId]);

      const saved: WhitelistQuestion[] = [];
      for (const q of questions) {
        const id = createId();
        const qType = q.questionType === "quiz" ? "quiz" : "open";
        const opts = JSON.stringify(Array.isArray(q.options) ? q.options : []);
        const cidx = typeof q.correctIndex === "number" ? q.correctIndex : 0;
        const result = await client.query<WhitelistQuestionRow>(
          `INSERT INTO whitelist_questions
             (id, bot_id, order_index, field_key, question_text, correct_answer,
              question_type, options, correct_index)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
           RETURNING id, bot_id, order_index, field_key, question_text, correct_answer,
                     question_type, options, correct_index`,
          [id, botId, q.orderIndex, q.fieldKey.trim(), q.questionText, q.correctAnswer,
           qType, opts, cidx]
        );
        const row = result.rows[0];
        if (row) saved.push(rowToWhitelistQuestion(row));
      }

      await client.query("COMMIT");
      return saved;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getExtendedConfig(guildId: string, botId: string): Promise<ExtendedGuildConfig | null> {
    await this.ensureReady();
    const result = await this.pool.query<ExtendedGuildConfigRow>(
      `SELECT guild_id, embed_color, ticket_image_url, welcome_image_url, dm_notify_default
       FROM guild_configs WHERE guild_id = $1 AND bot_id = $2 LIMIT 1`,
      [guildId, botId]
    );
    const row = result.rows[0];
    return row ? rowToExtendedConfig(row) : null;
  }

  /** Retorna o bot_id dono de um guild (ou null se ainda não há config). */
  async getGuildOwnerBotId(guildId: string): Promise<string | null> {
    await this.ensureReady();
    const result = await this.pool.query<{ bot_id: string }>(
      `SELECT bot_id FROM guild_configs WHERE guild_id = $1 LIMIT 1`,
      [guildId]
    );
    return result.rows[0]?.bot_id ?? null;
  }

  async upsertExtendedConfig(
    guildId: string,
    botId: string,
    fields: Omit<ExtendedGuildConfig, "guildId">
  ): Promise<ExtendedGuildConfig> {
    await this.ensureReady();
    const result = await this.pool.query<ExtendedGuildConfigRow>(
      `UPDATE guild_configs
       SET embed_color=$3, ticket_image_url=$4, welcome_image_url=$5, dm_notify_default=$6, updated_at=now()
       WHERE guild_id=$1 AND bot_id=$2
       RETURNING guild_id, embed_color, ticket_image_url, welcome_image_url, dm_notify_default`,
      [guildId, botId, fields.embedColor, fields.ticketImageUrl, fields.welcomeImageUrl, fields.dmNotifyDefault]
    );
    const row = result.rows[0];
    if (!row) throw new Error("servidor não encontrado ou configuração base não existe");
    return rowToExtendedConfig(row);
  }

  async enqueueBotAction(
    guildId: string,
    actionType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      `INSERT INTO site.bot_actions (guild_id, action_type, payload) VALUES ($1, $2, $3::jsonb)`,
      [guildId, actionType, JSON.stringify(payload)]
    );
  }

  async listTickets(guildId: string, botId: string, limit = 50): Promise<Ticket[]> {
    await this.ensureReady();
    const bounded = Math.max(1, Math.min(200, Math.trunc(limit)));
    // Só lista tickets se o guild pertence a este bot (guild_configs.bot_id).
    // public.tickets não tem bot_id, então a posse é verificada via guild_configs.
    const result = await this.pool.query<TicketRow>(
      `SELECT id, guild_id, channel_id, user_id, ticket_number, category, status,
              COALESCE(dm_notify, true) AS dm_notify, created_at, closed_at, close_reason
       FROM public.tickets t
       WHERE t.guild_id=$1
         AND EXISTS (SELECT 1 FROM guild_configs gc WHERE gc.guild_id=$1 AND gc.bot_id=$2)
       ORDER BY t.created_at DESC LIMIT $3`,
      [guildId, botId, bounded]
    );
    return result.rows.map(rowToTicket);
  }

  async getTicket(ticketId: number): Promise<Ticket | null> {
    await this.ensureReady();
    const result = await this.pool.query<TicketRow>(
      `SELECT id, guild_id, channel_id, user_id, ticket_number, category, status,
              COALESCE(dm_notify, true) AS dm_notify, created_at, closed_at, close_reason
       FROM public.tickets WHERE id=$1 LIMIT 1`,
      [ticketId]
    );
    const row = result.rows[0];
    return row ? rowToTicket(row) : null;
  }

  private async ensureReady(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.initialize();
    await this.readyPromise;
  }

  private async initialize(): Promise<void> {
    await this.pool.query("SELECT 1");
    await this.runQuery(CREATE_BOTS_TABLE_DDL);
    await this.runQuery(ALTER_BOTS_TOKEN_HASH_DDL);
    await this.runQuery(CREATE_BOTS_TOKEN_HASH_INDEX_DDL);
    await this.runQuery(CREATE_BOT_LOGS_TABLE_DDL);
    await this.runQuery(CREATE_BOT_STATUS_TABLE_DDL);
    await this.runQuery(CREATE_GUILD_CONFIGS_TABLE_DDL);
    await this.runQuery(CREATE_SET_BOTS_UPDATED_AT_FN_DDL);
    await this.runQuery(DROP_BOTS_UPDATED_AT_TRIGGER_DDL);
    await this.runQuery(CREATE_BOTS_UPDATED_AT_TRIGGER_DDL);
    await this.runQuery(CREATE_SET_BOT_STATUS_UPDATED_AT_FN_DDL);
    await this.runQuery(DROP_BOT_STATUS_UPDATED_AT_TRIGGER_DDL);
    await this.runQuery(CREATE_BOT_STATUS_UPDATED_AT_TRIGGER_DDL);
    await this.runQuery(CREATE_SET_GUILD_CONFIGS_UPDATED_AT_FN_DDL);
    await this.runQuery(DROP_GUILD_CONFIGS_UPDATED_AT_TRIGGER_DDL);
    await this.runQuery(CREATE_GUILD_CONFIGS_UPDATED_AT_TRIGGER_DDL);
    await this.runQuery(CREATE_BOTS_CREATED_INDEX_DDL);
    await this.runQuery(CREATE_BOT_LOGS_BOT_TIMESTAMP_INDEX_DDL);
    await this.runQuery(CREATE_BOT_STATUS_LAST_SEEN_INDEX_DDL);
    await this.runQuery(CREATE_GUILD_CONFIGS_BOT_INDEX_DDL);
    await this.runQuery(CREATE_WHITELIST_QUESTIONS_TABLE_DDL);
    await this.runQuery(CREATE_WHITELIST_QUESTIONS_BOT_INDEX_DDL);
    // Extended config columns (idempotent ALTER TABLE)
    await this.runQuery(ALTER_GUILD_CONFIGS_EMBED_COLOR_DDL);
    await this.runQuery(ALTER_GUILD_CONFIGS_TICKET_IMAGE_DDL);
    await this.runQuery(ALTER_GUILD_CONFIGS_WELCOME_IMAGE_DDL);
    await this.runQuery(ALTER_GUILD_CONFIGS_DM_NOTIFY_DDL);
    await this.runQuery(CREATE_BOT_ACTIONS_TABLE_DDL);
    // public.tickets migration (may fail if table doesn't exist yet — ignore)
    await this.runQuery(ALTER_PUBLIC_TICKETS_DM_NOTIFY_DDL, ["42P01"]);
    // Whitelist quiz columns
    await this.runQuery(ALTER_GUILD_CONFIGS_PASS_SCORE_DDL);
    await this.runQuery(ALTER_GUILD_CONFIGS_PANEL_CONFIGS_DDL);
    await this.runQuery(ALTER_WHITELIST_QUESTIONS_TYPE_DDL);
    await this.runQuery(ALTER_WHITELIST_QUESTIONS_OPTIONS_DDL);
    await this.runQuery(ALTER_WHITELIST_QUESTIONS_CORRECT_INDEX_DDL);
  }

  private async runQuery(query: string, ignoredCodes: string[] = []): Promise<void> {
    try {
      await this.pool.query(query);
    } catch (error) {
      const code = postgresErrorCode(error);
      if (code === "42501") {
        console.warn(
          "[bot-store] privilegio insuficiente ao aplicar DDL (42501) — schema pode estar incompleto"
        );
        return;
      }
      if (code && ignoredCodes.includes(code)) return;
      throw error;
    }
  }
}
