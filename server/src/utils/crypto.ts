import crypto from "node:crypto";

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function fromBase64Url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export function randomToken(size = 32): string {
  return crypto.randomBytes(size).toString("base64url");
}

// ---------------------------------------------------------------------------
// Encriptação de segredos em repouso (tokens de bot)
// ---------------------------------------------------------------------------

const SECRET_ENC_PREFIX = "enc:v1:";

function deriveKey(key: string): Buffer {
  // Normaliza qualquer string de chave para 32 bytes via SHA-256.
  return crypto.createHash("sha256").update(key).digest();
}

/**
 * Encripta um segredo com AES-256-GCM. Se `key` for vazio/ausente, retorna o
 * texto puro (funcionalidade desligada — compatível com o legado). O resultado
 * é auto-descritivo via prefixo, permitindo coexistência com valores legados.
 */
export function encryptSecret(plaintext: string, key?: string): string {
  if (!key || !plaintext) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return SECRET_ENC_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

/**
 * Desencripta um valor produzido por encryptSecret. Valores sem o prefixo são
 * tratados como texto puro legado e retornados inalterados (não quebra linhas
 * antigas). Sem `key`, valores encriptados são retornados como estão.
 */
export function decryptSecret(value: string, key?: string): string {
  if (!value.startsWith(SECRET_ENC_PREFIX)) return value;
  if (!key) return value;
  const raw = Buffer.from(value.slice(SECRET_ENC_PREFIX.length), "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(key), iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
}

/** tokenHash gera um hash determinístico (SHA-256 hex) para lookup pelo bot. */
export function tokenHash(token: string): string {
  if (!token) return "";
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeSignedToken(payload: unknown, secret: string): string {
  const payloadJson = JSON.stringify(payload);
  const payloadPart = toBase64Url(payloadJson);
  const signature = signPayload(payloadPart, secret);
  return `${payloadPart}.${signature}`;
}

export function decodeSignedToken<T>(token: string, secret: string): T | null {
  const pieces = token.split(".");
  if (pieces.length !== 2) {
    return null;
  }

  const [payloadPart, signature] = pieces;
  if (!payloadPart || !signature) {
    return null;
  }

  const expectedSignature = signPayload(payloadPart, secret);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payloadJson = fromBase64Url(payloadPart).toString("utf8");
    return JSON.parse(payloadJson) as T;
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  const [, saltPart, expectedPart] = parts;
  if (!saltPart || !expectedPart) {
    return false;
  }

  const salt = Buffer.from(saltPart, "base64url");
  const expected = Buffer.from(expectedPart, "base64url");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual.toString("base64url"), expected.toString("base64url"));
}
