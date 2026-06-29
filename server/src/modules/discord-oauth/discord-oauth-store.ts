import type { Pool } from "pg";

import { encryptSecret, decryptSecret } from "../../utils/crypto";
import { env } from "../../config/env";

export interface DiscordOauthConfig {
  clientId: string;
  /** Nunca expõe o secret em claro; só indica se está configurado. */
  hasSecret: boolean;
  enabled: boolean;
}

export interface DiscordRoleMapping {
  id: string;
  guildId: string;
  roleId: string;
  roleName: string;
  panelRole: "admin" | "user";
}

type OauthRow = { client_id: string; client_secret: string; enabled: boolean };

/**
 * Config do "Entrar com Discord": credenciais OAuth da aplicação + mapa de
 * cargos do Discord -> papel no painel. Editável por admin/CEO sem login Discord.
 */
export class DiscordOauthStore {
  constructor(private readonly pool: Pool) {}

  async getConfig(): Promise<DiscordOauthConfig> {
    const r = await this.pool.query<OauthRow>(
      `SELECT client_id, client_secret, enabled FROM site.discord_oauth WHERE id = 1`
    );
    const row = r.rows[0];
    return {
      clientId: row?.client_id ?? "",
      hasSecret: Boolean(row?.client_secret),
      enabled: Boolean(row?.enabled),
    };
  }

  /** Uso interno do fluxo OAuth — retorna o secret em claro. */
  async getCredentials(): Promise<{
    clientId: string;
    clientSecret: string;
    enabled: boolean;
  }> {
    const r = await this.pool.query<OauthRow>(
      `SELECT client_id, client_secret, enabled FROM site.discord_oauth WHERE id = 1`
    );
    const row = r.rows[0];
    return {
      clientId: row?.client_id ?? "",
      clientSecret: row?.client_secret
        ? decryptSecret(row.client_secret, env.BOT_TOKEN_ENC_KEY)
        : "",
      enabled: Boolean(row?.enabled),
    };
  }

  async setConfig(input: {
    clientId?: string;
    clientSecret?: string;
    enabled?: boolean;
  }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.clientId !== undefined) {
      params.push(input.clientId.trim());
      sets.push(`client_id = $${params.length}`);
    }
    // Só atualiza o secret se vier um valor não-vazio (evita apagar ao salvar a config).
    if (input.clientSecret !== undefined && input.clientSecret.trim() !== "") {
      params.push(encryptSecret(input.clientSecret.trim(), env.BOT_TOKEN_ENC_KEY));
      sets.push(`client_secret = $${params.length}`);
    }
    if (input.enabled !== undefined) {
      params.push(input.enabled);
      sets.push(`enabled = $${params.length}`);
    }
    if (sets.length === 0) return;
    sets.push("updated_at = now()");
    await this.pool.query(
      `UPDATE site.discord_oauth SET ${sets.join(", ")} WHERE id = 1`,
      params
    );
  }

  async listMappings(): Promise<DiscordRoleMapping[]> {
    const r = await this.pool.query<{
      id: string;
      guild_id: string;
      role_id: string;
      role_name: string;
      panel_role: "admin" | "user";
    }>(
      `SELECT id, guild_id, role_id, role_name, panel_role
       FROM site.discord_role_map ORDER BY created_at ASC`
    );
    return r.rows.map((x) => ({
      id: String(x.id),
      guildId: x.guild_id,
      roleId: x.role_id,
      roleName: x.role_name,
      panelRole: x.panel_role,
    }));
  }

  async addMapping(input: {
    guildId: string;
    roleId: string;
    roleName: string;
    panelRole: "admin" | "user";
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO site.discord_role_map (guild_id, role_id, role_name, panel_role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id, role_id)
       DO UPDATE SET role_name = EXCLUDED.role_name, panel_role = EXCLUDED.panel_role`,
      [input.guildId, input.roleId, input.roleName, input.panelRole]
    );
  }

  async removeMapping(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM site.discord_role_map WHERE id = $1`, [id]);
  }
}
