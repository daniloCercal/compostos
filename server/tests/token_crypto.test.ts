import { encryptSecret, decryptSecret, tokenHash } from "../src/utils/crypto";

const KEY = "test-encryption-key-at-least-16-chars";

describe("token-at-rest crypto", () => {
  test("roundtrip: decrypt(encrypt(x)) === x", () => {
    const token = "ODc2NTQzMjE.discord.super-secret-bot-token";
    const enc = encryptSecret(token, KEY);
    expect(enc).not.toBe(token);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(enc, KEY)).toBe(token);
  });

  test("encryption is non-deterministic (random IV)", () => {
    const token = "same-token";
    expect(encryptSecret(token, KEY)).not.toBe(encryptSecret(token, KEY));
  });

  test("no key => passthrough (feature off, legacy behaviour)", () => {
    const token = "plain-token";
    expect(encryptSecret(token, undefined)).toBe(token);
    expect(decryptSecret(token, undefined)).toBe(token);
  });

  test("legacy plaintext values decrypt to themselves", () => {
    // valor sem prefixo enc:v1: é tratado como legado
    expect(decryptSecret("legacy-plaintext-token", KEY)).toBe("legacy-plaintext-token");
  });

  test("empty token stays empty", () => {
    expect(encryptSecret("", KEY)).toBe("");
  });

  test("tampered ciphertext fails authentication", () => {
    const enc = encryptSecret("secret", KEY);
    const tampered = enc.slice(0, -2) + (enc.endsWith("a") ? "b" : "a");
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  test("wrong key fails to decrypt", () => {
    const enc = encryptSecret("secret", KEY);
    expect(() => decryptSecret(enc, "another-key-at-least-16-chars-long")).toThrow();
  });

  test("tokenHash is deterministic and not the token", () => {
    const token = "abc123";
    expect(tokenHash(token)).toBe(tokenHash(token));
    expect(tokenHash(token)).not.toContain(token);
    expect(tokenHash(token)).toHaveLength(64); // sha256 hex
    expect(tokenHash("")).toBe("");
  });
});
