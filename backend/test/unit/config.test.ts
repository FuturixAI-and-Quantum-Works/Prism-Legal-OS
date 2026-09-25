import { describe, expect, it } from "vitest";
import { parseAppConfig } from "../../src/config.js";

const aiCredentialKey = "fedcba9876543210".repeat(4);
const validProductionEnvironment = {
  NODE_ENV: "production",
  PORT: "3001",
  DATABASE_URL: "postgresql://prism:secret@database.example.com:5432/prism",
  FRONTEND_URL: "https://app.example.com",
  BETTER_AUTH_URL: "https://api.example.com",
  BETTER_AUTH_SECRET: "0123456789abcdef".repeat(4),
  AUTH_OTP_SECRET: "abcdef0123456789".repeat(4),
  AI_CREDENTIAL_ACTIVE_KEY_ID: "v1",
  AI_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ v1: aiCredentialKey }),
  DOWNLOAD_SIGNING_SECRET: "89abcdef01234567".repeat(4),
} as const;

describe("parseAppConfig", () => {
  it("returns one deeply immutable domain object", () => {
    const config = parseAppConfig(validProductionEnvironment);

    expect(config.runtime.kind).toBe("production");
    expect(config.auth.trustedOrigins).toEqual(["https://app.example.com"]);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.runtime)).toBe(true);
    expect(Object.isFrozen(config.runtime.rateLimits)).toBe(true);
    expect(Object.isFrozen(config.auth.trustedOrigins)).toBe(true);
    expect(config.worker.healthCheckUrl).toBe("https://api.example.com/health");
    expect(config.ai).toEqual({
      credentialEncryption: { activeKeyId: "v1", keys: { v1: aiCredentialKey } },
      openai: { kind: "disabled" },
    });
    expect(config.mail).toEqual({ kind: "console" });
    expect(config.rag).toEqual({ kind: "disabled" });
    expect(config.storage).toEqual({ kind: "disabled" });
  });

  it.each([
    [{ NODE_ENV: "prod" }, /NODE_ENV must be development, test, or production/],
    [{ FRONTEND_URL: undefined }, /required in production/],
    [{ TRUST_PROXY_HOPS: "2" }, /0 or 1 in production/],
    [{ BETTER_AUTH_URL: "http://api.example.com" }, /must use HTTPS/],
    [{ BETTER_AUTH_URL: "https://api.example.com/auth" }, /invalid origin/],
    [{ QDRANT_URL: "http://qdrant.example.com", OPENAI_API_KEY: "openai-key" }, /must use HTTPS/],
    [
      { QDRANT_URL: "https://qdrant.example.com?token=secret", OPENAI_API_KEY: "openai-key" },
      /query or fragment/,
    ],
    [
      { QDRANT_URL: "https://user:pass@qdrant.example.com", OPENAI_API_KEY: "openai-key" },
      /must not include credentials/,
    ],
    [{ HEALTHCHECK_API_URL: "http://api.example.com/health" }, /must use HTTPS/],
    [
      {
        OBJECT_STORE_ENDPOINT: "http://storage.example.com",
        OBJECT_STORE_ACCESS_KEY_ID: "key",
        OBJECT_STORE_SECRET_ACCESS_KEY: "secret",
        OBJECT_STORE_BUCKET: "prism",
      },
      /must use HTTPS/,
    ],
    [{ GOOGLE_CLIENT_ID: "client" }, /configured together/],
    [{ OBJECT_STORE_ACCESS_KEY_ID: "key" }, /must be configured together/],
  ])("rejects unsafe production configuration %#", (overrides, expected) => {
    expect(() => parseAppConfig({ ...validProductionEnvironment, ...overrides })).toThrow(expected);
  });

  it("matches the Compose development wiring", () => {
    const config = parseAppConfig({
      ...validProductionEnvironment,
      NODE_ENV: "development",
      FRONTEND_URL: "http://localhost:8080",
      BETTER_AUTH_URL: "http://localhost:8003",
      LOCAL_STORAGE_PATH: "/app/data",
      QDRANT_URL: "http://qdrant:6333/",
      OPENAI_API_KEY: "openai-key",
      RESEND_API_KEY: "re_test",
      HEALTHCHECK_API_URL: "http://backend:8003/health",
    });

    expect(config.auth.trustedOrigins).toEqual(["http://localhost:8080"]);
    expect(config.storage).toEqual({
      kind: "local",
      directory: "/app/data",
      publicApiUrl: "http://localhost:8003",
    });
    expect(config.rag).toEqual({
      kind: "qdrant",
      url: "http://qdrant:6333",
      apiKey: undefined,
      openaiApiKey: "openai-key",
    });
    expect(config.mail).toEqual({
      kind: "resend",
      apiKey: "re_test",
      fromEmail: "onboarding@resend.dev",
    });
    expect(config.ai.openai).toEqual({ kind: "configured", apiKey: "openai-key" });
    expect(config.worker.healthCheckUrl).toBe("http://backend:8003/health");
  });

  it("defaults the development frontend origin", () => {
    const config = parseAppConfig({
      ...validProductionEnvironment,
      NODE_ENV: "development",
      FRONTEND_URL: undefined,
      BETTER_AUTH_URL: "http://localhost:3001",
    });

    expect(config.auth.frontendUrl).toBe("http://localhost:5173");
    expect(config.auth.trustedOrigins).toEqual(["http://localhost:5173"]);
  });

  it("enables RAG only when both QDRANT_URL and OPENAI_API_KEY are set", () => {
    expect(
      parseAppConfig({ ...validProductionEnvironment, QDRANT_URL: "https://qdrant.example.com" })
        .rag,
    ).toEqual({ kind: "disabled" });
    expect(
      parseAppConfig({
        ...validProductionEnvironment,
        QDRANT_URL: "https://qdrant.example.com",
        QDRANT_API_KEY: "qdrant-key",
        OPENAI_API_KEY: "openai-key",
      }).rag,
    ).toEqual({
      kind: "qdrant",
      url: "https://qdrant.example.com",
      apiKey: "qdrant-key",
      openaiApiKey: "openai-key",
    });
  });

  it("uses the configured Resend sender", () => {
    expect(
      parseAppConfig({
        ...validProductionEnvironment,
        MAIL_FROM: "mail@example.com",
        RESEND_API_KEY: "re_test",
      }).mail,
    ).toEqual({ kind: "resend", apiKey: "re_test", fromEmail: "mail@example.com" });
    expect(() =>
      parseAppConfig({
        ...validProductionEnvironment,
        MAIL_FROM: "not-an-email",
        RESEND_API_KEY: "re_test",
      }),
    ).toThrow(/email/i);
  });

  it("keeps storage disabled by default outside development", () => {
    const config = parseAppConfig({
      ...validProductionEnvironment,
      NODE_ENV: "test",
    });

    expect(config.storage).toEqual({ kind: "disabled" });
  });

  it("parses a versioned AI credential keyring for rotation", () => {
    const config = parseAppConfig({
      ...validProductionEnvironment,
      AI_CREDENTIAL_ACTIVE_KEY_ID: "v2",
      AI_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        v1: "0123456789abcdefghijklmnoPQRSTUV",
        v2: "ZYXWVUTsrqponmlkjihgfedcba987654",
      }),
    });

    expect(config.ai.credentialEncryption).toEqual({
      activeKeyId: "v2",
      keys: {
        v1: "0123456789abcdefghijklmnoPQRSTUV",
        v2: "ZYXWVUTsrqponmlkjihgfedcba987654",
      },
    });
  });

  it("requires the AI credential keyring without a legacy fallback", () => {
    expect(() =>
      parseAppConfig({
        ...validProductionEnvironment,
        AI_CREDENTIAL_ENCRYPTION_KEYS: undefined,
      }),
    ).toThrow(/AI_CREDENTIAL_ENCRYPTION_KEYS is required/);
  });

  it("parses provider-neutral S3 configuration", () => {
    const config = parseAppConfig({
      ...validProductionEnvironment,
      OBJECT_STORE_ENDPOINT: "https://objects.example.com",
      OBJECT_STORE_REGION: "eu-west-1",
      OBJECT_STORE_BUCKET: "prism-documents",
      OBJECT_STORE_ACCESS_KEY_ID: "access",
      OBJECT_STORE_SECRET_ACCESS_KEY: "secret",
      OBJECT_STORE_FORCE_PATH_STYLE: "false",
    });

    expect(config.storage).toEqual({
      kind: "s3",
      endpoint: "https://objects.example.com",
      region: "eu-west-1",
      bucket: "prism-documents",
      accessKeyId: "access",
      secretAccessKey: "secret",
      forcePathStyle: false,
      requestTimeoutMs: 60_000,
    });
  });
});
