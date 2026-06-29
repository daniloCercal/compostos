import { Router } from "express";
import { z } from "zod";

import { getAdminPrincipal } from "../../middleware/auth";
import type { DiscordOauthStore } from "./discord-oauth-store";

const configSchema = z.object({
  clientId: z.string().trim().max(100).optional(),
  clientSecret: z.string().trim().max(200).optional(),
  enabled: z.boolean().optional(),
});

const mappingSchema = z.object({
  guildId: z.string().trim().min(1).max(40),
  roleId: z.string().trim().min(1).max(40),
  roleName: z.string().trim().max(120).default(""),
  panelRole: z.enum(["admin", "user"]),
});

/**
 * CRUD da config do "Entrar com Discord" — restrito a quem gerencia usuários
 * (admin/CEO). Mapear um cargo para `admin` exige permissão de criar admins (CEO).
 */
export function createDiscordOauthAdminRouter(store: DiscordOauthStore): Router {
  const router = Router();

  router.use((_req, res, next) => {
    const p = getAdminPrincipal(res);
    if (!p?.permissions.canManageUsers) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }
    next();
  });

  router.get("/config", async (_req, res, next) => {
    try {
      const [config, mappings] = await Promise.all([
        store.getConfig(),
        store.listMappings(),
      ]);
      res.json({ config, mappings });
    } catch (error) {
      next(error);
    }
  });

  router.put("/config", async (req, res, next) => {
    try {
      const parsed = configSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "payload invalido" });
        return;
      }
      await store.setConfig(parsed.data);
      res.json({ config: await store.getConfig() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/mappings", async (req, res, next) => {
    try {
      const parsed = mappingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "payload invalido" });
        return;
      }
      const principal = getAdminPrincipal(res);
      if (parsed.data.panelRole === "admin" && !principal?.permissions.canCreateAdmins) {
        res.status(403).json({ error: "apenas o CEO pode mapear cargos para admin" });
        return;
      }
      await store.addMapping(parsed.data);
      res.status(201).json({ mappings: await store.listMappings() });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/mappings/:id", async (req, res, next) => {
    try {
      await store.removeMapping(String(req.params.id));
      res.json({ mappings: await store.listMappings() });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
