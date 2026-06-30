const DISCORD_API = "https://discord.com/api/v10";

export class DiscordApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Discord API ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

// IDs do Discord são snowflakes (17–20 dígitos). Validar antes de interpolar no
// path evita travessia/injeção (ex.: "123%2F..%2Fendpoint") na REST do Discord.
const SNOWFLAKE_RE = /^\d{17,20}$/;

function assertSnowflake(id: string, label: string): void {
  if (!SNOWFLAKE_RE.test(id)) {
    throw new DiscordApiError(400, `${label} invalido`);
  }
}

async function discordFetch(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers as HeadersInit | undefined);
  headers.set("Authorization", `Bot ${token}`);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${DISCORD_API}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new DiscordApiError(res.status, body);
  }
  return res;
}

export interface DiscordGuildItem {
  id: string;
  name: string;
  icon: string | null;
  approximate_member_count?: number;
  owner?: boolean;
}

export async function fetchBotGuilds(token: string): Promise<DiscordGuildItem[]> {
  const res = await discordFetch(token, "/users/@me/guilds?with_counts=true");
  return res.json() as Promise<DiscordGuildItem[]>;
}

export interface DiscordBotUserRaw {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
}

export async function fetchBotUser(token: string): Promise<DiscordBotUserRaw> {
  const res = await discordFetch(token, "/users/@me");
  return res.json() as Promise<DiscordBotUserRaw>;
}

export interface DiscordUserRaw {
  id: string;
  username: string;
  global_name: string | null;
  discriminator: string;
  avatar: string | null;
}

/** Resolve um usuário do Discord pelo seu ID (snowflake) usando o token do bot. */
export async function fetchDiscordUser(token: string, userId: string): Promise<DiscordUserRaw> {
  assertSnowflake(userId, "userId");
  const res = await discordFetch(token, `/users/${userId}`);
  return res.json() as Promise<DiscordUserRaw>;
}

export async function patchBotUser(
  token: string,
  fields: { username?: string; avatar?: string | null }
): Promise<DiscordBotUserRaw> {
  const res = await discordFetch(token, "/users/@me", {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  return res.json() as Promise<DiscordBotUserRaw>;
}

export async function patchGuildNickname(
  token: string,
  guildId: string,
  nick: string
): Promise<void> {
  assertSnowflake(guildId, "guildId");
  await discordFetch(token, `/guilds/${guildId}/members/@me`, {
    method: "PATCH",
    body: JSON.stringify({ nick }),
  });
}

/** Cargos de um membro numa guild (via token de bot). [] se não for membro. */
export async function fetchGuildMemberRoles(
  token: string,
  guildId: string,
  userId: string
): Promise<string[]> {
  assertSnowflake(guildId, "guildId");
  assertSnowflake(userId, "userId");
  try {
    const res = await discordFetch(token, `/guilds/${guildId}/members/${userId}`);
    const member = (await res.json()) as { roles?: string[] };
    return Array.isArray(member.roles) ? member.roles : [];
  } catch (err) {
    if (err instanceof DiscordApiError && err.status === 404) {
      return [];
    }
    throw err;
  }
}

export function buildAvatarUrl(userId: string, avatarHash: string | null): string | null {
  if (!avatarHash) return null;
  const ext = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=256`;
}

export function buildGuildIconUrl(guildId: string, iconHash: string | null): string | null {
  if (!iconHash) return null;
  const ext = iconHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=64`;
}

export interface DiscordRoleRaw {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
}

export interface DiscordChannelRaw {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
}

export async function fetchGuildRoles(token: string, guildId: string): Promise<DiscordRoleRaw[]> {
  assertSnowflake(guildId, "guildId");
  const res = await discordFetch(token, `/guilds/${guildId}/roles`);
  return res.json() as Promise<DiscordRoleRaw[]>;
}

export async function fetchGuildChannels(token: string, guildId: string): Promise<DiscordChannelRaw[]> {
  assertSnowflake(guildId, "guildId");
  const res = await discordFetch(token, `/guilds/${guildId}/channels`);
  return res.json() as Promise<DiscordChannelRaw[]>;
}

export async function sendChannelMessage(
  token: string,
  channelId: string,
  content: string,
  allowedMentionRoles?: string[]
): Promise<void> {
  assertSnowflake(channelId, "channelId");
  await discordFetch(token, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      allowed_mentions: {
        parse: [],
        roles: allowedMentionRoles ?? [],
      },
    }),
  });
}

export async function createChannelPermissionOverwrite(
  token: string,
  channelId: string,
  targetId: string,
  allow: string,
  deny: string,
  type: 0 | 1
): Promise<void> {
  assertSnowflake(channelId, "channelId");
  assertSnowflake(targetId, "targetId");
  await discordFetch(token, `/channels/${channelId}/permissions/${targetId}`, {
    method: "PUT",
    body: JSON.stringify({ allow, deny, type }),
  });
}

export async function deleteDiscordChannel(token: string, channelId: string): Promise<void> {
  assertSnowflake(channelId, "channelId");
  await discordFetch(token, `/channels/${channelId}`, { method: "DELETE" });
}
