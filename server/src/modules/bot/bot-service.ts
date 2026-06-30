import { z } from "zod";

import type { Bot, BotCommand, BotLog, BotStatus, GuildConfig, DiscordGuild, BotDiscordUser, WhitelistQuestion, WhitelistApplication, ExtendedGuildConfig, DiscordRole, DiscordChannel, Ticket, TicketMessage } from "../../types";
import { fetchBotGuilds, fetchBotUser, patchBotUser, patchGuildNickname, buildAvatarUrl, buildGuildIconUrl, DiscordApiError, fetchGuildRoles, fetchGuildChannels, sendChannelMessage, createChannelPermissionOverwrite, fetchDiscordUser } from "../../utils/discord-api";
import { createId, utcIsoNow } from "../../utils/id";
import { BotStorePostgres } from "./bot-store-postgres";

const MAX_LOG_LIMIT = 100;

// Cache de resolução de @username do Discord (id -> handle), com TTL,
// para evitar bater na API do Discord a cada listagem de aplicações.
const USER_CACHE_TTL_MS = 10 * 60 * 1000;
const userHandleCache = new Map<string, { username: string; displayName: string; at: number }>();

const botCommandSchema = z.object({
  name: z.string().trim().min(1).max(100),
  response: z.string().trim().min(1).max(4000)
});

const commandsSchema = z.array(botCommandSchema).max(200).default([]);

const createPayloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  token: z
    .string()
    .trim()
    .max(4096)
    .optional()
    .transform((value) => value ?? ""),
  commands: commandsSchema,
  isActive: z.boolean().default(false)
});

function optionalTrimmedString(max: number): z.ZodType<string | undefined> {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
    z.string().min(1).max(max).optional()
  );
}

const updatePayloadSchema = z
  .object({
    name: optionalTrimmedString(120),
    token: optionalTrimmedString(4096),
    commands: commandsSchema.optional(),
    isActive: z.boolean().optional()
  })
  .refine(
    (value) =>
      value.name !== undefined || value.token !== undefined || value.commands !== undefined || value.isActive !== undefined,
    {
      message: "informe ao menos um campo para atualizar"
    }
  );

type CreateBotInput = z.infer<typeof createPayloadSchema>;
type UpdateBotInput = z.infer<typeof updatePayloadSchema>;

interface BotStoreLike {
  list(): Promise<Bot[]>;
  listStatus(): Promise<BotStatus[]>;
  getById(id: string): Promise<Bot | null>;
  create(input: Bot): Promise<Bot>;
  updateById(
    id: string,
    input: {
      name: string;
      token: string;
      commands: BotCommand[];
      isActive: boolean;
    }
  ): Promise<Bot | null>;
  touchUpdatedAt(id: string): Promise<Bot | null>;
  updateImage(id: string, imageData: string): Promise<Bot | null>;
  requestRestart(botId: string): Promise<void>;
  deleteById(id: string): Promise<boolean>;
  listLogsByBot(botId: string, limit: number): Promise<BotLog[] | null>;
  getGuildConfig(guildId: string, botId: string): Promise<GuildConfig | null>;
  getGuildOwnerBotId(guildId: string): Promise<string | null>;
  upsertGuildConfig(botId: string, guildId: string, fields: Omit<GuildConfig, "guildId" | "createdAt" | "updatedAt">): Promise<GuildConfig>;
  listWhitelistQuestions(botId: string): Promise<WhitelistQuestion[]>;
  saveWhitelistQuestions(botId: string, questions: Array<{ fieldKey: string; questionText: string; correctAnswer: string; orderIndex: number; questionType?: string; options?: string[]; correctIndex?: number }>): Promise<WhitelistQuestion[]>;
  listWhitelistApplications(botId: string): Promise<WhitelistApplication[]>;
  getExtendedConfig(guildId: string, botId: string): Promise<ExtendedGuildConfig | null>;
  upsertExtendedConfig(guildId: string, botId: string, fields: Omit<ExtendedGuildConfig, "guildId">): Promise<ExtendedGuildConfig>;
  enqueueBotAction(guildId: string, actionType: string, payload: Record<string, unknown>): Promise<void>;
  listTickets(guildId: string, botId: string, claimedBy?: string): Promise<Ticket[]>;
  claimTicket(ticketId: number, discordId: string, botId: string): Promise<void>;
  listTicketMessages(ticketId: number, botId: string): Promise<TicketMessage[]>;
  getTicket(ticketId: number): Promise<Ticket | null>;
}

export class BotServiceError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function normalizeCreatePayload(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return input;
  }
  const payload = input as Record<string, unknown>;
  return {
    name: payload.name,
    token: firstDefined(payload.token, payload.discord_token, payload.discordToken),
    commands: payload.commands,
    isActive: firstDefined(payload.is_active, payload.isActive, payload.active)
  };
}

function normalizeUpdatePayload(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return input;
  }
  const payload = input as Record<string, unknown>;
  return {
    name: payload.name,
    token: firstDefined(payload.token, payload.discord_token, payload.discordToken),
    commands: payload.commands,
    isActive: firstDefined(payload.is_active, payload.isActive, payload.active)
  };
}

function parseCreateInput(rawInput: unknown): CreateBotInput {
  const parsed = createPayloadSchema.safeParse(normalizeCreatePayload(rawInput));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue?.message ? `dados invalidos: ${issue.message}` : "dados invalidos";
    throw new BotServiceError(400, message);
  }
  return parsed.data;
}

function parseUpdateInput(rawInput: unknown): UpdateBotInput {
  const parsed = updatePayloadSchema.safeParse(normalizeUpdatePayload(rawInput));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue?.message ? `dados invalidos: ${issue.message}` : "dados invalidos";
    throw new BotServiceError(400, message);
  }
  return parsed.data;
}

export class BotService {
  private readonly store: BotStoreLike;

  constructor(store: BotStoreLike) {
    this.store = store;
  }

  async list(): Promise<Bot[]> {
    return this.store.list();
  }

  async listStatus(): Promise<BotStatus[]> {
    return this.store.listStatus();
  }

  async create(rawInput: unknown): Promise<Bot> {
    const parsed = parseCreateInput(rawInput);
    const now = utcIsoNow();

    return this.store.create({
      id: createId(),
      name: parsed.name,
      token: parsed.token,
      image: "",
      commands: parsed.commands,
      isActive: parsed.isActive,
      createdAt: now,
      updatedAt: now
    });
  }

  async getById(id: string): Promise<Bot | null> {
    return this.store.getById(id);
  }

  async update(id: string, rawInput: unknown): Promise<Bot | null> {
    const parsed = parseUpdateInput(rawInput);
    const current = await this.store.getById(id);
    if (!current) {
      return null;
    }

    return this.store.updateById(id, {
      name: parsed.name ?? current.name,
      token: parsed.token ?? current.token,
      commands: parsed.commands ?? current.commands,
      isActive: parsed.isActive ?? current.isActive
    });
  }

  async restart(id: string): Promise<Bot | null> {
    const current = await this.store.getById(id);
    if (!current) return null;
    // Escreve restart_requested_at no bot_status.
    // O bot Go lê esse campo no próximo heartbeat e reconecta ao Discord.
    await this.store.requestRestart(id);
    return current;
  }

  async remove(id: string): Promise<boolean> {
    return this.store.deleteById(id);
  }

  async updateImage(id: string, rawImage: unknown): Promise<Bot> {
    const image = typeof rawImage === "string" ? rawImage.trim() : "";
    if (image !== "") {
      if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(image)) {
        throw new BotServiceError(400, "imagem invalida (use PNG, JPEG, GIF ou WEBP)");
      }
      if (image.length > 300_000) {
        throw new BotServiceError(413, "imagem muito grande (reduza o tamanho)");
      }
    }
    const bot = await this.store.updateImage(id, image);
    if (!bot) throw new BotServiceError(404, "bot nao encontrado");
    return bot;
  }

  async listLogs(botId: string, limit = MAX_LOG_LIMIT): Promise<BotLog[] | null> {
    return this.store.listLogsByBot(botId, limit);
  }

  private async getTokenOrThrow(botId: string): Promise<string> {
    const bot = await this.store.getById(botId);
    if (!bot) throw new BotServiceError(404, "bot nao encontrado");
    if (!bot.token) throw new BotServiceError(422, "token do bot nao configurado");
    return bot.token;
  }

  /**
   * Garante que o guild pertence ao bot informado (ou ainda não tem dono).
   * Bloqueia leitura/escrita cross-tenant de configuração de guild de outro bot.
   */
  private async assertGuildOwnership(botId: string, guildId: string): Promise<void> {
    const owner = await this.store.getGuildOwnerBotId(guildId);
    if (owner !== null && owner !== botId) {
      throw new BotServiceError(403, "guild fora do escopo do bot");
    }
  }

  private wrapDiscordError(error: unknown): never {
    if (error instanceof DiscordApiError) {
      if (error.status === 400) throw new BotServiceError(400, "requisicao invalida (identificador do Discord)");
      if (error.status === 401) throw new BotServiceError(422, "token invalido ou expirado");
      if (error.status === 403) throw new BotServiceError(403, "sem permissao no Discord");
      if (error.status === 429) throw new BotServiceError(429, "limite de requisicoes do Discord atingido");
      throw new BotServiceError(502, "erro na API do Discord: " + error.status);
    }
    throw error;
  }

  async listDiscordGuilds(botId: string): Promise<DiscordGuild[]> {
    const token = await this.getTokenOrThrow(botId);
    try {
      const guilds = await fetchBotGuilds(token);
      return guilds.map((g) => ({
        id: g.id,
        name: g.name,
        iconUrl: buildGuildIconUrl(g.id, g.icon),
        memberCount: g.approximate_member_count ?? null,
      }));
    } catch (e) {
      this.wrapDiscordError(e);
    }
  }

  async getBotDiscordUser(botId: string): Promise<BotDiscordUser> {
    const token = await this.getTokenOrThrow(botId);
    try {
      const user = await fetchBotUser(token);
      return {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        avatarUrl: buildAvatarUrl(user.id, user.avatar),
      };
    } catch (e) {
      this.wrapDiscordError(e);
    }
  }

  async updateBotIdentity(
    botId: string,
    fields: { username?: string; avatarDataUri?: string | null }
  ): Promise<BotDiscordUser> {
    const token = await this.getTokenOrThrow(botId);
    try {
      const payload: { username?: string; avatar?: string | null } = {};
      if (fields.username !== undefined) payload.username = fields.username.trim();
      if (fields.avatarDataUri !== undefined) payload.avatar = fields.avatarDataUri;
      const user = await patchBotUser(token, payload);
      return {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        avatarUrl: buildAvatarUrl(user.id, user.avatar),
      };
    } catch (e) {
      this.wrapDiscordError(e);
    }
  }

  async updateGuildNickname(botId: string, guildId: string, nick: string): Promise<void> {
    const token = await this.getTokenOrThrow(botId);
    try {
      await patchGuildNickname(token, guildId, nick.trim());
    } catch (e) {
      this.wrapDiscordError(e);
    }
  }

  async getGuildConfig(botId: string, guildId: string): Promise<GuildConfig | null> {
    const bot = await this.store.getById(botId);
    if (!bot) throw new BotServiceError(404, "bot nao encontrado");
    return this.store.getGuildConfig(guildId, botId);
  }

  async upsertGuildConfig(
    botId: string,
    guildId: string,
    fields: Omit<GuildConfig, "guildId" | "createdAt" | "updatedAt">
  ): Promise<GuildConfig> {
    const bot = await this.store.getById(botId);
    if (!bot) throw new BotServiceError(404, "bot nao encontrado");
    await this.assertGuildOwnership(botId, guildId);
    return this.store.upsertGuildConfig(botId, guildId, fields);
  }

  async listWhitelistQuestions(botId: string): Promise<WhitelistQuestion[]> {
    const bot = await this.store.getById(botId);
    if (!bot) throw new BotServiceError(404, "bot nao encontrado");
    return this.store.listWhitelistQuestions(botId);
  }

  async saveWhitelistQuestions(
    botId: string,
    questions: Array<{ fieldKey: string; questionText: string; correctAnswer: string; orderIndex: number }>
  ): Promise<WhitelistQuestion[]> {
    const bot = await this.store.getById(botId);
    if (!bot) throw new BotServiceError(404, "bot nao encontrado");
    return this.store.saveWhitelistQuestions(botId, questions);
  }

  async listWhitelistApplications(botId: string): Promise<WhitelistApplication[]> {
    const bot = await this.store.getById(botId);
    if (!bot) throw new BotServiceError(404, "bot nao encontrado");
    const applications = await this.store.listWhitelistApplications(botId);
    await this.resolveApplicationHandles(bot.token, applications);
    return applications;
  }

  /**
   * Resolve @username/nome de exibição do Discord para cada aplicação, mutando-as.
   * Usa cache com TTL e nunca lança: se o token faltar ou um usuário falhar,
   * a aplicação fica apenas com o ID numérico.
   */
  private async resolveApplicationHandles(token: string, applications: WhitelistApplication[]): Promise<void> {
    if (!token) return;
    const now = Date.now();
    const unresolved = new Set<string>();
    for (const app of applications) {
      if (!app.userId) continue;
      const cached = userHandleCache.get(app.userId);
      if (cached && now - cached.at < USER_CACHE_TTL_MS) {
        app.username = cached.username;
        app.displayName = cached.displayName;
      } else {
        unresolved.add(app.userId);
      }
    }

    await Promise.all(
      [...unresolved].map(async (userId) => {
        try {
          const user = await fetchDiscordUser(token, userId);
          userHandleCache.set(userId, {
            username: user.username ?? "",
            displayName: user.global_name ?? "",
            at: now,
          });
        } catch {
          // 404 (usuário deletado), token inválido, rate limit etc.: ignora,
          // mantém só o ID. Cacheia vazio por curto período para não martelar.
          userHandleCache.set(userId, { username: "", displayName: "", at: now });
        }
      })
    );

    for (const app of applications) {
      if (!app.username && app.userId) {
        const cached = userHandleCache.get(app.userId);
        if (cached) {
          app.username = cached.username;
          app.displayName = cached.displayName;
        }
      }
    }
  }

  async getExtendedConfig(botId: string, guildId: string): Promise<ExtendedGuildConfig | null> {
    const bot = await this.store.getById(botId);
    if (!bot) throw new BotServiceError(404, "bot nao encontrado");
    return this.store.getExtendedConfig(guildId, botId);
  }

  async upsertExtendedConfig(
    botId: string,
    guildId: string,
    fields: Omit<ExtendedGuildConfig, "guildId">
  ): Promise<ExtendedGuildConfig> {
    const bot = await this.store.getById(botId);
    if (!bot) throw new BotServiceError(404, "bot nao encontrado");
    await this.assertGuildOwnership(botId, guildId);
    return this.store.upsertExtendedConfig(guildId, botId, fields);
  }

  async listGuildRoles(botId: string, guildId: string): Promise<DiscordRole[]> {
    const token = await this.getTokenOrThrow(botId);
    try {
      const roles = await fetchGuildRoles(token, guildId);
      return roles
        .filter((r) => !r.managed && r.name !== "@everyone")
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.color }));
    } catch (e) {
      this.wrapDiscordError(e);
    }
  }

  async listGuildChannels(botId: string, guildId: string): Promise<DiscordChannel[]> {
    const token = await this.getTokenOrThrow(botId);
    try {
      const channels = await fetchGuildChannels(token, guildId);
      return channels
        .filter((c) => c.type === 0 || c.type === 4 || c.type === 5) // text + category + announcement
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parent_id }));
    } catch (e) {
      this.wrapDiscordError(e);
    }
  }

  async sendAnnouncement(
    botId: string,
    channelId: string,
    content: string,
    mentionRoleIds: string[],
    hideRoles = false
  ): Promise<void> {
    const token = await this.getTokenOrThrow(botId);
    const mentionStr = mentionRoleIds.map((id) => `<@&${id}>`).join(" ");
    const mentions = mentionStr
      ? hideRoles ? `||${mentionStr}||` : mentionStr
      : "";
    const fullContent = mentions ? `${mentions}\n${content}` : content;
    try {
      await sendChannelMessage(token, channelId, fullContent, mentionRoleIds);
    } catch (e) {
      this.wrapDiscordError(e);
    }
  }

  async sendTicketReply(
    botId: string,
    channelId: string,
    adminName: string,
    content: string
  ): Promise<void> {
    const token = await this.getTokenOrThrow(botId);
    const message = `**[${adminName}]** ${content}`;
    try {
      await sendChannelMessage(token, channelId, message);
    } catch (e) {
      this.wrapDiscordError(e);
    }
  }

  async addUserToTicket(botId: string, channelId: string, userId: string): Promise<void> {
    const token = await this.getTokenOrThrow(botId);
    try {
      // VIEW_CHANNEL (1024) + SEND_MESSAGES (2048)
      await createChannelPermissionOverwrite(token, channelId, userId, "3072", "0", 1);
    } catch (e) {
      this.wrapDiscordError(e);
    }
  }

  async listTickets(botId: string, guildId: string, claimedBy?: string): Promise<Ticket[]> {
    const bot = await this.store.getById(botId);
    if (!bot) throw new BotServiceError(404, "bot nao encontrado");
    return this.store.listTickets(guildId, botId, claimedBy);
  }

  async claimTicket(botId: string, ticketId: number, discordId: string): Promise<void> {
    const bot = await this.store.getById(botId);
    if (!bot) throw new BotServiceError(404, "bot nao encontrado");
    await this.store.claimTicket(ticketId, discordId, botId);
  }

  async listTicketMessages(botId: string, ticketId: number): Promise<TicketMessage[]> {
    const bot = await this.store.getById(botId);
    if (!bot) throw new BotServiceError(404, "bot nao encontrado");
    return this.store.listTicketMessages(ticketId, botId);
  }

  async setBotPresence(
    botId: string,
    guildId: string,
    status: string,
    activityType: number,
    activityName: string
  ): Promise<void> {
    const bot = await this.store.getById(botId);
    if (!bot) throw new BotServiceError(404, "bot nao encontrado");
    await this.store.enqueueBotAction(guildId, "set_presence", {
      status,
      type: activityType,
      name: activityName,
    });
  }
}

export function createPostgresBotService(databaseUrl: string): BotService {
  const store = new BotStorePostgres(databaseUrl);
  return new BotService(store);
}
