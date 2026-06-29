import { Router } from "express";

import { randomToken } from "../../utils/crypto";
import { fetchGuildMemberRoles } from "../../utils/discord-api";
import type { DiscordOauthStore } from "./discord-oauth-store";
import type { AdminUserStorePostgres } from "../auth/admin-user-store-postgres";
import type { AppLucia } from "../auth/lucia";
import type { BotService } from "../bot/bot-service";

const PANEL_URL = "https://painel.daniloc.work";
const REDIRECT_URI = `${PANEL_URL}/api/admin/auth/discord/callback`;
const STATE_COOKIE = "discord_oauth_state";

function fail(res: import("express").Response, reason: string): void {
  res.redirect(`${PANEL_URL}/?discord_error=${reason}`);
}

/**
 * Fluxo público "Entrar com Discord": redireciona pro OAuth, no callback resolve
 * os cargos do usuário (via token de bot), aplica o mapa de cargos -> papel,
 * provisiona o usuário e cria a sessão Lucia. Sem sessão/CSRF (usuário deslogado).
 */
export function createDiscordOauthFlowRouter(
  store: DiscordOauthStore,
  adminUserStore: AdminUserStorePostgres,
  lucia: AppLucia,
  botService: BotService
): Router {
  const router = Router();

  router.get("/auth/discord/status", async (_req, res, next) => {
    try {
      const cfg = await store.getConfig();
      res.json({ enabled: cfg.enabled && Boolean(cfg.clientId) && cfg.hasSecret });
    } catch (error) {
      next(error);
    }
  });

  router.get("/auth/discord", async (_req, res, next) => {
    try {
      const { clientId, clientSecret, enabled } = await store.getCredentials();
      if (!enabled || !clientId || !clientSecret) {
        fail(res, "disabled");
        return;
      }
      const state = randomToken(16);
      res.cookie(STATE_COOKIE, state, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 10 * 60 * 1000,
        path: "/",
      });
      const url = new URL("https://discord.com/oauth2/authorize");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", REDIRECT_URI);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "identify");
      url.searchParams.set("state", state);
      res.redirect(url.toString());
    } catch (error) {
      next(error);
    }
  });

  router.get("/auth/discord/callback", async (req, res, next) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const cookieState = (req.cookies as Record<string, string> | undefined)?.[STATE_COOKIE];
      res.clearCookie(STATE_COOKIE, { path: "/" });
      if (!code || !state || !cookieState || state !== cookieState) {
        fail(res, "state");
        return;
      }

      const { clientId, clientSecret } = await store.getCredentials();
      if (!clientId || !clientSecret) {
        fail(res, "config");
        return;
      }

      // Troca o code por um access token.
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
        }),
      });
      if (!tokenRes.ok) {
        fail(res, "token");
        return;
      }
      const tokenData = (await tokenRes.json()) as { access_token?: string };
      if (!tokenData.access_token) {
        fail(res, "token");
        return;
      }

      // Identidade do usuário Discord.
      const meRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!meRes.ok) {
        fail(res, "user");
        return;
      }
      const me = (await meRes.json()) as {
        id: string;
        username: string;
        global_name?: string | null;
      };

      const mappings = await store.listMappings();
      if (mappings.length === 0) {
        fail(res, "no_mappings");
        return;
      }

      // Token de bot para consultar os cargos do membro nas guilds mapeadas.
      const bots = await botService.list();
      const botToken = bots.find((b) => b.token)?.token ?? "";
      if (!botToken) {
        fail(res, "no_bot");
        return;
      }

      const guildIds = Array.from(new Set(mappings.map((m) => m.guildId)));
      let resolvedRole: "admin" | "user" | null = null;
      for (const guildId of guildIds) {
        let memberRoles: string[] = [];
        try {
          memberRoles = await fetchGuildMemberRoles(botToken, guildId, me.id);
        } catch {
          memberRoles = [];
        }
        for (const m of mappings) {
          if (m.guildId === guildId && memberRoles.includes(m.roleId)) {
            if (m.panelRole === "admin") resolvedRole = "admin";
            else if (resolvedRole !== "admin") resolvedRole = "user";
          }
        }
      }

      if (!resolvedRole) {
        fail(res, "no_access");
        return;
      }

      const displayName = me.global_name || me.username || `discord:${me.id}`;
      const userId = await adminUserStore.provisionDiscordUser({
        discordId: me.id,
        username: displayName,
        role: resolvedRole,
      });
      const session = await lucia.createSession(userId, {
        csrf_token: randomToken(24),
      });
      res.appendHeader("Set-Cookie", lucia.createSessionCookie(session.id).serialize());
      res.redirect(`${PANEL_URL}/`);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
