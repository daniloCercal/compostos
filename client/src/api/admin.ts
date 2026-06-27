import { clearCsrfToken, requestJson, setCsrfToken } from './client'
import type {
  AdminRole,
  AdminUser,
  AdminUserInput,
  AdminUserUpdate,
  Bot,
  BotCommand,
  BotDiscordUser,
  BotInput,
  BotLogEntry,
  BotStatus,
  BotStatusState,
  DiscordGuild,
  DiscordRole,
  DiscordChannel,
  ExtendedGuildConfig,
  GuildConfig,
  PanelConfigs,
  PanelEmbedConfig,
  SessionResponse,
  Ticket,
  WhitelistQuestion,
} from '../types'

interface BotApiItem {
  id: string
  name: string
  token?: string
  commands?: unknown
  isActive?: boolean
  is_active?: boolean
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
}

interface BotLogApiItem {
  id?: string
  timestamp?: string
  createdAt?: string
  created_at?: string
  eventType?: string
  event_type?: string
  type?: string
  details?: string
  message?: string
  data?: unknown
  payload?: unknown
}

interface BotStatusApiItem {
  botId?: string
  bot_id?: string
  botName?: string
  bot_name?: string
  isActive?: boolean
  is_active?: boolean
  botUpdatedAt?: string
  bot_updated_at?: string
  status?: BotStatusState
  lastSeenAt?: string | null
  last_seen_at?: string | null
  startedAt?: string | null
  started_at?: string | null
  restartRequestedAt?: string | null
  restart_requested_at?: string | null
  guildsCount?: number | null
  guilds_count?: number | null
  latencyMs?: number | null
  latency_ms?: number | null
  errorMessage?: string | null
  error_message?: string | null
  statusUpdatedAt?: string | null
  status_updated_at?: string | null
  isOnline?: boolean
  is_online?: boolean
}


function normalizeBotCommands(input: unknown): BotCommand[] {
  if (!Array.isArray(input)) {
    return []
  }

  return input.flatMap((item) => {
    if (typeof item !== 'object' || item === null) {
      return []
    }

    const name = 'name' in item && typeof item.name === 'string' ? item.name : ''
    const response = 'response' in item && typeof item.response === 'string' ? item.response : ''
    if (!name || !response) {
      return []
    }
    return [{ name, response }]
  })
}

function normalizeBot(item: BotApiItem): Bot {
  return {
    id: item.id,
    name: item.name,
    token: item.token ?? '',
    commands: normalizeBotCommands(item.commands),
    isActive: item.isActive ?? item.is_active ?? false,
    createdAt: item.createdAt ?? item.created_at ?? '',
    updatedAt: item.updatedAt ?? item.updated_at ?? '',
  }
}

function toLogDetails(item: BotLogApiItem): string {
  if (item.details) {
    return item.details
  }
  if (item.message) {
    return item.message
  }

  const payload = item.data ?? item.payload
  if (payload === undefined || payload === null) {
    return ''
  }

  if (typeof payload === 'string') {
    return payload
  }

  try {
    return JSON.stringify(payload)
  } catch {
    return String(payload)
  }
}

function normalizeBotLog(item: BotLogApiItem, index: number): BotLogEntry {
  const timestamp = item.timestamp ?? item.createdAt ?? item.created_at ?? ''
  const eventType = item.eventType ?? item.event_type ?? item.type ?? 'evento'

  return {
    id: item.id ?? `${timestamp || 'log'}-${index}`,
    timestamp,
    eventType,
    details: toLogDetails(item),
  }
}

function normalizeBotStatus(item: BotStatusApiItem): BotStatus {
  return {
    botId: item.botId ?? item.bot_id ?? '',
    botName: item.botName ?? item.bot_name ?? '--',
    isActive: item.isActive ?? item.is_active ?? false,
    botUpdatedAt: item.botUpdatedAt ?? item.bot_updated_at ?? '',
    status: item.status ?? 'offline',
    lastSeenAt: item.lastSeenAt ?? item.last_seen_at ?? null,
    startedAt: item.startedAt ?? item.started_at ?? null,
    restartRequestedAt: item.restartRequestedAt ?? item.restart_requested_at ?? null,
    guildsCount: item.guildsCount ?? item.guilds_count ?? null,
    latencyMs: item.latencyMs ?? item.latency_ms ?? null,
    errorMessage: item.errorMessage ?? item.error_message ?? null,
    statusUpdatedAt: item.statusUpdatedAt ?? item.status_updated_at ?? null,
    isOnline: item.isOnline ?? item.is_online ?? false,
  }
}


export async function getAdminSession(): Promise<SessionResponse> {
  return requestJson<SessionResponse>('/api/admin/session', { method: 'GET', skipCsrf: true })
}

export async function loginAdmin(email: string, password: string): Promise<void> {
  await requestJson<{ ok: true }>('/api/admin/login', {
    method: 'POST',
    body: { email, password },
    skipCsrf: true,
  })
}

export async function logoutAdmin(): Promise<void> {
  await requestJson<{ ok: true }>('/api/admin/logout', {
    method: 'POST',
    skipCsrf: true,
  })
  clearCsrfToken()
}

export async function ensureCsrfToken(): Promise<string> {
  const response = await requestJson<{ csrfToken: string }>('/api/admin/csrf-token', {
    method: 'GET',
    skipCsrf: true,
  })
  setCsrfToken(response.csrfToken)
  return response.csrfToken
}

export async function listBots(): Promise<Bot[]> {
  const response = await requestJson<{ bots?: BotApiItem[]; items?: BotApiItem[] }>('/api/admin/bots', {
    method: 'GET',
    skipCsrf: true,
  })

  const bots = response.bots ?? response.items ?? []
  return bots.map(normalizeBot)
}

export async function createBot(payload: BotInput): Promise<Bot> {
  await ensureCsrfToken()
  const response = await requestJson<{ bot: BotApiItem }>('/api/admin/bots', {
    method: 'POST',
    body: payload,
  })
  return normalizeBot(response.bot)
}

export async function updateBot(id: string, payload: BotInput): Promise<Bot> {
  await ensureCsrfToken()
  const response = await requestJson<{ bot: BotApiItem }>(`/api/admin/bots/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: payload,
  })
  return normalizeBot(response.bot)
}

export async function restartBot(id: string): Promise<Bot> {
  await ensureCsrfToken()
  const response = await requestJson<{ bot: BotApiItem }>(`/api/admin/bots/${encodeURIComponent(id)}/restart`, {
    method: 'POST',
  })
  return normalizeBot(response.bot)
}

export async function deleteBot(id: string): Promise<void> {
  await ensureCsrfToken()
  await requestJson<{ ok: true }>(`/api/admin/bots/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function listBotLogs(id: string): Promise<BotLogEntry[]> {
  const response = await requestJson<{ logs?: BotLogApiItem[]; items?: BotLogApiItem[] }>(
    `/api/admin/bots/${encodeURIComponent(id)}/logs`,
    {
      method: 'GET',
      skipCsrf: true,
    },
  )

  const logs = response.logs ?? response.items ?? []
  return logs.map(normalizeBotLog)
}

export async function listBotStatus(): Promise<BotStatus[]> {
  const response = await requestJson<{ items?: BotStatusApiItem[] }>(
    '/api/admin/bots/status',
    { method: 'GET', skipCsrf: true },
  )
  return (response.items ?? []).map(normalizeBotStatus)
}

interface DiscordGuildApiItem {
  id?: string
  name?: string
  iconUrl?: string | null
  icon_url?: string | null
  memberCount?: number | null
  member_count?: number | null
}

interface BotDiscordUserApiItem {
  id?: string
  username?: string
  discriminator?: string
  avatarUrl?: string | null
  avatar_url?: string | null
}

interface GuildConfigApiItem {
  guildId?: string
  guild_id?: string
  logChannelId?: string
  log_channel_id?: string
  ticketCategoryId?: string
  ticket_category_id?: string
  ticketLogChannelId?: string
  ticket_log_channel_id?: string
  whitelistChannelId?: string
  whitelist_channel_id?: string
  whitelistLogChannelId?: string
  whitelist_log_channel_id?: string
  whitelistRoleId?: string
  whitelist_role_id?: string
  verifiedRoleId?: string
  verified_role_id?: string
  staffRoleId?: string
  staff_role_id?: string
  adminRoleId?: string
  admin_role_id?: string
  maxTicketsPerUser?: number
  max_tickets_per_user?: number
  ticketPrefix?: string
  ticket_prefix?: string
  whitelistPassMessage?: string
  whitelist_pass_message?: string
  whitelistFailMessage?: string
  whitelist_fail_message?: string
  welcomeMessage?: string
  welcome_message?: string
  whitelistPassScore?: number
  whitelist_pass_score?: number
  panelConfigs?: unknown
  panel_configs?: unknown
  createdAt?: string | null
  created_at?: string | null
  updatedAt?: string | null
  updated_at?: string | null
}

function normalizePanelEmbed(v: unknown): PanelEmbedConfig {
  const o = typeof v === 'object' && v !== null ? v as Record<string, unknown> : {}
  return {
    title: String(o.title ?? ''),
    description: String(o.description ?? ''),
    buttonLabel: String(o.buttonLabel ?? o.button_label ?? ''),
    placeholder: String(o.placeholder ?? ''),
  }
}

function normalizePanelConfigs(v: unknown): PanelConfigs {
  const o = typeof v === 'object' && v !== null ? v as Record<string, unknown> : {}
  return {
    whitelist: normalizePanelEmbed(o.whitelist),
    tickets: normalizePanelEmbed(o.tickets),
    verification: normalizePanelEmbed(o.verification),
  }
}

function normalizeDiscordGuild(item: DiscordGuildApiItem): DiscordGuild {
  return {
    id: item.id ?? '',
    name: item.name ?? '--',
    iconUrl: item.iconUrl ?? item.icon_url ?? null,
    memberCount: item.memberCount ?? item.member_count ?? null,
  }
}

function normalizeBotDiscordUser(item: BotDiscordUserApiItem): BotDiscordUser {
  return {
    id: item.id ?? '',
    username: item.username ?? '--',
    discriminator: item.discriminator ?? '0',
    avatarUrl: item.avatarUrl ?? item.avatar_url ?? null,
  }
}

function normalizeGuildConfig(item: GuildConfigApiItem): GuildConfig {
  return {
    guildId: item.guildId ?? item.guild_id ?? '',
    logChannelId: item.logChannelId ?? item.log_channel_id ?? '',
    ticketCategoryId: item.ticketCategoryId ?? item.ticket_category_id ?? '',
    ticketLogChannelId: item.ticketLogChannelId ?? item.ticket_log_channel_id ?? '',
    whitelistChannelId: item.whitelistChannelId ?? item.whitelist_channel_id ?? '',
    whitelistLogChannelId: item.whitelistLogChannelId ?? item.whitelist_log_channel_id ?? '',
    whitelistRoleId: item.whitelistRoleId ?? item.whitelist_role_id ?? '',
    verifiedRoleId: item.verifiedRoleId ?? item.verified_role_id ?? '',
    staffRoleId: item.staffRoleId ?? item.staff_role_id ?? '',
    adminRoleId: item.adminRoleId ?? item.admin_role_id ?? '',
    maxTicketsPerUser: item.maxTicketsPerUser ?? item.max_tickets_per_user ?? 3,
    ticketPrefix: item.ticketPrefix ?? item.ticket_prefix ?? 'ticket',
    whitelistPassMessage: item.whitelistPassMessage ?? item.whitelist_pass_message ?? '',
    whitelistFailMessage: item.whitelistFailMessage ?? item.whitelist_fail_message ?? '',
    welcomeMessage: item.welcomeMessage ?? item.welcome_message ?? '',
    whitelistPassScore: item.whitelistPassScore ?? item.whitelist_pass_score ?? 80,
    panelConfigs: normalizePanelConfigs(item.panelConfigs ?? item.panel_configs),
    createdAt: item.createdAt ?? item.created_at ?? null,
    updatedAt: item.updatedAt ?? item.updated_at ?? null,
  }
}

export async function listBotDiscordGuilds(botId: string): Promise<DiscordGuild[]> {
  const response = await requestJson<{ guilds?: DiscordGuildApiItem[] }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/guilds`,
    { method: 'GET', skipCsrf: true },
  )
  return (response.guilds ?? []).map(normalizeDiscordGuild)
}

export async function getBotDiscordUser(botId: string): Promise<BotDiscordUser> {
  const response = await requestJson<{ user?: BotDiscordUserApiItem }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/me`,
    { method: 'GET', skipCsrf: true },
  )
  return normalizeBotDiscordUser(response.user ?? {})
}

export async function updateBotIdentity(
  botId: string,
  fields: { username?: string; avatarDataUri?: string | null },
): Promise<BotDiscordUser> {
  await ensureCsrfToken()
  const response = await requestJson<{ user?: BotDiscordUserApiItem }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/me`,
    {
      method: 'PUT',
      body: {
        username: fields.username,
        avatar_data_uri: fields.avatarDataUri,
      },
    },
  )
  return normalizeBotDiscordUser(response.user ?? {})
}

export async function updateGuildNickname(botId: string, guildId: string, nick: string): Promise<void> {
  await ensureCsrfToken()
  await requestJson<{ ok: true }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nick`,
    { method: 'PUT', body: { nick } },
  )
}

export async function getGuildConfig(botId: string, guildId: string): Promise<GuildConfig | null> {
  const response = await requestJson<{ config?: GuildConfigApiItem | null }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/config`,
    { method: 'GET', skipCsrf: true },
  )
  return response.config ? normalizeGuildConfig(response.config) : null
}

export async function upsertGuildConfig(
  botId: string,
  guildId: string,
  config: Omit<GuildConfig, 'guildId' | 'createdAt' | 'updatedAt'>,
): Promise<GuildConfig> {
  await ensureCsrfToken()
  const response = await requestJson<{ config?: GuildConfigApiItem }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/config`,
    { method: 'PUT', body: config },
  )
  return normalizeGuildConfig(response.config ?? {})
}

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

interface AdminUserApiItem {
  id?: string
  email?: string
  displayName?: string
  display_name?: string
  role?: AdminRole
  isActive?: boolean
  is_active?: boolean
  botIds?: string[]
  bot_ids?: string[]
  scope?: 'all' | 'assigned'
}

function normalizeAdminUser(item: AdminUserApiItem): AdminUser {
  return {
    id: item.id ?? '',
    email: item.email ?? '',
    displayName: item.displayName ?? item.display_name ?? '',
    role: item.role ?? 'user',
    isActive: item.isActive ?? item.is_active ?? true,
    botIds: item.botIds ?? item.bot_ids ?? [],
    scope: item.scope ?? 'assigned',
  }
}

export async function listUsers(): Promise<AdminUser[]> {
  const response = await requestJson<{ users?: AdminUserApiItem[] }>(
    '/api/admin/users',
    { method: 'GET', skipCsrf: true },
  )
  return (response.users ?? []).map(normalizeAdminUser)
}

export async function createUser(input: AdminUserInput): Promise<AdminUser> {
  await ensureCsrfToken()
  const response = await requestJson<{ user: AdminUserApiItem }>(
    '/api/admin/users',
    { method: 'POST', body: input },
  )
  return normalizeAdminUser(response.user)
}

export async function updateUser(id: string, input: AdminUserUpdate): Promise<AdminUser> {
  await ensureCsrfToken()
  const response = await requestJson<{ user: AdminUserApiItem }>(
    `/api/admin/users/${encodeURIComponent(id)}`,
    { method: 'PUT', body: input },
  )
  return normalizeAdminUser(response.user)
}

export async function deleteUser(id: string): Promise<void> {
  await ensureCsrfToken()
  await requestJson<{ ok: true }>(
    `/api/admin/users/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

// ---------------------------------------------------------------------------
// Whitelist questions
// ---------------------------------------------------------------------------

interface WhitelistQuestionApiItem {
  id?: string
  botId?: string
  bot_id?: string
  orderIndex?: number
  order_index?: number
  fieldKey?: string
  field_key?: string
  questionText?: string
  question_text?: string
  correctAnswer?: string
  correct_answer?: string
  questionType?: string
  question_type?: string
  options?: unknown
  correctIndex?: number
  correct_index?: number
}

function normalizeWhitelistQuestion(item: WhitelistQuestionApiItem): WhitelistQuestion {
  const rawOpts = item.options
  const options = Array.isArray(rawOpts) ? rawOpts.map(String) : []
  return {
    id: item.id ?? '',
    botId: item.botId ?? item.bot_id ?? '',
    orderIndex: item.orderIndex ?? item.order_index ?? 0,
    fieldKey: item.fieldKey ?? item.field_key ?? '',
    questionText: item.questionText ?? item.question_text ?? '',
    correctAnswer: item.correctAnswer ?? item.correct_answer ?? '',
    questionType: (item.questionType ?? item.question_type ?? 'open') === 'quiz' ? 'quiz' : 'open',
    options,
    correctIndex: item.correctIndex ?? item.correct_index ?? 0,
  }
}

export async function listWhitelistQuestions(botId: string): Promise<WhitelistQuestion[]> {
  const response = await requestJson<{ questions?: WhitelistQuestionApiItem[] }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/whitelist-questions`,
    { method: 'GET', skipCsrf: true },
  )
  return (response.questions ?? []).map(normalizeWhitelistQuestion)
}

export async function saveWhitelistQuestions(
  botId: string,
  questions: Array<Pick<WhitelistQuestion, 'fieldKey' | 'questionText' | 'correctAnswer' | 'orderIndex' | 'questionType' | 'options' | 'correctIndex'>>,
): Promise<WhitelistQuestion[]> {
  await ensureCsrfToken()
  const response = await requestJson<{ questions?: WhitelistQuestionApiItem[] }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/whitelist-questions`,
    { method: 'PUT', body: { questions } },
  )
  return (response.questions ?? []).map(normalizeWhitelistQuestion)
}

// ---------------------------------------------------------------------------
// Extended guild config
// ---------------------------------------------------------------------------

interface ExtendedGuildConfigApiItem {
  guildId?: string
  guild_id?: string
  embedColor?: number
  embed_color?: number
  ticketImageUrl?: string
  ticket_image_url?: string
  welcomeImageUrl?: string
  welcome_image_url?: string
  dmNotifyDefault?: boolean
  dm_notify_default?: boolean
}

function normalizeExtendedConfig(item: ExtendedGuildConfigApiItem): ExtendedGuildConfig {
  return {
    guildId: item.guildId ?? item.guild_id ?? '',
    embedColor: item.embedColor ?? item.embed_color ?? 0x8B0000,
    ticketImageUrl: item.ticketImageUrl ?? item.ticket_image_url ?? '',
    welcomeImageUrl: item.welcomeImageUrl ?? item.welcome_image_url ?? '',
    dmNotifyDefault: item.dmNotifyDefault ?? item.dm_notify_default ?? true,
  }
}

export async function getExtendedConfig(botId: string, guildId: string): Promise<ExtendedGuildConfig | null> {
  const response = await requestJson<{ config?: ExtendedGuildConfigApiItem | null }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/extended-config`,
    { method: 'GET', skipCsrf: true },
  )
  return response.config ? normalizeExtendedConfig(response.config) : null
}

export async function upsertExtendedConfig(
  botId: string,
  guildId: string,
  config: Omit<ExtendedGuildConfig, 'guildId'>,
): Promise<ExtendedGuildConfig> {
  await ensureCsrfToken()
  const response = await requestJson<{ config?: ExtendedGuildConfigApiItem }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/extended-config`,
    { method: 'PUT', body: config },
  )
  return normalizeExtendedConfig(response.config ?? {})
}

// ---------------------------------------------------------------------------
// Discord roles & channels
// ---------------------------------------------------------------------------

export async function listGuildRoles(botId: string, guildId: string): Promise<DiscordRole[]> {
  const response = await requestJson<{ roles?: DiscordRole[] }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/roles`,
    { method: 'GET', skipCsrf: true },
  )
  return response.roles ?? []
}

export async function listGuildChannels(botId: string, guildId: string): Promise<DiscordChannel[]> {
  const response = await requestJson<{ channels?: DiscordChannel[] }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/channels`,
    { method: 'GET', skipCsrf: true },
  )
  return response.channels ?? []
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

export async function sendAnnouncement(
  botId: string,
  guildId: string,
  channelId: string,
  content: string,
  mentionRoleIds: string[],
  hideRoles = false,
): Promise<void> {
  await ensureCsrfToken()
  await requestJson<{ ok: true }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/announcements`,
    { method: 'POST', body: { channelId, content, mentionRoleIds, hideRoles } },
  )
}

// ---------------------------------------------------------------------------
// Ticket management
// ---------------------------------------------------------------------------

interface TicketApiItem {
  id?: number
  guildId?: string
  guild_id?: string
  channelId?: string
  channel_id?: string
  userId?: string
  user_id?: string
  ticketNumber?: number
  ticket_number?: number
  category?: string
  status?: string
  dmNotify?: boolean
  dm_notify?: boolean
  createdAt?: string
  created_at?: string
  closedAt?: string | null
  closed_at?: string | null
  closeReason?: string
  close_reason?: string
}

function normalizeTicket(item: TicketApiItem): Ticket {
  return {
    id: item.id ?? 0,
    guildId: item.guildId ?? item.guild_id ?? '',
    channelId: item.channelId ?? item.channel_id ?? '',
    userId: item.userId ?? item.user_id ?? '',
    ticketNumber: item.ticketNumber ?? item.ticket_number ?? 0,
    category: item.category ?? '',
    status: item.status ?? 'open',
    dmNotify: item.dmNotify ?? item.dm_notify ?? true,
    createdAt: item.createdAt ?? item.created_at ?? '',
    closedAt: item.closedAt ?? item.closed_at ?? null,
    closeReason: item.closeReason ?? item.close_reason ?? '',
  }
}

export async function listTickets(botId: string, guildId: string): Promise<Ticket[]> {
  const response = await requestJson<{ tickets?: TicketApiItem[] }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/tickets`,
    { method: 'GET', skipCsrf: true },
  )
  return (response.tickets ?? []).map(normalizeTicket)
}

export async function sendTicketReply(
  botId: string,
  guildId: string,
  ticketId: number,
  channelId: string,
  adminName: string,
  content: string,
): Promise<void> {
  await ensureCsrfToken()
  await requestJson<{ ok: true }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/tickets/${ticketId}/reply`,
    { method: 'POST', body: { channelId, adminName, content } },
  )
}

export async function addUserToTicket(
  botId: string,
  guildId: string,
  ticketId: number,
  channelId: string,
  userId: string,
): Promise<void> {
  await ensureCsrfToken()
  await requestJson<{ ok: true }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/tickets/${ticketId}/add-user`,
    { method: 'POST', body: { channelId, userId } },
  )
}

// ---------------------------------------------------------------------------
// Bot presence
// ---------------------------------------------------------------------------

export async function setBotPresence(
  botId: string,
  guildId: string,
  status: string,
  activityType: number,
  activityName: string,
): Promise<void> {
  await ensureCsrfToken()
  await requestJson<{ ok: true }>(
    `/api/admin/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/presence`,
    { method: 'POST', body: { status, activityType, activityName } },
  )
}
