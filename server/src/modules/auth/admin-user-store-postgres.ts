import { Pool } from "pg";
import { z } from "zod";

import { env } from "../../config/env";
import type { AdminPermissions, AdminPrincipal, AdminRole } from "../../types";
import { createId, utcIsoNow } from "../../utils/id";
import { hashPassword, verifyPassword } from "../../utils/crypto";
import { buildPostgresSsl } from "../../utils/pg";

// Hash descartável usado para equalizar o tempo de resposta do login quando o
// email não existe ou está inativo — evita oráculo de enumeração por timing.
const DUMMY_PASSWORD_HASH = hashPassword(createId());

type AdminUserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: AdminRole;
  is_active: boolean;
};

const roleSchema = z.enum(["ceo", "admin", "user"]);
const bootstrapUserSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(512),
  role: roleSchema,
  botIds: z.array(z.string().trim().uuid()).max(500).default([]),
  isActive: z.boolean().default(true),
});

const bootstrapUsersSchema = z.array(bootstrapUserSchema).max(200);

const CREATE_ADMIN_USERS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS admin_users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('ceo', 'admin', 'user')),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
  )
`;

// Migrate legacy role names from the pre-Lucia schema (owner→ceo, operator→admin, viewer→user).
// Safe to run repeatedly: the UPDATE is a no-op once values are already renamed.
const MIGRATE_ROLES_DDL = `
  UPDATE admin_users
  SET role = CASE role
    WHEN 'owner'    THEN 'ceo'
    WHEN 'operator' THEN 'admin'
    WHEN 'viewer'   THEN 'user'
  END
  WHERE role IN ('owner', 'operator', 'viewer')
`;

const DROP_LEGACY_ROLE_CONSTRAINT_DDL = `
  ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check
`;

const ADD_ROLE_CONSTRAINT_DDL = `
  ALTER TABLE admin_users
    ADD CONSTRAINT admin_users_role_check
    CHECK (role IN ('ceo', 'admin', 'user'))
`;

const CREATE_USER_SESSIONS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS user_sessions (
    id          text        PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    expires_at  timestamptz NOT NULL,
    csrf_token  text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
  )
`;

const CREATE_USER_SESSIONS_USER_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
  ON user_sessions (user_id)
`;

const CREATE_ADMIN_USER_ACCESS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS admin_user_bot_access (
    user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    bot_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, bot_id)
  )
`;

const CREATE_ADMIN_USERS_UPDATED_AT_FN_DDL = `
  CREATE OR REPLACE FUNCTION set_admin_users_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;
  END;
  $$
`;

const DROP_ADMIN_USERS_UPDATED_AT_TRIGGER_DDL = `
  DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON admin_users
`;

const CREATE_ADMIN_USERS_UPDATED_AT_TRIGGER_DDL = `
  CREATE TRIGGER trg_admin_users_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW
  EXECUTE FUNCTION set_admin_users_updated_at()
`;

const CREATE_ADMIN_USERS_EMAIL_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_admin_users_email
  ON admin_users (email)
`;

const CREATE_ADMIN_USER_ACCESS_USER_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_admin_user_bot_access_user_id
  ON admin_user_bot_access (user_id)
`;

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

function postgresErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" ? maybeCode : null;
}

function permissionsForRole(role: AdminRole): AdminPermissions {
  switch (role) {
    case "ceo":
      return {
        canViewBots: true,
        canCreateBots: true,
        canUpdateBots: true,
        canDeleteBots: true,
        canManageUsers: true,
        canCreateAdmins: true,
      };
    case "admin":
      return {
        canViewBots: true,
        canCreateBots: true,
        canUpdateBots: true,
        canDeleteBots: true,
        canManageUsers: true,
        canCreateAdmins: false,
      };
    case "user":
    default:
      return {
        canViewBots: true,
        canCreateBots: false,
        canUpdateBots: false,
        canDeleteBots: false,
        canManageUsers: false,
        canCreateAdmins: false,
      };
  }
}

function principalFromRow(row: AdminUserRow, botIds: string[]): AdminPrincipal {
  const normalizedBotIds = Array.from(new Set(botIds.map((botId) => botId.trim()).filter(Boolean)));
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    botIds: normalizedBotIds,
    scope: row.role === "ceo" ? "all" : "assigned",
    permissions: permissionsForRole(row.role),
  };
}

function parseBootstrapUsers(): z.infer<typeof bootstrapUsersSchema> {
  const raw = env.ADMIN_USERS_JSON?.trim();
  if (!raw) {
    return [];
  }

  const parsedJson = JSON.parse(raw) as unknown;
  return bootstrapUsersSchema.parse(parsedJson);
}

export function buildBootstrapUserSeed(user: z.infer<typeof bootstrapUserSchema>) {
  const email = normalizeEmail(user.email);
  const passwordHash = hashPassword(user.password);
  const role = roleSchema.parse(user.role);
  const displayName = user.displayName.trim();
  const botIds = Array.from(new Set(user.botIds.map((botId) => botId.trim()).filter(Boolean)));

  return {
    email,
    displayName,
    passwordHash,
    role,
    botIds,
    isActive: user.isActive,
  };
}

export class AdminUserStorePostgres {
  private readonly pool: Pool;
  private readyPromise: Promise<void> | null = null;

  /** Expose the pool so the Lucia adapter can share the same connection pool. */
  getPool(): Pool {
    return this.pool;
  }

  constructor(databaseUrl: string) {
    const normalized = databaseUrl.trim();
    if (!normalized) {
      throw new Error("DATABASE_URL invalido");
    }

    this.pool = new Pool({
      connectionString: normalized,
      ssl: buildPostgresSsl(normalized),
      options: "-c search_path=site",
    });
  }

  async authenticate(email: string, password: string): Promise<AdminPrincipal | null> {
    await this.ensureReady();

    const result = await this.pool.query<AdminUserRow>(
      `
        SELECT
          id,
          email,
          display_name,
          password_hash,
          role,
          is_active
        FROM admin_users
        WHERE email = $1
        LIMIT 1
      `,
      [normalizeEmail(email)]
    );

    const row = result.rows[0];
    // Sempre gasta o tempo de verificação (contra hash real ou descartável) para
    // que email inexistente/inativo e senha errada sejam indistinguíveis no tempo.
    const hash = row && row.is_active ? row.password_hash : DUMMY_PASSWORD_HASH;
    const passwordOk = verifyPassword(password, hash);
    if (!row || !row.is_active || !passwordOk) {
      return null;
    }

    const botIds = await this.listAccessibleBotIds(row.id);
    return principalFromRow(row, botIds);
  }

  async getPrincipalById(userId: string): Promise<AdminPrincipal | null> {
    await this.ensureReady();

    const result = await this.pool.query<AdminUserRow>(
      `
        SELECT
          id,
          email,
          display_name,
          password_hash,
          role,
          is_active
        FROM admin_users
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );

    const row = result.rows[0];
    if (!row || !row.is_active) {
      return null;
    }

    const botIds = await this.listAccessibleBotIds(row.id);
    return principalFromRow(row, botIds);
  }

  /**
   * Carrega papel/escopo de um usuário para decisões de autorização,
   * independentemente de estar ativo (ao contrário de getPrincipalById, que
   * filtra inativos) — necessário para permitir reativar/gerenciar contas.
   */
  async getManageableUser(
    userId: string
  ): Promise<{ id: string; role: AdminRole; isActive: boolean; botIds: string[] } | null> {
    await this.ensureReady();
    const result = await this.pool.query<{ id: string; role: AdminRole; is_active: boolean }>(
      `SELECT id, role, is_active FROM admin_users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) return null;
    const botIds = await this.listAccessibleBotIds(row.id);
    return { id: row.id, role: row.role, isActive: row.is_active, botIds };
  }

  async recordLogin(userId: string): Promise<void> {
    await this.ensureReady();
    await this.pool.query(
      `
        UPDATE admin_users
        SET last_login_at = $2
        WHERE id = $1
      `,
      [userId, utcIsoNow()]
    );
  }

  async listUsers(callerRole: AdminRole, callerBotIds: string[]): Promise<AdminPrincipal[]> {
    await this.ensureReady();

    let rows: AdminUserRow[];

    if (callerRole === "ceo") {
      const result = await this.pool.query<AdminUserRow>(
        `SELECT id, email, display_name, password_hash, role, is_active
         FROM admin_users ORDER BY created_at ASC`
      );
      rows = result.rows;
    } else {
      // Admin: list users who share at least one bot
      if (callerBotIds.length === 0) {
        return [];
      }
      const result = await this.pool.query<AdminUserRow>(
        `SELECT DISTINCT u.id, u.email, u.display_name, u.password_hash, u.role, u.is_active
         FROM admin_users u
         JOIN admin_user_bot_access a ON a.user_id = u.id
         WHERE a.bot_id = ANY($1::uuid[])
         ORDER BY u.id ASC`,
        [callerBotIds]
      );
      rows = result.rows;
    }

    const principals: AdminPrincipal[] = [];
    for (const row of rows) {
      const botIds = await this.listAccessibleBotIds(row.id);
      principals.push(principalFromRow(row, botIds));
    }
    return principals;
  }

  async createUser(input: {
    email: string;
    displayName: string;
    password: string;
    role: AdminRole;
    botIds: string[];
    isActive: boolean;
  }): Promise<AdminPrincipal> {
    await this.ensureReady();

    const email = normalizeEmail(input.email);
    const passwordHash = hashPassword(input.password);
    const id = createId();

    const result = await this.pool.query<AdminUserRow>(
      `INSERT INTO admin_users (id, email, display_name, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, display_name, password_hash, role, is_active`,
      [id, email, input.displayName.trim(), passwordHash, input.role, input.isActive]
    );
    const row = result.rows[0];
    if (!row) throw new Error("falha ao criar usuario");

    for (const botId of input.botIds) {
      await this.pool.query(
        `INSERT INTO admin_user_bot_access (user_id, bot_id) VALUES ($1, $2)
         ON CONFLICT (user_id, bot_id) DO NOTHING`,
        [id, botId]
      );
    }

    return principalFromRow(row, input.botIds);
  }

  async updateUser(
    userId: string,
    input: {
      email?: string;
      displayName?: string;
      password?: string;
      role?: AdminRole;
      botIds?: string[];
      isActive?: boolean;
    }
  ): Promise<AdminPrincipal | null> {
    await this.ensureReady();

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.email !== undefined) {
      updates.push(`email = $${idx++}`);
      values.push(normalizeEmail(input.email));
    }
    if (input.displayName !== undefined) {
      updates.push(`display_name = $${idx++}`);
      values.push(input.displayName.trim());
    }
    if (input.password !== undefined && input.password.trim()) {
      updates.push(`password_hash = $${idx++}`);
      values.push(hashPassword(input.password));
    }
    if (input.role !== undefined) {
      updates.push(`role = $${idx++}`);
      values.push(input.role);
    }
    if (input.isActive !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(input.isActive);
    }

    let row: AdminUserRow | undefined;

    if (updates.length > 0) {
      values.push(userId);
      const result = await this.pool.query<AdminUserRow>(
        `UPDATE admin_users SET ${updates.join(", ")} WHERE id = $${idx}
         RETURNING id, email, display_name, password_hash, role, is_active`,
        values
      );
      row = result.rows[0];
    } else {
      const result = await this.pool.query<AdminUserRow>(
        `SELECT id, email, display_name, password_hash, role, is_active
         FROM admin_users WHERE id = $1 LIMIT 1`,
        [userId]
      );
      row = result.rows[0];
    }

    if (!row) return null;

    if (input.botIds !== undefined) {
      await this.pool.query(
        `DELETE FROM admin_user_bot_access WHERE user_id = $1`,
        [userId]
      );
      for (const botId of input.botIds) {
        await this.pool.query(
          `INSERT INTO admin_user_bot_access (user_id, bot_id) VALUES ($1, $2)
           ON CONFLICT (user_id, bot_id) DO NOTHING`,
          [userId, botId]
        );
      }
    }

    const botIds = await this.listAccessibleBotIds(userId);
    return principalFromRow(row, botIds);
  }

  async deleteUser(userId: string): Promise<boolean> {
    await this.ensureReady();
    const result = await this.pool.query(
      `DELETE FROM admin_users WHERE id = $1`,
      [userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async listAccessibleBotIds(userId: string): Promise<string[]> {
    const result = await this.pool.query<{ bot_id: string }>(
      `
        SELECT bot_id
        FROM admin_user_bot_access
        WHERE user_id = $1
      `,
      [userId]
    );
    return result.rows.map((row) => row.bot_id);
  }

  private async ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.initialize();
    }
    await this.readyPromise;
  }

  private async initialize(): Promise<void> {
    await this.pool.query("SELECT 1");
    await this.runInitializationQuery(CREATE_ADMIN_USERS_TABLE_DDL);
    await this.runInitializationQuery(CREATE_ADMIN_USER_ACCESS_TABLE_DDL);
    await this.runInitializationQuery(CREATE_ADMIN_USERS_UPDATED_AT_FN_DDL);
    await this.runInitializationQuery(DROP_ADMIN_USERS_UPDATED_AT_TRIGGER_DDL);
    await this.runInitializationQuery(CREATE_ADMIN_USERS_UPDATED_AT_TRIGGER_DDL);
    await this.runInitializationQuery(CREATE_ADMIN_USERS_EMAIL_INDEX_DDL);
    await this.runInitializationQuery(CREATE_ADMIN_USER_ACCESS_USER_INDEX_DDL);
    // Migrate legacy role values and repair the check constraint.
    await this.runInitializationQuery(MIGRATE_ROLES_DDL);
    await this.runInitializationQuery(DROP_LEGACY_ROLE_CONSTRAINT_DDL);
    // Ignore 23514 (existing data violates constraint — should not happen after migration)
    // and 42710 (constraint already exists).
    await this.runInitializationQuery(ADD_ROLE_CONSTRAINT_DDL, ["42710"]);
    // Lucia session table.
    await this.runInitializationQuery(CREATE_USER_SESSIONS_TABLE_DDL);
    await this.runInitializationQuery(CREATE_USER_SESSIONS_USER_INDEX_DDL);
    await this.seedBootstrapUsers();
  }

  private async seedBootstrapUsers(): Promise<void> {
    const users = parseBootstrapUsers();
    for (const user of users) {
      const seed = buildBootstrapUserSeed(user);

      const upsertResult = await this.pool.query<{ id: string }>(
        `
          INSERT INTO admin_users (
            id,
            email,
            display_name,
            password_hash,
            role,
            is_active
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (email)
          DO UPDATE SET
            display_name = EXCLUDED.display_name,
            password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role,
            is_active = EXCLUDED.is_active
          RETURNING id
        `,
        [createId(), seed.email, seed.displayName, seed.passwordHash, seed.role, seed.isActive]
      );

      const userId = upsertResult.rows[0]?.id;
      if (!userId) {
        continue;
      }

      await this.pool.query(
        `
          DELETE FROM admin_user_bot_access
          WHERE user_id = $1
        `,
        [userId]
      );

      for (const botId of seed.botIds) {
        await this.pool.query(
          `
            INSERT INTO admin_user_bot_access (
              user_id,
              bot_id
            )
            VALUES ($1, $2)
            ON CONFLICT (user_id, bot_id) DO NOTHING
          `,
          [userId, botId]
        );
      }
    }
  }

  private async runInitializationQuery(query: string, ignoredCodes: string[] = []): Promise<void> {
    try {
      await this.pool.query(query);
    } catch (error) {
      const code = postgresErrorCode(error);
      if (code === "42501") {
        console.warn(
          "[admin-user-store] privilegio insuficiente ao aplicar DDL (42501) — schema pode estar incompleto"
        );
        return;
      }
      if (code && ignoredCodes.includes(code)) {
        return;
      }
      throw error;
    }
  }
}
