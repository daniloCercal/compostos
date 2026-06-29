import type { Router } from "express";
import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";

import {
  createWithOptionalAdminSession,
  createRequireAdminSession,
  getAdminSession,
} from "../../middleware/auth";
import type { AdminUserStorePostgres } from "./admin-user-store-postgres";
import type { AppLucia } from "./lucia";
import type { AuditStorePostgres } from "../audit/audit-store-postgres";
import { randomToken } from "../../utils/crypto";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(512),
});

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip =
      (typeof req.ip === "string" && req.ip.trim()) ||
      (typeof req.socket?.remoteAddress === "string" &&
        req.socket.remoteAddress.trim()) ||
      "0.0.0.0";
    return ipKeyGenerator(ip);
  },
  message: {
    error: "muitas tentativas de login. tente novamente mais tarde.",
  },
});

function toSessionResponse(
  principal: Awaited<ReturnType<AdminUserStorePostgres["getPrincipalById"]>>
) {
  if (!principal) {
    return { authenticated: false as const };
  }

  return {
    authenticated: true as const,
    user: {
      id: principal.id,
      email: principal.email,
      displayName: principal.displayName,
      role: principal.role,
      scope: principal.scope,
    },
    permissions: principal.permissions,
    botIds: principal.botIds,
  };
}

export function createAuthRouter(
  store: AdminUserStorePostgres,
  lucia: AppLucia,
  auditStore: AuditStorePostgres
): Router {
  const router = express.Router();
  const withOptionalAdminSession = createWithOptionalAdminSession(lucia);
  const requireAdminSession = createRequireAdminSession(lucia);

  // Registra eventos de autenticação no audit_log (categoria "auth").
  function recordAuth(
    req: express.Request,
    userId: string | null,
    userEmail: string | null,
    userRole: string | null,
    path: string,
    status: number
  ): void {
    const forwarded = req.headers["x-forwarded-for"];
    const ip =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded)
        ?.toString()
        .split(",")[0]
        ?.trim() ||
      req.ip ||
      null;
    void auditStore
      .record({
        userId,
        userEmail,
        userRole,
        method: req.method,
        path,
        statusCode: status,
        durationMs: 0,
        ip,
        userAgent: req.get("user-agent") ?? null,
        category: "auth",
      })
      .catch(() => {});
  }

  router.post("/login", loginLimiter, async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const payload = loginSchema.safeParse(req.body);
    if (!payload.success) {
      res.status(400).json({ error: "payload invalido" });
      return;
    }

    try {
      const principal = await store.authenticate(
        payload.data.email,
        payload.data.password
      );
      if (!principal) {
        recordAuth(req, null, payload.data.email, null, "/api/admin/login", 401);
        res.status(401).json({ error: "credenciais invalidas" });
        return;
      }

      // Create a Lucia session with a fresh CSRF token stored as an attribute.
      const session = await lucia.createSession(principal.id, {
        csrf_token: randomToken(24),
      });
      const cookie = lucia.createSessionCookie(session.id);
      res.appendHeader("Set-Cookie", cookie.serialize());

      await store.recordLogin(principal.id);
      recordAuth(req, principal.id, principal.email, principal.role, "/api/admin/login", 200);
      res.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const sessionId = lucia.readSessionCookie(req.headers.cookie ?? "");
      let uid: string | null = null;
      let uemail: string | null = null;
      let urole: string | null = null;
      if (sessionId) {
        const { user } = await lucia.validateSession(sessionId);
        if (user) {
          uid = user.id;
          uemail = user.email;
          urole = user.role;
        }
        await lucia.invalidateSession(sessionId);
      }
      const blank = lucia.createBlankSessionCookie();
      res.appendHeader("Set-Cookie", blank.serialize());
      recordAuth(req, uid, uemail, urole, "/api/admin/logout", 200);
      res.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/session",
    withOptionalAdminSession,
    async (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      const session = getAdminSession(res);
      if (!session) {
        res.status(200).json({ authenticated: false });
        return;
      }

      try {
        const principal = await store.getPrincipalById(session.userId);
        res.status(200).json(toSessionResponse(principal));
      } catch (error) {
        next(error);
      }
    }
  );

  router.get("/csrf-token", requireAdminSession, async (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const session = getAdminSession(res);
    if (!session) {
      res.status(401).json({ error: "nao autorizado" });
      return;
    }
    try {
      // Confere que o usuário ainda existe e está ativo — sessão viva de conta
      // desativada não deve obter token CSRF.
      const principal = await store.getPrincipalById(session.userId);
      if (!principal) {
        res.status(401).json({ error: "sessao invalida" });
        return;
      }
      res.status(200).json({ csrfToken: session.csrfToken });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
