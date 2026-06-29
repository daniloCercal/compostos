import type { Pool } from "pg";

export type AuditCategory = "auth" | "users" | "bots" | "audit" | "other";

export interface AuditEntryInput {
  userId: string | null;
  userEmail: string | null;
  userRole: string | null;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
  /** Se omitido, é derivado do path por categorizePath(). */
  category?: AuditCategory;
}

export interface AuditEntry {
  id: string;
  occurredAt: string;
  category: string;
  userId: string | null;
  userEmail: string | null;
  userRole: string | null;
  method: string;
  path: string;
  statusCode: number | null;
  durationMs: number | null;
  ip: string | null;
  userAgent: string | null;
}

type AuditRow = {
  id: string;
  occurred_at: Date;
  category: string | null;
  user_id: string | null;
  user_email: string | null;
  user_role: string | null;
  method: string;
  path: string;
  status_code: number | null;
  duration_ms: number | null;
  ip: string | null;
  user_agent: string | null;
};

/** Deriva a categoria do log a partir do caminho da rota. */
export function categorizePath(path: string): AuditCategory {
  if (/\/(login|logout|session|csrf-token)(\/|$|\?)/.test(path)) return "auth";
  if (path.includes("/users")) return "users";
  if (path.includes("/audit")) return "audit";
  if (path.includes("/bots")) return "bots";
  return "other";
}

function mapRow(row: AuditRow): AuditEntry {
  return {
    id: String(row.id),
    occurredAt:
      row.occurred_at instanceof Date
        ? row.occurred_at.toISOString()
        : String(row.occurred_at),
    category: row.category ?? "other",
    userId: row.user_id,
    userEmail: row.user_email,
    userRole: row.user_role,
    method: row.method,
    path: row.path,
    statusCode: row.status_code,
    durationMs: row.duration_ms,
    ip: row.ip,
    userAgent: row.user_agent,
  };
}

/**
 * Persiste e consulta o log de auditoria de acesso aos endpoints admin.
 * Compartilha o pool do AdminUserStore (já com search_path=site).
 */
export class AuditStorePostgres {
  constructor(private readonly pool: Pool) {}

  /** Grava uma entrada (fire-and-forget pelo chamador). */
  async record(entry: AuditEntryInput): Promise<void> {
    const category = entry.category ?? categorizePath(entry.path);
    await this.pool.query(
      `
        INSERT INTO audit_log
          (user_id, user_email, user_role, method, path, status_code, duration_ms, ip, user_agent, category)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        entry.userId,
        entry.userEmail,
        entry.userRole,
        entry.method,
        entry.path,
        entry.statusCode,
        entry.durationMs,
        entry.ip,
        entry.userAgent,
        category,
      ]
    );
  }

  /** Lista entradas mais recentes com filtro opcional por categoria e busca. */
  async list(opts: {
    limit: number;
    offset: number;
    category?: string;
    q?: string;
  }): Promise<{ items: AuditEntry[]; total: number }> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit) || 50, 1), 200);
    const offset = Math.max(Math.trunc(opts.offset) || 0, 0);

    const where: string[] = [];
    const params: unknown[] = [];

    if (opts.category && opts.category !== "all") {
      params.push(opts.category);
      where.push(`category = $${params.length}`);
    }
    if (opts.q && opts.q.trim()) {
      params.push(`%${opts.q.trim()}%`);
      const i = params.length;
      where.push(
        `(path ILIKE $${i} OR user_email ILIKE $${i} OR method ILIKE $${i} OR ip ILIKE $${i})`
      );
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const [rows, count] = await Promise.all([
      this.pool.query<AuditRow>(
        `
          SELECT id, occurred_at, category, user_id, user_email, user_role,
                 method, path, status_code, duration_ms, ip, user_agent
          FROM audit_log
          ${whereClause}
          ORDER BY occurred_at DESC, id DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `,
        [...params, limit, offset]
      ),
      this.pool.query<{ n: string }>(
        `SELECT count(*)::bigint AS n FROM audit_log ${whereClause}`,
        params
      ),
    ]);

    return {
      items: rows.rows.map(mapRow),
      total: Number(count.rows[0]?.n ?? 0),
    };
  }

  /** Verificações por captcha (auth.daniloc.work) como entradas de log na
   *  categoria "authorization": link gerado, se foi autorizado, e o usuário Discord. */
  async listAuthorizations(opts: {
    limit: number;
    offset: number;
    q?: string;
  }): Promise<{ items: AuditEntry[]; total: number }> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit) || 50, 1), 200);
    const offset = Math.max(Math.trunc(opts.offset) || 0, 0);

    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.q && opts.q.trim()) {
      params.push(`%${opts.q.trim()}%`);
      const i = params.length;
      where.push(`(username ILIKE $${i} OR user_id ILIKE $${i} OR token ILIKE $${i})`);
    }
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [rows, count] = await Promise.all([
      this.pool.query<{
        token: string;
        user_id: string;
        username: string | null;
        status: string;
        created_at: Date;
        verified_at: Date | null;
        ip: string | null;
      }>(
        `SELECT token, user_id, username, status, created_at, verified_at, ip
         FROM captcha_verifications
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      this.pool.query<{ n: string }>(
        `SELECT count(*)::bigint AS n FROM captcha_verifications ${whereClause}`,
        params
      ),
    ]);

    const items: AuditEntry[] = rows.rows.map((r) => {
      const when = r.verified_at ?? r.created_at;
      return {
        id: r.token,
        occurredAt: when instanceof Date ? when.toISOString() : String(when),
        category: "authorization",
        userId: null,
        userEmail: r.username ? "@" + r.username : "id:" + r.user_id,
        userRole: null,
        method: "VERIFY",
        path: "/v/" + r.token,
        statusCode: r.status === "verified" ? 200 : r.status === "expired" ? 410 : 0,
        durationMs: null,
        ip: r.ip,
        userAgent: null,
      };
    });

    return { items, total: Number(count.rows[0]?.n ?? 0) };
  }
}
