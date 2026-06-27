import type { NextFunction, Request, Response } from "express";

import type { AdminPrincipal, AdminSessionInfo } from "../types";
import type { AdminUserStorePostgres } from "../modules/auth/admin-user-store-postgres";
import type { AppLucia } from "../modules/auth/lucia";

const ADMIN_SESSION_LOCAL_KEY = "adminSession";
const ADMIN_PRINCIPAL_LOCAL_KEY = "adminPrincipal";

// ---------------------------------------------------------------------------
// res.locals accessors
// ---------------------------------------------------------------------------

export function getAdminSession(res: Response): AdminSessionInfo | undefined {
  return res.locals[ADMIN_SESSION_LOCAL_KEY] as AdminSessionInfo | undefined;
}

export function getAdminPrincipal(res: Response): AdminPrincipal | undefined {
  return res.locals[ADMIN_PRINCIPAL_LOCAL_KEY] as AdminPrincipal | undefined;
}

// ---------------------------------------------------------------------------
// Internal helper — validate session via Lucia, refresh cookie if needed,
// attach AdminSessionInfo to res.locals. Returns true if session is valid.
// ---------------------------------------------------------------------------
async function validateAndAttach(
  req: Request,
  res: Response,
  lucia: AppLucia
): Promise<boolean> {
  const sessionId = lucia.readSessionCookie(req.headers.cookie ?? "");
  if (!sessionId) return false;

  const { session, user } = await lucia.validateSession(sessionId);

  if (!session) {
    // Session expired or not found — clear the stale cookie.
    const blank = lucia.createBlankSessionCookie();
    res.appendHeader("Set-Cookie", blank.serialize());
    return false;
  }

  if (session.fresh) {
    // Less than half the TTL remains — Lucia extended it; push the new expiry to the client.
    const refreshed = lucia.createSessionCookie(session.id);
    res.appendHeader("Set-Cookie", refreshed.serialize());
  }

  const info: AdminSessionInfo = {
    sessionId: session.id,
    userId: session.userId,
    role: user.role,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  };

  res.locals[ADMIN_SESSION_LOCAL_KEY] = info;
  return true;
}

// ---------------------------------------------------------------------------
// Middleware factories
// ---------------------------------------------------------------------------

/**
 * Attaches AdminSessionInfo to res.locals if a valid session cookie is present.
 * Never blocks the request — use on public endpoints that adapt to auth state.
 */
export function createWithOptionalAdminSession(lucia: AppLucia) {
  return async function withOptionalAdminSession(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      await validateAndAttach(req, res, lucia);
    } catch (error) {
      next(error);
      return;
    }
    next();
  };
}

/**
 * Requires a valid session; returns 401 otherwise.
 */
export function createRequireAdminSession(lucia: AppLucia) {
  return async function requireAdminSession(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const ok = await validateAndAttach(req, res, lucia);
      if (!ok) {
        res.status(401).json({ error: "nao autorizado" });
        return;
      }
    } catch (error) {
      next(error);
      return;
    }
    next();
  };
}

/**
 * Requires a valid session AND a live, active user record.
 * Invalidates the session immediately if the user no longer exists or is inactive.
 * Must be placed after createRequireAdminSession in the middleware chain.
 */
export function createRequireAdminPrincipal(
  store: AdminUserStorePostgres,
  lucia: AppLucia
) {
  return async function requireAdminPrincipal(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const session = getAdminSession(res);
    if (!session) {
      res.status(401).json({ error: "nao autorizado" });
      return;
    }

    try {
      const principal = await store.getPrincipalById(session.userId);

      if (!principal) {
        // User was deleted or deactivated — destroy the session server-side.
        await lucia.invalidateSession(session.sessionId);
        const blank = lucia.createBlankSessionCookie();
        res.appendHeader("Set-Cookie", blank.serialize());
        res.status(401).json({ error: "sessao invalida" });
        return;
      }

      res.locals[ADMIN_PRINCIPAL_LOCAL_KEY] = principal;
      next();
    } catch (error) {
      next(error);
    }
  };
}
