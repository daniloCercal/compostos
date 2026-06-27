import express from "express";

import { createBotAdminRouter } from "../src/modules/bot/bot-router";
import type { AdminPrincipal, BotStatus } from "../src/types";

export function buildPrincipal(overrides: Partial<AdminPrincipal> = {}): AdminPrincipal {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "ceo@example.com",
    displayName: "CEO",
    role: "ceo",
    isActive: true,
    botIds: ["bot-1"],
    scope: "all",
    permissions: {
      canViewBots: true,
      canCreateBots: true,
      canUpdateBots: true,
      canDeleteBots: true,
      canManageUsers: true,
      canCreateAdmins: true,
    },
    ...overrides,
  };
}

export function buildBotStatus(overrides: Partial<BotStatus> = {}): BotStatus {
  return {
    botId: "bot-1",
    botName: "Alpha",
    isActive: true,
    botUpdatedAt: "2026-03-26T12:00:00.000Z",
    status: "online",
    lastSeenAt: "2026-03-26T12:00:00.000Z",
    startedAt: "2026-03-26T12:00:00.000Z",
    restartRequestedAt: null,
    guildsCount: 3,
    latencyMs: 42,
    errorMessage: null,
    statusUpdatedAt: "2026-03-26T12:00:00.000Z",
    isOnline: true,
    ...overrides,
  };
}

export function createBotRouterApp(
  service: unknown,
  principal: AdminPrincipal = buildPrincipal()
) {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.adminPrincipal = principal;
    next();
  });
  app.use("/bots", createBotAdminRouter(service as never));
  return app;
}
