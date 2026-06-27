import type { NextFunction, Request, Response } from "express";

import { getAdminSession } from "./auth";
import { timingSafeEqual } from "../utils/crypto";

const PROTECTED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function requireCsrfToken(req: Request, res: Response, next: NextFunction): void {
  if (!PROTECTED_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const session = getAdminSession(res);
  if (!session) {
    res.status(401).json({ error: "nao autorizado" });
    return;
  }

  const csrfHeader = String(req.headers["x-csrf-token"] ?? "").trim();
  if (!csrfHeader || !timingSafeEqual(csrfHeader, session.csrfToken)) {
    res.status(403).json({ error: "token csrf invalido" });
    return;
  }

  next();
}

