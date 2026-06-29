import fs from "node:fs";
import path from "node:path";

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { env, isProduction } from "./config/env";
import {
  createRequireAdminSession,
  createRequireAdminPrincipal,
} from "./middleware/auth";
import { requireCsrfToken } from "./middleware/csrf";
import { errorHandler } from "./middleware/error-handler";
import { createAuthRouter } from "./modules/auth/auth-router";
import { AdminUserStorePostgres } from "./modules/auth/admin-user-store-postgres";
import { createLucia } from "./modules/auth/lucia";
import { createUsersRouter } from "./modules/auth/users-router";
import { createBotAdminRouter } from "./modules/bot/bot-router";
import { createPostgresBotService } from "./modules/bot/bot-service";
import { createAuditMiddleware } from "./middleware/audit";
import { AuditStorePostgres } from "./modules/audit/audit-store-postgres";
import { createAuditRouter } from "./modules/audit/audit-router";
import { createVerificationRouter } from "./modules/verification/verification-router";
import { DiscordOauthStore } from "./modules/discord-oauth/discord-oauth-store";
import { createDiscordOauthAdminRouter } from "./modules/discord-oauth/discord-oauth-router";
import { createDiscordOauthFlowRouter } from "./modules/discord-oauth/discord-oauth-flow-router";

const app = express();
const botService = createPostgresBotService(env.DATABASE_URL);
const adminUserStore = new AdminUserStorePostgres(env.DATABASE_URL);
const lucia = createLucia(adminUserStore.getPool());
const auditStore = new AuditStorePostgres(adminUserStore.getPool());
const discordOauthStore = new DiscordOauthStore(adminUserStore.getPool());

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https:"],
          },
        }
      : false,
  })
);
app.use(
  cors({
    origin: env.APP_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token"],
  })
);
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());
app.use(morgan(isProduction ? "combined" : "dev"));

app.get(["/api/health", "/health"], (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "admin-panel-api",
    now: new Date().toISOString(),
  });
});

// Verificação por captcha — público (consumido por auth.daniloc.work via rewrite
// do Vercel, que mapeia /api/* -> api.daniloc.work/*). Sem sessão/CSRF.
app.use(["/api", "/"], createVerificationRouter(adminUserStore.getPool()));

const authRouter = createAuthRouter(adminUserStore, lucia, auditStore);

function createAdminProtectedRouter(): express.Router {
  const adminProtectedRouter = express.Router();
  adminProtectedRouter.use(createRequireAdminSession(lucia));
  adminProtectedRouter.use(createRequireAdminPrincipal(adminUserStore, lucia));
  // Auditoria: registra o acesso após autenticar, antes do CSRF — assim até as
  // mutações rejeitadas por CSRF (403) ficam no log.
  adminProtectedRouter.use(createAuditMiddleware(auditStore));
  adminProtectedRouter.use(requireCsrfToken);
  adminProtectedRouter.use("/bots", createBotAdminRouter(botService));
  adminProtectedRouter.use("/users", createUsersRouter(adminUserStore));
  adminProtectedRouter.use("/audit", createAuditRouter(auditStore));
  adminProtectedRouter.use("/discord-login", createDiscordOauthAdminRouter(discordOauthStore));
  return adminProtectedRouter;
}

// O rewrite do Vercel mapeia /api/admin → /admin; a MESMA instância de router
// atende os dois prefixos (evita montar a árvore de rotas duas vezes).
const adminProtectedRouter = createAdminProtectedRouter();
app.use(["/api/admin", "/admin"], authRouter);
app.use(
  ["/api/admin", "/admin"],
  createDiscordOauthFlowRouter(discordOauthStore, adminUserStore, lucia, botService)
);
app.use(["/api/admin", "/admin"], adminProtectedRouter);

if (isProduction) {
  const clientDistPath = path.resolve(__dirname, "..", "..", "client", "dist");
  const clientIndexPath = path.join(clientDistPath, "index.html");

  if (fs.existsSync(clientIndexPath)) {
    app.use(express.static(clientDistPath));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(clientIndexPath);
    });
  }
}

app.use((_req, res) => {
  res.status(404).json({ error: "rota nao encontrada" });
});

app.use(errorHandler);

export default app;
