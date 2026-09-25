import { z } from "zod";
import { requireStrongSecret } from "./lib/security.js";
import { parseS3ObjectStoreConfig } from "./storage/s3ObjectStoreConfig.js";

type Environment = Readonly<Record<string, string | undefined>>;

const positiveInteger = z.coerce.number().int().positive();
const nonnegativeInteger = z.coerce.number().int().nonnegative();

const rateLimits = {
  general: { windowMs: 15 * 60_000, max: 300 },
  chat: { windowMs: 15 * 60_000, max: 30 },
  chatCreate: { windowMs: 15 * 60_000, max: 60 },
  upload: { windowMs: 60 * 60_000, max: 50 },
  compliance: { windowMs: 15 * 60_000, max: 100 },
  invitationLookup: { windowMs: 15 * 60_000, max: 60 },
  invitationDecision: { windowMs: 15 * 60_000, max: 20 },
  invitationSend: { windowMs: 60 * 60_000, max: 30 },
  publicApprovalRead: { windowMs: 15 * 60_000, max: 60 },
  publicApprovalDecision: { windowMs: 15 * 60_000, max: 10 },
  tabularPrompt: { windowMs: 15 * 60_000, max: 30 },
  tabularRegenerate: { windowMs: 15 * 60_000, max: 20 },
  fileVersionRead: { windowMs: 15 * 60_000, max: 120 },
  providerCheck: { windowMs: 15 * 60_000, max: 10 },
} as const;

const SHUTDOWN_TIMEOUT_MS = 10_000;
const DEFAULT_FRONTEND_URL = "http://localhost:5173";
const DEFAULT_MAIL_FROM = "onboarding@resend.dev";

const rateLimitSchema = z.object({
  windowMs: positiveInteger,
  max: positiveInteger,
});

const runtimeBaseSchema = z.object({
  port: positiveInteger.max(65_535),
  trustProxy: z.union([z.literal(false), positiveInteger]),
  shutdownTimeoutMs: positiveInteger,
  rateLimits: z.object({
    general: rateLimitSchema,
    chat: rateLimitSchema,
    chatCreate: rateLimitSchema,
    upload: rateLimitSchema,
    compliance: rateLimitSchema,
    invitationLookup: rateLimitSchema,
    invitationDecision: rateLimitSchema,
    invitationSend: rateLimitSchema,
    publicApprovalRead: rateLimitSchema,
    publicApprovalDecision: rateLimitSchema,
    tabularPrompt: rateLimitSchema,
    tabularRegenerate: rateLimitSchema,
    fileVersionRead: rateLimitSchema,
    providerCheck: rateLimitSchema,
  }),
});

const runtimeSchema = z.discriminatedUnion("kind", [
  runtimeBaseSchema.extend({ kind: z.literal("development") }),
  runtimeBaseSchema.extend({ kind: z.literal("test") }),
  runtimeBaseSchema.extend({
    kind: z.literal("production"),
    trustProxy: z.union([z.literal(false), z.literal(1)]),
  }),
]);

const databaseSchema = z.object({
  url: z.string().trim().min(1),
  connectionTimeoutMs: positiveInteger,
  idleTimeoutMs: positiveInteger,
  queryTimeoutMs: positiveInteger,
  statementTimeoutMs: positiveInteger,
});

const googleAuthSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disabled") }),
  z.object({
    kind: z.literal("google"),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  }),
]);

const authSchema = z.object({
  baseUrl: z.string().url(),
  frontendUrl: z.string().url(),
  trustedOrigins: z.array(z.string().url()).min(1),
  shareInviteExpiryDays: positiveInteger,
  google: googleAuthSchema,
});

const secretsSchema = z.object({
  betterAuth: z.string().min(1),
  authOtp: z.string().min(1),
  downloadSigning: z.string().min(1),
});

const storageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disabled") }),
  z.object({
    kind: z.literal("local"),
    directory: z.string().min(1),
    publicApiUrl: z.string().url(),
  }),
  z.object({
    kind: z.literal("s3"),
    endpoint: z.string().url().optional(),
    publicEndpoint: z.string().url().optional(),
    region: z.string().min(1),
    forcePathStyle: z.boolean(),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    bucket: z.string().min(1),
    requestTimeoutMs: positiveInteger,
  }),
]);

const mailSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("console") }),
  z.object({
    kind: z.literal("resend"),
    apiKey: z.string().min(1),
    fromEmail: z.string().email(),
  }),
]);

const ragSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disabled") }),
  z.object({
    kind: z.literal("qdrant"),
    url: z.string().url(),
    apiKey: z.string().min(1).optional(),
    openaiApiKey: z.string().min(1),
  }),
]);

const workerSchema = z.object({
  concurrency: positiveInteger.max(32),
  pollIntervalMs: positiveInteger,
  leaseDurationMs: positiveInteger,
  shutdownTimeoutMs: positiveInteger,
  healthCheckUrl: z.string().url(),
  healthCheckIntervalMs: positiveInteger,
  healthCleanupIntervalMs: positiveInteger,
  healthRetentionDays: positiveInteger,
});

const providerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disabled") }),
  z.object({ kind: z.literal("configured"), apiKey: z.string().min(1) }),
]);

const appConfigSchema = z.object({
  runtime: runtimeSchema,
  database: databaseSchema,
  auth: authSchema,
  secrets: secretsSchema,
  storage: storageSchema,
  mail: mailSchema,
  rag: ragSchema,
  worker: workerSchema,
  conversion: z.object({
    libreOfficePath: z.string().trim().min(1),
    maxInputBytes: positiveInteger,
    maxOutputBytes: positiveInteger,
    timeoutMs: positiveInteger,
    concurrency: positiveInteger,
    maxQueuedPerAdapter: positiveInteger,
  }),
  ai: z.object({
    credentialEncryption: z.object({
      activeKeyId: z.string().min(1),
      keys: z.record(z.string().min(1), z.string().min(32)),
    }),
    openai: providerSchema,
  }),
});

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type AppConfig = DeepReadonly<z.infer<typeof appConfigSchema>>;
export type DatabaseConfig = AppConfig["database"];
let installedConfig: AppConfig | undefined;

export function installAppConfig(config: AppConfig): void {
  if (installedConfig && installedConfig !== config)
    throw new Error("AppConfig is already installed");
  installedConfig = config;
}

export function getAppConfig(): AppConfig {
  if (!installedConfig) throw new Error("AppConfig has not been installed");
  return installedConfig;
}

function parseOrigin(name: string, raw: string, kind: AppConfig["runtime"]["kind"]): string {
  if (raw === "*") throw new Error(`${name} must not contain a wildcard origin`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} contains an invalid origin: ${raw}`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} contains an invalid origin: ${raw}`);
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(kind === "development" && loopback)) {
    throw new Error(`${name} must use HTTPS except for loopback HTTP in development`);
  }
  return url.origin;
}

function parseServiceUrl(raw: string, kind: AppConfig["runtime"]["kind"], name: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" && !(kind === "development" && url.protocol === "http:")) {
    throw new Error(`${name} must use HTTPS except for HTTP endpoints in development`);
  }
  if (url.username || url.password) throw new Error(`${name} must not include credentials`);
  if (url.search || url.hash) throw new Error(`${name} must not include a query or fragment`);
  return url.toString().replace(/\/$/, "");
}

function parseCredentialKeys(environment: Environment): {
  activeKeyId: string;
  keys: Record<string, string>;
} {
  const activeKeyId = environment.AI_CREDENTIAL_ACTIVE_KEY_ID?.trim() || "v1";
  const raw = environment.AI_CREDENTIAL_ENCRYPTION_KEYS?.trim();
  if (!raw) {
    throw new Error("AI_CREDENTIAL_ENCRYPTION_KEYS is required");
  }
  const parsed: unknown = JSON.parse(raw);
  const entries = Object.entries(z.record(z.string().trim().min(1), z.string()).parse(parsed));
  const keys = Object.fromEntries(
    entries.map(([keyId, secret]) => [
      keyId,
      requireStrongSecret(`AI_CREDENTIAL_ENCRYPTION_KEYS.${keyId}`, secret),
    ]),
  );
  if (!keys[activeKeyId]) {
    throw new Error("AI_CREDENTIAL_ACTIVE_KEY_ID must identify a configured encryption key");
  }
  return { activeKeyId, keys };
}

function parseRag(
  environment: Environment,
  kind: AppConfig["runtime"]["kind"],
  openaiApiKey: string | undefined,
) {
  const url = environment.QDRANT_URL?.trim();
  if (!url || !openaiApiKey) return { kind: "disabled" as const };
  return {
    kind: "qdrant" as const,
    url: parseServiceUrl(url, kind, "QDRANT_URL"),
    apiKey: environment.QDRANT_API_KEY?.trim() || undefined,
    openaiApiKey,
  };
}

export function parseDatabaseConfig(environment: Environment): DatabaseConfig {
  return databaseSchema.parse({
    url: environment.DATABASE_URL,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 30_000,
    queryTimeoutMs: 10_000,
    statementTimeoutMs: 10_000,
  });
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value as DeepReadonly<T>;
}

export function parseAppConfig(environment: Environment): AppConfig {
  const environmentName = environment.NODE_ENV?.trim();
  if (
    environmentName &&
    environmentName !== "development" &&
    environmentName !== "test" &&
    environmentName !== "production"
  ) {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  const kind =
    environmentName === "production"
      ? "production"
      : environmentName === "test"
        ? "test"
        : "development";
  const trustProxyRaw = environment.TRUST_PROXY_HOPS?.trim();
  const trustProxy =
    !trustProxyRaw || trustProxyRaw === "0" ? false : nonnegativeInteger.parse(trustProxyRaw);
  if (kind === "production" && trustProxy !== false && trustProxy !== 1) {
    throw new Error("TRUST_PROXY_HOPS must be 0 or 1 in production");
  }

  const googleClientId = environment.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = environment.GOOGLE_CLIENT_SECRET?.trim();
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together");
  }
  const s3 = parseS3ObjectStoreConfig(environment, kind);
  const resendApiKey = environment.RESEND_API_KEY?.trim();
  const mail = resendApiKey
    ? {
        kind: "resend" as const,
        apiKey: resendApiKey,
        fromEmail: environment.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM,
      }
    : { kind: "console" as const };

  const secrets = {
    betterAuth: requireStrongSecret("BETTER_AUTH_SECRET", environment.BETTER_AUTH_SECRET),
    authOtp: requireStrongSecret("AUTH_OTP_SECRET", environment.AUTH_OTP_SECRET),
    downloadSigning: requireStrongSecret(
      "DOWNLOAD_SIGNING_SECRET",
      environment.DOWNLOAD_SIGNING_SECRET,
    ),
  };
  const credentialEncryption = parseCredentialKeys(environment);
  const secretValues = [...Object.values(secrets), ...Object.values(credentialEncryption.keys)];
  if (new Set(secretValues).size !== secretValues.length) {
    throw new Error("Authentication and encryption secrets must be pairwise distinct");
  }

  const port = positiveInteger.parse(environment.PORT?.trim() || 3001);
  const frontendUrlRaw = environment.FRONTEND_URL?.trim();
  if (!frontendUrlRaw && kind === "production") {
    throw new Error("FRONTEND_URL is required in production");
  }
  const frontendUrl = parseOrigin("FRONTEND_URL", frontendUrlRaw || DEFAULT_FRONTEND_URL, kind);
  const baseUrl = parseOrigin(
    "BETTER_AUTH_URL",
    environment.BETTER_AUTH_URL?.trim() ?? `http://localhost:${port}`,
    kind,
  );
  const storage = s3
    ? { kind: "s3" as const, ...s3 }
    : kind === "development"
      ? {
          kind: "local" as const,
          directory: environment.LOCAL_STORAGE_PATH?.trim() || "./data",
          publicApiUrl: baseUrl,
        }
      : { kind: "disabled" as const };
  const openaiApiKey = environment.OPENAI_API_KEY?.trim() || undefined;
  const healthCheckUrl = environment.HEALTHCHECK_API_URL?.trim();

  const parsed = appConfigSchema.parse({
    runtime: {
      kind,
      port,
      trustProxy,
      shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
      rateLimits,
    },
    database: parseDatabaseConfig(environment),
    auth: {
      baseUrl,
      frontendUrl,
      trustedOrigins: [frontendUrl],
      shareInviteExpiryDays: 7,
      google:
        googleClientId && googleClientSecret
          ? { kind: "google", clientId: googleClientId, clientSecret: googleClientSecret }
          : { kind: "disabled" },
    },
    secrets,
    storage,
    mail,
    rag: parseRag(environment, kind, openaiApiKey),
    worker: {
      concurrency: 4,
      pollIntervalMs: 1_000,
      leaseDurationMs: 60_000,
      shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
      healthCheckUrl: healthCheckUrl
        ? parseServiceUrl(healthCheckUrl, kind, "HEALTHCHECK_API_URL")
        : `${baseUrl}/health`,
      healthCheckIntervalMs: 6 * 60 * 60_000,
      healthCleanupIntervalMs: 7 * 24 * 60 * 60_000,
      healthRetentionDays: 120,
    },
    conversion: {
      libreOfficePath: "libreoffice",
      maxInputBytes: 50 * 1024 * 1024,
      maxOutputBytes: 100 * 1024 * 1024,
      timeoutMs: 60_000,
      concurrency: 2,
      maxQueuedPerAdapter: 32,
    },
    ai: {
      credentialEncryption,
      openai: openaiApiKey ? { kind: "configured", apiKey: openaiApiKey } : { kind: "disabled" },
    },
  });
  return deepFreeze(parsed);
}
