import { Router } from "express";

import { getAdminPrincipal } from "../../middleware/auth";
import type { AuditStorePostgres } from "./audit-store-postgres";

/**
 * Rotas de auditoria — restritas ao CEO.
 * Montado dentro do router admin protegido, então o principal já está em
 * res.locals; aqui só checamos o role.
 */
export function createAuditRouter(store: AuditStorePostgres): Router {
  const router = Router();

  // Guarda: somente CEO.
  router.use((_req, res, next) => {
    const principal = getAdminPrincipal(res);
    if (!principal || principal.role !== "ceo") {
      res.status(403).json({ error: "acesso restrito ao CEO" });
      return;
    }
    next();
  });

  // GET /audit?limit=&offset=&category=&q=
  router.get("/", async (req, res, next) => {
    try {
      const limit = Number.parseInt(String(req.query.limit ?? "50"), 10);
      const offset = Number.parseInt(String(req.query.offset ?? "0"), 10);
      const category =
        typeof req.query.category === "string" ? req.query.category : undefined;
      const q = typeof req.query.q === "string" ? req.query.q : undefined;
      const limitN = Number.isFinite(limit) ? limit : 50;
      const offsetN = Number.isFinite(offset) ? offset : 0;
      const result =
        category === "authorization"
          ? await store.listAuthorizations({ limit: limitN, offset: offsetN, q })
          : await store.list({ limit: limitN, offset: offsetN, category, q });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
