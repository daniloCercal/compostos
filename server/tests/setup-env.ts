process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:5173";
process.env.ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "s".repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || "http://localhost:5432/discord_admin";
process.env.PANEL_BASE_URL_ALLOWLIST =
  process.env.PANEL_BASE_URL_ALLOWLIST || "http://127.0.0.1:8080";
process.env.WEB_PANEL_SHARED_SECRET =
  process.env.WEB_PANEL_SHARED_SECRET || "panel-shared-secret";
