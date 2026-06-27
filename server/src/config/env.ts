import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4010),
  APP_ORIGIN: z.string().trim().url().default("http://localhost:5173"),
  // Kept as optional for backward compatibility; no longer used for session signing (Lucia handles that).
  ADMIN_SESSION_SECRET: z.string().min(32).optional(),
  ADMIN_PORTAL_KEY: z.string().min(16, "ADMIN_PORTAL_KEY deve ter no minimo 16 caracteres").optional(),
  ADMIN_USERS_JSON: z.string().trim().optional(),
  SESSION_TTL_MINUTES: z.coerce.number().int().min(30).max(20160).default(10080),
  DATABASE_URL: z.string().trim().url("DATABASE_URL deve ser uma URL valida"),
  // Chave para encriptar tokens de bot em repouso (AES-256-GCM). Opcional: se
  // ausente, os tokens são gravados em texto puro (comportamento legado) e a
  // funcionalidade fica desligada — nada quebra. Defina para ativar.
  BOT_TOKEN_ENC_KEY: z.string().min(16, "BOT_TOKEN_ENC_KEY deve ter no minimo 16 caracteres").optional(),
  // TLS do Postgres. Por padrão (false) a verificação de certificado fica
  // desligada (compatível com o legado). Defina DATABASE_SSL_STRICT=true para
  // validar a cadeia — combine com DATABASE_CA_CERT (PEM inline ou caminho do
  // arquivo) quando o provedor usar uma CA própria (ex.: Supabase).
  DATABASE_SSL_STRICT: z.preprocess((value) => {
    if (value === undefined) return false;
    if (typeof value === "string") {
      return ["1", "true", "yes"].includes(value.trim().toLowerCase());
    }
    return value;
  }, z.boolean()),
  DATABASE_CA_CERT: z.string().trim().optional()
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Configuracao de ambiente invalida:\n${issues.join("\n")}`);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
