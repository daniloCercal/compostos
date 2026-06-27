import express, { type Router } from "express";
import { z } from "zod";

import { getAdminPrincipal } from "../../middleware/auth";
import type { AdminRole } from "../../types";
import type { AdminUserStorePostgres } from "./admin-user-store-postgres";

const roleSchema = z.enum(["ceo", "admin", "user"]);

const createUserSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(512),
  role: roleSchema,
  botIds: z.array(z.string().uuid()).default([]),
  isActive: z.boolean().default(true),
});

const updateUserSchema = z.object({
  email: z.string().trim().email().optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(8).max(512).optional().or(z.literal("")),
  role: roleSchema.optional(),
  botIds: z.array(z.string().uuid()).optional(),
  isActive: z.boolean().optional(),
});

function toApiUser(user: {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  isActive: boolean;
  botIds: string[];
  scope: "all" | "assigned";
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    botIds: user.botIds,
    scope: user.scope,
  };
}

type Principal = NonNullable<ReturnType<typeof getAdminPrincipal>>;

/**
 * Autoriza a ATRIBUIÇÃO de um papel pelo caller. Escreve 403 e retorna false se
 * não permitido. Só o CEO pode atribuir/promover `ceo` ou `admin`
 * (canCreateAdmins, que antes era definido mas nunca aplicado).
 */
function assertCanAssignRole(principal: Principal, role: AdminRole, res: express.Response): boolean {
  if (role === "ceo" && principal.role !== "ceo") {
    res.status(403).json({ error: "apenas o CEO pode atribuir o papel CEO" });
    return false;
  }
  if (role === "admin" && !principal.permissions.canCreateAdmins) {
    res.status(403).json({ error: "apenas o CEO pode criar ou promover administradores" });
    return false;
  }
  return true;
}

/**
 * Carrega o usuário-alvo SE o caller puder gerenciá-lo; senão escreve 404/403 e
 * retorna null. CEO gerencia qualquer um; admin só gerencia contas `user` que
 * compartilham ao menos um bot do seu escopo (nunca outros admins/CEOs).
 */
async function loadManageableTarget(
  store: AdminUserStorePostgres,
  principal: Principal,
  targetId: string,
  res: express.Response
): Promise<{ id: string; role: AdminRole; isActive: boolean; botIds: string[] } | null> {
  const target = await store.getManageableUser(targetId);
  if (!target) {
    res.status(404).json({ error: "usuario nao encontrado" });
    return null;
  }
  if (principal.role !== "ceo") {
    const sharesBot = target.botIds.some((id) => principal.botIds.includes(id));
    if (target.role !== "user" || !sharesBot) {
      res.status(403).json({ error: "fora do escopo de gerenciamento" });
      return null;
    }
  }
  return target;
}

export function createUsersRouter(store: AdminUserStorePostgres): Router {
  const router = express.Router();

  // GET /api/admin/users — list users visible to the caller
  router.get("/", async (_req, res, next) => {
    const principal = getAdminPrincipal(res);
    if (!principal?.permissions.canManageUsers) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }
    try {
      const users = await store.listUsers(principal.role, principal.botIds);
      res.status(200).json({ users: users.map(toApiUser) });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/admin/users — create a user
  router.post("/", async (req, res, next) => {
    const principal = getAdminPrincipal(res);
    if (!principal?.permissions.canManageUsers) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "payload invalido" });
      return;
    }

    const input = parsed.data;

    // Apenas o CEO cria/atribui papéis ceo/admin (admin só cria `user`).
    if (!assertCanAssignRole(principal, input.role, res)) {
      return;
    }

    // Não-CEO só atribui bots do próprio escopo.
    if (principal.role !== "ceo") {
      const invalidBots = input.botIds.filter((id) => !principal.botIds.includes(id));
      if (invalidBots.length > 0) {
        res.status(403).json({ error: "bot fora do escopo do admin" });
        return;
      }
    }

    try {
      const user = await store.createUser({
        email: input.email,
        displayName: input.displayName,
        password: input.password,
        role: input.role,
        botIds: input.botIds,
        isActive: input.isActive,
      });
      res.status(201).json({ user: toApiUser(user) });
    } catch (error) {
      next(error);
    }
  });

  // PUT /api/admin/users/:id — update a user
  router.put("/:id", async (req, res, next) => {
    const principal = getAdminPrincipal(res);
    if (!principal?.permissions.canManageUsers) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    const targetId = typeof req.params.id === "string" ? req.params.id : "";
    if (!targetId) {
      res.status(400).json({ error: "id invalido" });
      return;
    }

    // Prevent editing yourself through this endpoint (security boundary).
    if (targetId === principal.id) {
      res.status(400).json({ error: "use as configuracoes de conta para editar seu proprio perfil" });
      return;
    }

    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "payload invalido" });
      return;
    }

    const input = parsed.data;

    // O alvo precisa estar no escopo de gerência do caller (admin não pode
    // tocar em CEOs/outros admins nem em contas fora dos seus bots).
    const target = await loadManageableTarget(store, principal, targetId, res);
    if (!target) {
      return;
    }

    // Se for alterar o papel, valida a atribuição (impede admin promover p/ admin/CEO).
    if (input.role !== undefined && !assertCanAssignRole(principal, input.role, res)) {
      return;
    }

    // Não-CEO só atribui bots do próprio escopo.
    if (principal.role !== "ceo" && input.botIds !== undefined) {
      const invalidBots = input.botIds.filter((id) => !principal.botIds.includes(id));
      if (invalidBots.length > 0) {
        res.status(403).json({ error: "bot fora do escopo do admin" });
        return;
      }
    }

    try {
      const user = await store.updateUser(targetId, {
        email: input.email,
        displayName: input.displayName,
        password: input.password || undefined,
        role: input.role,
        botIds: input.botIds,
        isActive: input.isActive,
      });

      if (!user) {
        res.status(404).json({ error: "usuario nao encontrado" });
        return;
      }

      res.status(200).json({ user: toApiUser(user) });
    } catch (error) {
      next(error);
    }
  });

  // DELETE /api/admin/users/:id — delete a user
  router.delete("/:id", async (req, res, next) => {
    const principal = getAdminPrincipal(res);
    if (!principal?.permissions.canManageUsers) {
      res.status(403).json({ error: "acesso negado" });
      return;
    }

    const targetId = typeof req.params.id === "string" ? req.params.id : "";
    if (!targetId) {
      res.status(400).json({ error: "id invalido" });
      return;
    }

    if (targetId === principal.id) {
      res.status(400).json({ error: "nao e possivel excluir sua propria conta" });
      return;
    }

    // O alvo precisa estar no escopo de gerência do caller.
    const target = await loadManageableTarget(store, principal, targetId, res);
    if (!target) {
      return;
    }

    try {
      const removed = await store.deleteUser(targetId);
      if (!removed) {
        res.status(404).json({ error: "usuario nao encontrado" });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
