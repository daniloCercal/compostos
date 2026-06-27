import type { Pool } from "pg";

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
}

export interface AuditEntry {
  id: string;
  occurredAt: string;
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

function mapRow(row: AuditRow): AuditEntry {
  return {
    id: String(row.id),
    occurredAt:
      row.occurred_at instanceof Date
        ? row.occurred_at.toISOString()
        : String(row.occurred_at),
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

  /** Grava uma entrada. Nunca deve lançar de forma que derrube a request — o
   *  chamador (middleware) faz fire-and-forget e captura erros. */
  async record(entry: AuditEntryInput): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO audit_log
          (user_id, user_email, user_role, method, path, status_code, duration_ms, ip, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      ]
    );
  }

  /** Lista as entradas mais recentes, paginadas. */
  async list(opts: {
    limit: number;
    offset: number;
  }): Promise<{ items: AuditEntry[]; total: number }> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit) || 50, 1), 200);
    const offset = Math.max(Math.trunc(opts.offset) || 0, 0);

    const [rows, count] = await Promise.all([
      this.pool.query<AuditRow>(
        `
          SELECT id, occurred_at, user_id, user_email, user_role,
                 method, path, status_code, duration_ms, ip, user_agent
          FROM audit_log
          ORDER BY occurred_at DESC, id DESC
          LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      ),
      this.pool.query<{ n: string }>(`SELECT count(*)::bigint AS n FROM audit_log`),
    ]);

    return {
      items: rows.rows.map(mapRow),
      total: Number(count.rows[0]?.n ?? 0),
    };
  }
}
