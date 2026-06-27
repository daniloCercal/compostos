export interface BotCommand {
  name: string;
  response: string;
}

export interface Bot {
  id: string;
  name: string;
  token: string;
  commands: BotCommand[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BotLog {
  id: string;
  botId: string;
  timestamp: string;
  type: "ping" | "command" | "error" | "manager";
  data: Record<string, unknown>;
  createdAt: string;
}

/**
 * Status do bot no painel. Derivado de um JOIN entre site.bots e site.bot_status.
 *
 * O campo `isOnline` é calculado pelo backend:
 *   lastSeenAt > now() - 2 min  →  true
 * Isso protege contra bots que crasham sem escrever status='offline'.
 */
export interface BotStatus {
  botId: string;
  botName: string;
  isActive: boolean;
  botUpdatedAt: string;
  // Escrito pelo bot via heartbeat
  status: "online" | "offline" | "error";
  lastSeenAt: string | null;
  startedAt: string | null;
  restartRequestedAt: string | null;
  guildsCount: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  statusUpdatedAt: string | null;
  // Derivado pelo painel
  isOnline: boolean;
}

/**
 * Strict hierarchy:
 *   ceo   – full access; only role that can create `admin` accounts
 *   admin – can manage bots and standard users; only role that can create `user` accounts
 *   user  – read-only access to bots
 */
export type AdminRole = "ceo" | "admin" | "user";

export interface AdminPermissions {
  canViewBots: boolean;
  canCreateBots: boolean;
  canUpdateBots: boolean;
  canDeleteBots: boolean;
  canManageUsers: boolean;
  /** Only `ceo` may promote/create `admin` accounts. */
  canCreateAdmins: boolean;
}

export interface AdminPrincipal {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  isActive: boolean;
  botIds: string[];
  scope: "all" | "assigned";
  permissions: AdminPermissions;
}

/** Populated in res.locals after a successful lucia.validateSession() call. */
export interface AdminSessionInfo {
  sessionId: string;
  userId: string;
  role: AdminRole;
  csrfToken: string;
  expiresAt: Date;
}

export interface DiscordGuild {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number | null;
}

export interface BotDiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatarUrl: string | null;
}

export interface PanelEmbedConfig {
  title: string;
  description: string;
  buttonLabel: string;
  placeholder: string;
}

export interface PanelConfigs {
  whitelist: PanelEmbedConfig;
  tickets: PanelEmbedConfig;
  verification: PanelEmbedConfig;
}

export interface WhitelistQuestion {
  id: string;
  botId: string;
  orderIndex: number;
  fieldKey: string;
  questionText: string;
  correctAnswer: string;
  questionType: "open" | "quiz";
  options: string[];
  correctIndex: number;
}

export interface GuildConfig {
  guildId: string;
  logChannelId: string;
  ticketCategoryId: string;
  ticketLogChannelId: string;
  whitelistChannelId: string;
  whitelistLogChannelId: string;
  whitelistRoleId: string;
  verifiedRoleId: string;
  staffRoleId: string;
  adminRoleId: string;
  maxTicketsPerUser: number;
  ticketPrefix: string;
  whitelistPassMessage: string;
  whitelistFailMessage: string;
  welcomeMessage: string;
  whitelistPassScore: number;
  panelConfigs: PanelConfigs;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ExtendedGuildConfig {
  guildId: string;
  embedColor: number;
  ticketImageUrl: string;
  welcomeImageUrl: string;
  dmNotifyDefault: boolean;
}

export interface DiscordRole {
  id: string;
  name: string;
  color: number;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
}

export interface Ticket {
  id: number;
  guildId: string;
  channelId: string;
  userId: string;
  ticketNumber: number;
  category: string;
  status: string;
  dmNotify: boolean;
  createdAt: string;
  closedAt: string | null;
  closeReason: string;
}
