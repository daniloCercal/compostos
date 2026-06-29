import { Router } from "express";
import type { Pool } from "pg";

import { env } from "../../config/env";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Rotas PÚBLICAS de verificação por captcha (consumidas pela página estática em
 * auth.daniloc.work via rewrite do Vercel — mesma-origem, sem CORS/CSRF).
 *
 * Fluxo: o bot Go cria uma linha `site.captcha_verifications` (pending) e manda
 * o link `auth.daniloc.work/v/<token>` no DM. A página mostra o Turnstile; ao
 * passar, faz POST aqui. Validamos o captcha, marcamos `verified` e enfileiramos
 * um `bot_action` `verify_captcha` — o poller do bot dá o cargo.
 */
export function createVerificationRouter(pool: Pool): Router {
  const router = Router();

  router.post("/verify-submit", async (req, res, next) => {
    try {
      const body = req.body as { token?: unknown; cfToken?: unknown };
      const token = typeof body.token === "string" ? body.token.trim() : "";
      const cfToken = typeof body.cfToken === "string" ? body.cfToken : "";
      if (!token || !cfToken) {
        res.status(400).json({ error: "dados incompletos" });
        return;
      }

      const forwarded = req.headers["x-forwarded-for"];
      const ip =
        (Array.isArray(forwarded) ? forwarded[0] : forwarded)
          ?.toString()
          .split(",")[0]
          ?.trim() ||
        req.ip ||
        null;

      // 1. Valida o Turnstile no servidor.
      const secret = env.TURNSTILE_SECRET;
      if (!secret) {
        res.status(503).json({ error: "verificacao nao configurada" });
        return;
      }
      const form = new URLSearchParams();
      form.set("secret", secret);
      form.set("response", cfToken);
      if (ip) form.set("remoteip", ip);
      const turnstileRes = await fetch(TURNSTILE_VERIFY_URL, {
        method: "POST",
        body: form,
      });
      const outcome = (await turnstileRes.json()) as { success?: boolean };
      if (!outcome.success) {
        res.status(400).json({ error: "captcha invalido" });
        return;
      }

      // 2. Marca verificado (apenas se pending e não expirado) e enfileira a ação.
      const upd = await pool.query<{ guild_id: string; user_id: string }>(
        `UPDATE site.captcha_verifications
           SET status = 'verified', verified_at = now(), ip = $2
         WHERE token = $1 AND status = 'pending' AND expires_at > now()
         RETURNING guild_id, user_id`,
        [token, ip]
      );
      const row = upd.rows[0];
      if (!row) {
        res.status(400).json({ error: "token invalido ou expirado" });
        return;
      }
      await pool.query(
        `INSERT INTO site.bot_actions (guild_id, action_type, payload)
         VALUES ($1, 'verify_captcha', $2::jsonb)`,
        [row.guild_id, JSON.stringify({ user_id: row.user_id, token })]
      );

      res.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
