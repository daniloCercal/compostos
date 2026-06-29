import express, { type Router } from "express";

import type { Bot, BotLog, BotStatus, GuildConfig, WhitelistQuestion, WhitelistApplication, ExtendedGuildConfig, DiscordRole, DiscordChannel, Ticket, PanelConfigs, PanelEmbedConfig } from "../../types";
import { getAdminPrincipal } from "../../middleware/auth";
import { BotServiceError, type BotService } from "./bot-service";

function parsePanelEmbed(v: unknown): PanelEmbedConfig {
  const o = typeof v === "object" && v !== null ? v as Record<string, unknown> : {};
  return {
    title: String(o.title ?? ""),
    description: String(o.description ?? ""),
    buttonLabel: String(o.buttonLabel ?? ""),
    placeholder: String(o.placeholder ?? ""),
  };
}

function parsePanelConfigs(v: unknown): PanelConfigs {
  const o = typeof v === "object" && v !== null ? v as Record<string, unknown> : {};
  return {
    whitelist: parsePanelEmbed(o.whitelist),
    tickets: parsePanelEmbed(o.tickets),
    verification: parsePanelEmbed(o.verification),
  };
}

function toApiBot(bot: Bot): Record<string, unknown> {
  return {
    id: bot.id,
    name: bot.name,
    image: bot.image,
    commands: bot.commands,
    is_active: bot.isActive,
    created_at: bot.createdAt,
    updated_at: bot.updatedAt
  };
}

function toApiBotLog(log: BotLog): Record<string, unknown> {
  return {
    id: log.id,
    bot_id: log.botId,
    timestamp: log.timestamp,
    type: log.type,
    data: log.data,
    created_at: log.createdAt
  };
}

function toApiBotStatus(status: BotStatus): Record<string, unknown> {
  return {
    bot_id: status.botId,
    bot_name: status.botName,
    is_active: status.isActive,
    bot_updated_at: status.botUpdatedAt,
    status: status.status,
    is_online: status.isOnline,
    last_seen_at: status.lastSeenAt,
    started_at: status.startedAt,
    restart_requested_at: status.restartRequestedAt,
    guilds_count: status.guildsCount,
    latency_ms: status.latencyMs,
    error_message: status.errorMessage,
    status_updated_at: status.statusUpdatedAt,
  };
}

function toApiWhitelistQuestion(q: WhitelistQuestion): Record<string, unknown> {
  return {
    id: q.id,
    bot_id: q.botId,
    order_index: q.orderIndex,
    field_key: q.fieldKey,
    question_text: q.questionText,
    correct_answer: q.correctAnswer,
    question_type: q.questionType,
    options: q.options,
    correct_index: q.correctIndex,
  };
}

function toApiWhitelistApplication(a: WhitelistApplication): Record<string, unknown> {
  return {
    id: a.id,
    guild_id: a.guildId,
    user_id: a.userId,
    channel_id: a.channelId,
    app_number: a.appNumber,
    status: a.status,
    answers: a.answers,
    current_question: a.currentQuestion,
    reviewed_by: a.reviewedBy,
    review_note: a.reviewNote,
    started_at: a.startedAt,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

function handleServiceError(error: unknown, res: express.Response): boolean {
  if (error instanceof BotServiceError) {
    res.status(error.statusCode).json({ error: error.message });
    return true;
  }
  return false;
}

function routeParamId(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
    return value[0];
  }
  return null;
}

function canAccessBot(principal: ReturnType<typeof getAdminPrincipal>, botId: string): boolean {
  if (!principal) {
    return false;
  }
  if (principal.scope === "all") {
    return true;
  }
  return principal.botIds.includes(botId);
}

type RequiredPermission = "view" | "update" | "delete";

function requireBotAccess(
  req: express.Request,
  res: express.Response,
  permission: RequiredPermission
): string | null {
  const principal = getAdminPrincipal(res);
  const hasPermission =
    permission === "view"
      ? principal?.permissions.canViewBots
      : permission === "update"
        ? principal?.permissions.canUpdateBots
        : principal?.permissions.canDeleteBots;
  if (!hasPermission) {
    res.status(403).json({ error: "acesso negado" });
    return null;
  }

  const botId = routeParamId(req.params.id);
  if (!botId) {
    res.status(400).json({ error: "id invalido" });
    return null;
  }
  if (!canAccessBot(principal, botId)) {
    res.status(403).json({ error: "acesso negado" });
    return null;
  }
  return botId;
}


// Extrai o ID Discord do email sintético dos usuários logados via Discord
// (`discord_<id>@discord.bypass`). Retorna null para contas email/senha.
function extractDiscordId(email: string | undefined): string | null {
  if (!email) return null;
  const m = /^discord_(\d+)@discord\.bypass$/.exec(email);
  return m?.[1] ?? null;
}

export function createBotAdminRouter(service: BotService): Router {
  const router = express.Router();

  router.get("/", async (_req, res, next) => {
    const principal = getAdminPrincipal(res);
    if (!principal?.permissions.canViewBots) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    try {
      const bots = await service.list();
      const visibleBots =
        principal.scope === "all" ? bots : bots.filter((bot) => principal.botIds.includes(bot.id));
      res.status(200).json({ bots: visibleBots.map(toApiBot) });
    } catch (error) {
      if (handleServiceError(error, res)) {
        return;
      }
      next(error);
    }
  });

  router.get("/status", async (_req, res, next) => {
    const principal = getAdminPrincipal(res);
    if (!principal?.permissions.canViewBots) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    try {
      const statusList = await service.listStatus();
      const visibleItems =
        principal.scope === "all"
          ? statusList
          : statusList.filter((item) => principal.botIds.includes(item.botId));
      res.status(200).json({ items: visibleItems.map(toApiBotStatus) });
    } catch (error) {
      if (handleServiceError(error, res)) {
        return;
      }
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    const principal = getAdminPrincipal(res);
    if (!principal?.permissions.canCreateBots) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    try {
      const bot = await service.create(req.body);
      res.status(201).json({ bot: toApiBot(bot) });
    } catch (error) {
      if (handleServiceError(error, res)) {
        return;
      }
      next(error);
    }
  });

  router.get("/:id", async (req, res, next) => {
    const principal = getAdminPrincipal(res);
    if (!principal?.permissions.canViewBots) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    const botId = routeParamId(req.params.id);
    if (!botId) {
      res.status(400).json({ error: "id invalido" });
      return;
    }
    if (!canAccessBot(principal, botId)) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    try {
      const bot = await service.getById(botId);
      if (!bot) {
        res.status(404).json({ error: "bot nao encontrado" });
        return;
      }
      res.status(200).json({ bot: toApiBot(bot) });
    } catch (error) {
      if (handleServiceError(error, res)) {
        return;
      }
      next(error);
    }
  });

  router.put("/:id", async (req, res, next) => {
    const principal = getAdminPrincipal(res);
    if (!principal?.permissions.canUpdateBots) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    const botId = routeParamId(req.params.id);
    if (!botId) {
      res.status(400).json({ error: "id invalido" });
      return;
    }
    if (!canAccessBot(principal, botId)) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    try {
      const bot = await service.update(botId, req.body);
      if (!bot) {
        res.status(404).json({ error: "bot nao encontrado" });
        return;
      }
      res.status(200).json({ bot: toApiBot(bot) });
    } catch (error) {
      if (handleServiceError(error, res)) {
        return;
      }
      next(error);
    }
  });

  router.post("/:id/restart", async (req, res, next) => {
    const principal = getAdminPrincipal(res);
    if (!principal?.permissions.canUpdateBots) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    const botId = routeParamId(req.params.id);
    if (!botId) {
      res.status(400).json({ error: "id invalido" });
      return;
    }
    if (!canAccessBot(principal, botId)) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    try {
      const bot = await service.restart(botId);
      if (!bot) {
        res.status(404).json({ error: "bot nao encontrado" });
        return;
      }
      res.status(200).json({
        ok: true,
        message: "reinicio solicitado",
        bot: toApiBot(bot),
      });
    } catch (error) {
      if (handleServiceError(error, res)) {
        return;
      }
      next(error);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    const principal = getAdminPrincipal(res);
    if (!principal?.permissions.canDeleteBots) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    const botId = routeParamId(req.params.id);
    if (!botId) {
      res.status(400).json({ error: "id invalido" });
      return;
    }
    if (!canAccessBot(principal, botId)) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    try {
      const removed = await service.remove(botId);
      if (!removed) {
        res.status(404).json({ error: "bot nao encontrado" });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (error) {
      if (handleServiceError(error, res)) {
        return;
      }
      next(error);
    }
  });

  router.get("/:id/logs", async (req, res, next) => {
    const principal = getAdminPrincipal(res);
    if (!principal?.permissions.canViewBots) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    const botId = routeParamId(req.params.id);
    if (!botId) {
      res.status(400).json({ error: "id invalido" });
      return;
    }
    if (!canAccessBot(principal, botId)) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    try {
      const logs = await service.listLogs(botId, 50);
      if (!logs) {
        res.status(404).json({ error: "bot nao encontrado" });
        return;
      }
      res.status(200).json({ logs: logs.map(toApiBotLog) });
    } catch (error) {
      if (handleServiceError(error, res)) {
        return;
      }
      next(error);
    }
  });


  // --- Discord guilds & identity ---

  router.get("/:id/guilds", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "view");
    if (!botId) return;
    try {
      const guilds = await service.listDiscordGuilds(botId);
      res.status(200).json({ guilds });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  router.get("/:id/me", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "view");
    if (!botId) return;
    try {
      const user = await service.getBotDiscordUser(botId);
      res.status(200).json({ user });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  router.put("/:id/me", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "update");
    if (!botId) return;
    try {
      const { username, avatar_data_uri: avatarDataUri } = req.body as Record<string, string | undefined>;
      const user = await service.updateBotIdentity(botId, { username, avatarDataUri });
      res.status(200).json({ user });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  // Imagem do bot armazenada no painel (data URI). Distinta do avatar do Discord
  // (PUT /me): aqui só persiste no painel; aplicar no Discord é uma ação separada.
  router.put("/:id/image", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "update");
    if (!botId) return;
    try {
      const { image } = req.body as { image?: unknown };
      const bot = await service.updateImage(botId, image);
      res.status(200).json({ bot: toApiBot(bot) });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  router.put("/:id/guilds/:guildId/nick", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "update");
    if (!botId) return;
    const guildId = typeof req.params.guildId === "string" ? req.params.guildId : "";
    if (!guildId) { res.status(400).json({ error: "guildId invalido" }); return; }
    try {
      const { nick } = req.body as { nick?: string };
      if (typeof nick !== "string") { res.status(400).json({ error: "nick obrigatorio" }); return; }
      await service.updateGuildNickname(botId, guildId, nick);
      res.status(200).json({ ok: true });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  // --- Guild config ---

  router.get("/:id/guilds/:guildId/config", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "view");
    if (!botId) return;
    const guildId = typeof req.params.guildId === "string" ? req.params.guildId : "";
    if (!guildId) { res.status(400).json({ error: "guildId invalido" }); return; }
    try {
      const config = await service.getGuildConfig(botId, guildId);
      res.status(200).json({ config: config ?? null });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  router.put("/:id/guilds/:guildId/config", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "update");
    if (!botId) return;
    const guildId = typeof req.params.guildId === "string" ? req.params.guildId : "";
    if (!guildId) { res.status(400).json({ error: "guildId invalido" }); return; }
    try {
      const body = req.body as Partial<GuildConfig> & Record<string, unknown>;
      const fields: Omit<GuildConfig, "guildId" | "createdAt" | "updatedAt"> = {
        logChannelId:          String(body.logChannelId ?? body.log_channel_id ?? ""),
        ticketCategoryId:      String(body.ticketCategoryId ?? body.ticket_category_id ?? ""),
        ticketLogChannelId:    String(body.ticketLogChannelId ?? body.ticket_log_channel_id ?? ""),
        whitelistChannelId:    String(body.whitelistChannelId ?? body.whitelist_channel_id ?? ""),
        whitelistLogChannelId: String(body.whitelistLogChannelId ?? body.whitelist_log_channel_id ?? ""),
        whitelistRoleId:       String(body.whitelistRoleId ?? body.whitelist_role_id ?? ""),
        verifiedRoleId:        String(body.verifiedRoleId ?? body.verified_role_id ?? ""),
        staffRoleId:           String(body.staffRoleId ?? body.staff_role_id ?? ""),
        adminRoleId:           String(body.adminRoleId ?? body.admin_role_id ?? ""),
        maxTicketsPerUser:     Number(body.maxTicketsPerUser ?? body.max_tickets_per_user ?? 3),
        ticketPrefix:          String(body.ticketPrefix ?? body.ticket_prefix ?? "ticket"),
        whitelistPassMessage:  String(body.whitelistPassMessage ?? body.whitelist_pass_message ?? ""),
        whitelistFailMessage:  String(body.whitelistFailMessage ?? body.whitelist_fail_message ?? ""),
        welcomeMessage:        String(body.welcomeMessage ?? body.welcome_message ?? ""),
        whitelistPassScore:    Number(body.whitelistPassScore ?? body.whitelist_pass_score ?? 80),
        panelConfigs: parsePanelConfigs(body.panelConfigs ?? body.panel_configs),
      };
      const config = await service.upsertGuildConfig(botId, guildId, fields);
      res.status(200).json({ config });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  // --- Whitelist questions ---

  router.get("/:id/whitelist-questions", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "view");
    if (!botId) return;
    try {
      const questions = await service.listWhitelistQuestions(botId);
      res.status(200).json({ questions: questions.map(toApiWhitelistQuestion) });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  router.get("/:id/whitelist-applications", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "view");
    if (!botId) return;
    try {
      const applications = await service.listWhitelistApplications(botId);
      res.status(200).json({ applications: applications.map(toApiWhitelistApplication) });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  router.put("/:id/whitelist-questions", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "update");
    if (!botId) return;
    try {
      const body = req.body as { questions?: unknown[] };
      const rawQuestions = Array.isArray(body.questions) ? body.questions : [];
      const questions = rawQuestions.map((q, index) => {
        const item = typeof q === "object" && q !== null ? q as Record<string, unknown> : {};
        const rawOpts = item.options;
        const options = Array.isArray(rawOpts) ? rawOpts.map(String) : [];
        return {
          fieldKey: String(item.fieldKey ?? item.field_key ?? ""),
          questionText: String(item.questionText ?? item.question_text ?? ""),
          correctAnswer: String(item.correctAnswer ?? item.correct_answer ?? ""),
          orderIndex: typeof item.orderIndex === "number" ? item.orderIndex : (typeof item.order_index === "number" ? item.order_index : index),
          questionType: String(item.questionType ?? item.question_type ?? "open"),
          options,
          correctIndex: typeof item.correctIndex === "number" ? item.correctIndex : (typeof item.correct_index === "number" ? item.correct_index : 0),
        };
      }).filter((q) => q.fieldKey.trim().length > 0);

      const saved = await service.saveWhitelistQuestions(botId, questions);
      res.status(200).json({ questions: saved.map(toApiWhitelistQuestion) });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  // --- Extended guild config (embed color, images, DM defaults) ---

  router.get("/:id/guilds/:guildId/extended-config", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "view");
    if (!botId) return;
    const guildId = typeof req.params.guildId === "string" ? req.params.guildId : "";
    if (!guildId) { res.status(400).json({ error: "guildId invalido" }); return; }
    try {
      const config = await service.getExtendedConfig(botId, guildId);
      res.status(200).json({ config: config ?? null });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  router.put("/:id/guilds/:guildId/extended-config", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "update");
    if (!botId) return;
    const guildId = typeof req.params.guildId === "string" ? req.params.guildId : "";
    if (!guildId) { res.status(400).json({ error: "guildId invalido" }); return; }
    try {
      const body = req.body as Partial<ExtendedGuildConfig> & Record<string, unknown>;
      const fields: Omit<ExtendedGuildConfig, "guildId"> = {
        embedColor: Number(body.embedColor ?? body.embed_color ?? 0x8B0000),
        ticketImageUrl: String(body.ticketImageUrl ?? body.ticket_image_url ?? ""),
        welcomeImageUrl: String(body.welcomeImageUrl ?? body.welcome_image_url ?? ""),
        dmNotifyDefault: Boolean(body.dmNotifyDefault ?? body.dm_notify_default ?? true),
      };
      const config = await service.upsertExtendedConfig(botId, guildId, fields);
      res.status(200).json({ config });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  // --- Discord roles & channels ---

  router.get("/:id/guilds/:guildId/roles", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "view");
    if (!botId) return;
    const guildId = typeof req.params.guildId === "string" ? req.params.guildId : "";
    if (!guildId) { res.status(400).json({ error: "guildId invalido" }); return; }
    try {
      const roles: DiscordRole[] = await service.listGuildRoles(botId, guildId);
      res.status(200).json({ roles });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  router.get("/:id/guilds/:guildId/channels", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "view");
    if (!botId) return;
    const guildId = typeof req.params.guildId === "string" ? req.params.guildId : "";
    if (!guildId) { res.status(400).json({ error: "guildId invalido" }); return; }
    try {
      const channels: DiscordChannel[] = await service.listGuildChannels(botId, guildId);
      res.status(200).json({ channels });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  // --- Announcements ---

  router.post("/:id/guilds/:guildId/announcements", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "update");
    if (!botId) return;
    const guildId = typeof req.params.guildId === "string" ? req.params.guildId : "";
    if (!guildId) { res.status(400).json({ error: "guildId invalido" }); return; }
    try {
      const body = req.body as { channelId?: string; content?: string; mentionRoleIds?: string[]; hideRoles?: boolean };
      const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!channelId) { res.status(400).json({ error: "channelId obrigatorio" }); return; }
      if (!content) { res.status(400).json({ error: "content obrigatorio" }); return; }
      const mentionRoleIds = Array.isArray(body.mentionRoleIds) ? body.mentionRoleIds.filter((x): x is string => typeof x === "string") : [];
      const hideRoles = body.hideRoles === true;
      await service.sendAnnouncement(botId, channelId, content, mentionRoleIds, hideRoles);
      res.status(200).json({ ok: true });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  // --- Ticket management ---

  router.get("/:id/guilds/:guildId/tickets", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "view");
    if (!botId) return;
    const guildId = typeof req.params.guildId === "string" ? req.params.guildId : "";
    if (!guildId) { res.status(400).json({ error: "guildId invalido" }); return; }
    try {
      const principal = getAdminPrincipal(res);
      const isAdmin = principal?.role === "ceo" || principal?.role === "admin";
      const discordId = extractDiscordId(principal?.email);
      // Suporte (não-admin) só vê os tickets que reivindicou; sem vínculo Discord -> nenhum.
      if (!isAdmin && !discordId) {
        res.status(200).json({ tickets: [] });
        return;
      }
      const tickets: Ticket[] = await service.listTickets(
        botId,
        guildId,
        isAdmin ? undefined : discordId ?? undefined
      );
      res.status(200).json({ tickets });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  // Reivindica ("pega") um ticket para o usuário Discord logado.
  router.post("/:id/guilds/:guildId/tickets/:ticketId/claim", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "view");
    if (!botId) return;
    try {
      const discordId = extractDiscordId(getAdminPrincipal(res)?.email);
      if (!discordId) {
        res.status(400).json({ error: "apenas usuarios logados via Discord podem pegar tickets" });
        return;
      }
      const ticketId = Number.parseInt(String(req.params.ticketId), 10);
      if (!Number.isFinite(ticketId)) { res.status(400).json({ error: "ticketId invalido" }); return; }
      await service.claimTicket(botId, ticketId, discordId);
      res.status(200).json({ ok: true });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  // Histórico de mensagens do ticket (chat) — para a tela de resposta.
  router.get("/:id/guilds/:guildId/tickets/:ticketId/messages", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "view");
    if (!botId) return;
    try {
      const ticketId = Number.parseInt(String(req.params.ticketId), 10);
      if (!Number.isFinite(ticketId)) { res.status(400).json({ error: "ticketId invalido" }); return; }
      const messages = await service.listTicketMessages(botId, ticketId);
      res.status(200).json({ messages });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  router.post("/:id/guilds/:guildId/tickets/:ticketId/reply", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "view");
    if (!botId) return;
    try {
      const body = req.body as { channelId?: string; adminName?: string; content?: string };
      const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
      const adminName = typeof body.adminName === "string" ? body.adminName.trim() : "Admin";
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!channelId) { res.status(400).json({ error: "channelId obrigatorio" }); return; }
      if (!content) { res.status(400).json({ error: "content obrigatorio" }); return; }
      await service.sendTicketReply(botId, channelId, adminName, content);
      res.status(200).json({ ok: true });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  router.post("/:id/guilds/:guildId/tickets/:ticketId/add-user", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "update");
    if (!botId) return;
    try {
      const body = req.body as { channelId?: string; userId?: string };
      const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
      const userId = typeof body.userId === "string" ? body.userId.trim() : "";
      if (!channelId) { res.status(400).json({ error: "channelId obrigatorio" }); return; }
      if (!userId) { res.status(400).json({ error: "userId obrigatorio" }); return; }
      await service.addUserToTicket(botId, channelId, userId);
      res.status(200).json({ ok: true });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  // --- Bot presence ---

  router.post("/:id/guilds/:guildId/presence", async (req, res, next) => {
    const botId = requireBotAccess(req, res, "update");
    if (!botId) return;
    const guildId = typeof req.params.guildId === "string" ? req.params.guildId : "";
    if (!guildId) { res.status(400).json({ error: "guildId invalido" }); return; }
    try {
      const body = req.body as { status?: string; activityType?: number; activityName?: string };
      const status = typeof body.status === "string" ? body.status : "online";
      const activityType = typeof body.activityType === "number" ? body.activityType : 0;
      const activityName = typeof body.activityName === "string" ? body.activityName : "";
      await service.setBotPresence(botId, guildId, status, activityType, activityName);
      res.status(200).json({ ok: true });
    } catch (error) {
      if (handleServiceError(error, res)) return;
      next(error);
    }
  });

  return router;
}
