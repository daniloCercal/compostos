export interface BotCommand {
  name: string
  response: string
}

export interface Bot {
  id: string
  name: string
  token: string
  image: string
  commands: BotCommand[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface BotInput {
  name: string
  token?: string
  commands: BotCommand[]
  isActive: boolean
}

export interface BotLogEntry {
  id: string
  timestamp: string
  eventType: string
  details: string
}

export type BotStatusState = 'online' | 'offline' | 'error'

export interface BotStatus {
  botId: string
  botName: string
  isActive: boolean
  botUpdatedAt: string
  status: BotStatusState
  lastSeenAt: string | null
  startedAt: string | null
  restartRequestedAt: string | null
  guildsCount: number | null
  latencyMs: number | null
  errorMessage: string | null
  statusUpdatedAt: string | null
  isOnline: boolean
}

export type AdminRole = 'ceo' | 'admin' | 'user'

export interface AdminPermissions {
  canViewBots: boolean
  canCreateBots: boolean
  canUpdateBots: boolean
  canDeleteBots: boolean
  canManageUsers: boolean
  canCreateAdmins: boolean
}

export interface AdminSessionUser {
  id: string
  email: string
  displayName: string
  role: AdminRole
  scope: 'all' | 'assigned'
}

export interface SessionResponse {
  authenticated: boolean
  user?: AdminSessionUser
  permissions?: AdminPermissions
  botIds?: string[]
}

export interface DiscordGuild {
  id: string
  name: string
  iconUrl: string | null
  memberCount: number | null
}

export interface BotDiscordUser {
  id: string
  username: string
  discriminator: string
  avatarUrl: string | null
}

export interface AdminUser {
  id: string
  email: string
  displayName: string
  role: AdminRole
  isActive: boolean
  botIds: string[]
  scope: 'all' | 'assigned'
  image: string
}

export interface AuditEntry {
  id: string
  occurredAt: string
  category: string
  userId: string | null
  userEmail: string | null
  userRole: string | null
  method: string
  path: string
  statusCode: number | null
  durationMs: number | null
  ip: string | null
  userAgent: string | null
}

export interface DiscordOauthConfig {
  clientId: string
  hasSecret: boolean
  enabled: boolean
}

export interface DiscordRoleMapping {
  id: string
  guildId: string
  roleId: string
  roleName: string
  panelRole: 'admin' | 'user'
}

export interface AdminUserInput {
  email: string
  displayName: string
  password: string
  role: AdminRole
  botIds: string[]
  isActive: boolean
}

export interface AdminUserUpdate {
  email?: string
  displayName?: string
  password?: string
  role?: AdminRole
  botIds?: string[]
  isActive?: boolean
}

export interface PanelEmbedConfig {
  title: string
  description: string
  buttonLabel: string
  placeholder: string
}

export interface PanelConfigs {
  whitelist: PanelEmbedConfig
  tickets: PanelEmbedConfig
  verification: PanelEmbedConfig
}

export interface WhitelistQuestion {
  id: string
  botId: string
  orderIndex: number
  fieldKey: string
  questionText: string
  correctAnswer: string
  questionType: 'open' | 'quiz'
  options: string[]
  correctIndex: number
}

export type WhitelistApplicationStatus =
  | 'pending'
  | 'theory_passed'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'timed_out'

export interface WhitelistApplication {
  id: number
  guildId: string
  userId: string
  channelId: string
  appNumber: number
  status: WhitelistApplicationStatus
  answers: Record<string, unknown>
  /** Correção por pergunta de quiz: fieldKey -> acertou? */
  quizResults: Record<string, boolean>
  currentQuestion: number
  reviewedBy: string
  reviewNote: string
  startedAt: string | null
  createdAt: string
  updatedAt: string
  /** @username do Discord (vazio se não resolvido). */
  username: string
  /** Nome de exibição (global_name) do Discord. */
  displayName: string
}

export interface GuildConfig {
  guildId: string
  logChannelId: string
  ticketCategoryId: string
  ticketLogChannelId: string
  whitelistChannelId: string
  whitelistLogChannelId: string
  whitelistApprovedChannelId: string
  whitelistRejectedChannelId: string
  whitelistRoleId: string
  whitelistRejectedRoleId: string
  verifiedRoleId: string
  staffRoleId: string
  adminRoleId: string
  maxTicketsPerUser: number
  ticketPrefix: string
  whitelistPassMessage: string
  whitelistFailMessage: string
  welcomeMessage: string
  whitelistPassScore: number
  panelConfigs: PanelConfigs
  createdAt: string | null
  updatedAt: string | null
}

export interface ExtendedGuildConfig {
  guildId: string
  embedColor: number
  ticketImageUrl: string
  welcomeImageUrl: string
  dmNotifyDefault: boolean
}

export interface DiscordRole {
  id: string
  name: string
  color: number
}

export interface DiscordChannel {
  id: string
  name: string
  type: number
  parentId: string | null
}

export interface Ticket {
  id: number
  guildId: string
  channelId: string
  userId: string
  ticketNumber: number
  category: string
  status: string
  dmNotify: boolean
  createdAt: string
  closedAt: string | null
  closeReason: string
  claimedStaff: string[]
}

export interface TicketMessage {
  id: string
  authorId: string
  authorName: string
  content: string
  attachments: string
  createdAt: string
}
