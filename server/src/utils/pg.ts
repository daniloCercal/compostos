import fs from "node:fs";

import type { PoolConfig } from "pg";

import { env } from "../config/env";

/**
 * Decide a configuração SSL do pool Postgres a partir da URL e do ambiente.
 *
 *  - host local (localhost / 127.0.0.1) → sem SSL.
 *  - DATABASE_CA_CERT definido          → valida a cadeia contra essa CA
 *                                          (rejectUnauthorized = true).
 *  - senão                              → rejectUnauthorized = DATABASE_SSL_STRICT
 *                                          (default false, preservando o legado).
 *
 * Centraliza a lógica que antes estava duplicada em cada store.
 */
export function buildPostgresSsl(databaseUrl: string): PoolConfig["ssl"] {
  let host = "";
  try {
    host = new URL(databaseUrl).hostname.trim().toLowerCase();
  } catch {
    host = "";
  }

  if (host === "localhost" || host === "127.0.0.1") {
    return undefined;
  }

  const ca = readCaCert();
  if (ca) {
    return { ca, rejectUnauthorized: true };
  }

  return { rejectUnauthorized: env.DATABASE_SSL_STRICT };
}

/** Lê a CA de DATABASE_CA_CERT — aceita PEM inline ou caminho de arquivo. */
function readCaCert(): string | undefined {
  const raw = env.DATABASE_CA_CERT;
  if (!raw) return undefined;
  if (raw.includes("BEGIN CERTIFICATE")) return raw;
  try {
    return fs.readFileSync(raw, "utf8");
  } catch {
    return undefined;
  }
}
