import { Lucia } from "lucia";
import { TimeSpan } from "oslo";
import type { Pool } from "pg";
import type { Adapter, DatabaseSession, DatabaseUser } from "lucia";

import { isProduction, env } from "../../config/env";
import type { AdminRole } from "../../types";

// ---------------------------------------------------------------------------
// Module augmentation — tells Lucia what attributes live on users / sessions
// ---------------------------------------------------------------------------
declare module "lucia" {
  interface Register {
    Lucia: AppLucia;
    DatabaseUserAttributes: {
      email: string;
      display_name: string;
      role: AdminRole;
      is_active: boolean;
    };
    DatabaseSessionAttributes: {
      csrf_token: string;
    };
  }
}

// ---------------------------------------------------------------------------
// Row shapes returned by SQL
// ---------------------------------------------------------------------------
type SessionJoinRow = {
  session_id: string;
  user_id: string;
  expires_at: Date;
  csrf_token: string;
  email: string;
  display_name: string;
  role: AdminRole;
  is_active: boolean;
};

type SessionRow = {
  id: string;
  user_id: string;
  expires_at: Date;
  csrf_token: string;
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
class PostgresLuciaAdapter implements Adapter {
  constructor(private readonly pool: Pool) {}

  async getSessionAndUser(
    sessionId: string
  ): Promise<[DatabaseSession | null, DatabaseUser | null]> {
    const result = await this.pool.query<SessionJoinRow>(
      `SELECT
         s.id          AS session_id,
         s.user_id,
         s.expires_at,
         s.csrf_token,
         u.email,
         u.display_name,
         u.role,
         u.is_active
       FROM user_sessions s
       JOIN admin_users u ON u.id = s.user_id
       WHERE s.id = $1
       LIMIT 1`,
      [sessionId]
    );

    const row = result.rows[0];
    if (!row) return [null, null];

    return [
      {
        id: row.session_id,
        userId: row.user_id,
        expiresAt: new Date(row.expires_at),
        attributes: { csrf_token: row.csrf_token },
      },
      {
        id: row.user_id,
        attributes: {
          email: row.email,
          display_name: row.display_name,
          role: row.role,
          is_active: row.is_active,
        },
      },
    ];
  }

  async getUserSessions(userId: string): Promise<DatabaseSession[]> {
    const result = await this.pool.query<SessionRow>(
      `SELECT id, user_id, expires_at, csrf_token
       FROM user_sessions
       WHERE user_id = $1`,
      [userId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      expiresAt: new Date(row.expires_at),
      attributes: { csrf_token: row.csrf_token },
    }));
  }

  async setSession(session: DatabaseSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_sessions (id, user_id, expires_at, csrf_token)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [
        session.id,
        session.userId,
        session.expiresAt,
        session.attributes.csrf_token,
      ]
    );
  }

  async updateSessionExpiration(
    sessionId: string,
    expiresAt: Date
  ): Promise<void> {
    await this.pool.query(
      `UPDATE user_sessions SET expires_at = $2 WHERE id = $1`,
      [sessionId, expiresAt]
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.pool.query(`DELETE FROM user_sessions WHERE id = $1`, [
      sessionId,
    ]);
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [
      userId,
    ]);
  }

  async deleteExpiredSessions(): Promise<void> {
    await this.pool.query(`DELETE FROM user_sessions WHERE expires_at < now()`);
  }
}

// ---------------------------------------------------------------------------
// Factory — call once per process, keep the returned instance as a singleton
// ---------------------------------------------------------------------------
export function createLucia(pool: Pool) {
  const adapter = new PostgresLuciaAdapter(pool);

  return new Lucia(adapter, {
    sessionExpiresIn: new TimeSpan(env.SESSION_TTL_MINUTES, "m"),
    sessionCookie: {
      name: "admin_session",
      attributes: {
        secure: isProduction,
        sameSite: "lax",
        path: "/",
      },
    },
    getSessionAttributes: (attrs) => ({
      csrfToken: attrs.csrf_token,
    }),
    getUserAttributes: (attrs) => ({
      email: attrs.email,
      displayName: attrs.display_name,
      role: attrs.role,
      isActive: attrs.is_active,
    }),
  });
}

export type AppLucia = ReturnType<typeof createLucia>;
