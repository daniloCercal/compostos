import type { NextFunction, Request, Response } from "express";

import { getAdminPrincipal } from "./auth";
import type { AuditStorePostgres } from "../modules/audit/audit-store-postgres";

/**
 * Registra cada request que chega ao router admin protegido.
 *
 * Deve ser montado APÓS requireAdminPrincipal (para ter o principal em
 * res.locals) e idealmente ANTES de requireCsrfToken (assim mutações
 * rejeitadas por CSRF — 403 — também ficam auditadas).
 *
 * Grava no evento `finish` da resposta (já com status final), de forma
 * fire-and-forget: falha de auditoria nunca derruba a request do usuário.
 */
export function createAuditMiddleware(store: AuditStorePostgres) {
  return function auditMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const startNs = process.hrtime.bigint();

    res.on("finish", () => {
      const principal = getAdminPrincipal(res);
      const durationMs = Number((process.hrtime.bigint() - startNs) / 1_000_000n);
      // originalUrl sem a query string — captura o caminho concreto acessado
      // (ex.: /api/admin/bots/<id>) sem vazar parâmetros de query.
      const path = req.originalUrl.split("?")[0] ?? req.originalUrl;

      void store
        .record({
          userId: principal?.id ?? null,
          userEmail: principal?.email ?? null,
          userRole: principal?.role ?? null,
          method: req.method,
          path,
          statusCode: res.statusCode,
          durationMs,
          ip: req.ip ?? null,
          userAgent: req.get("user-agent") ?? null,
        })
        .catch((error) => {
          // Auditoria é best-effort; nunca propaga para a request.
          console.error("[audit] falha ao gravar log de acesso:", error);
        });
    });

    next();
  };
}
