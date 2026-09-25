import type { S3ObjectStoreOptions } from "./s3ObjectStore.js";

type Environment = Readonly<Record<string, string | undefined>>;
type RuntimeKind = "development" | "test" | "production";

const S3_REQUEST_TIMEOUT_MS = 60_000;

function parseBoolean(raw: string | undefined): boolean {
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function parseEndpoint(raw: string, kind: RuntimeKind): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("OBJECT_STORE_ENDPOINT must be a valid URL");
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (
    url.protocol !== "https:" &&
    !(kind === "development" && url.protocol === "http:" && loopback)
  ) {
    throw new Error("OBJECT_STORE_ENDPOINT must use HTTPS except for loopback HTTP in development");
  }
  if (url.username || url.password) {
    throw new Error("OBJECT_STORE_ENDPOINT must not include credentials");
  }
  if (url.search || url.hash) {
    throw new Error("OBJECT_STORE_ENDPOINT must not include a query or fragment");
  }
  return url.toString().replace(/\/$/, "");
}

export function parseS3ObjectStoreConfig(
  environment: Environment,
  kind: RuntimeKind,
): S3ObjectStoreOptions | undefined {
  const endpoint = environment.OBJECT_STORE_ENDPOINT?.trim();
  const accessKeyId = environment.OBJECT_STORE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = environment.OBJECT_STORE_SECRET_ACCESS_KEY?.trim();
  const bucket = environment.OBJECT_STORE_BUCKET?.trim();
  if (!endpoint && !accessKeyId && !secretAccessKey && !bucket) return undefined;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "OBJECT_STORE_ENDPOINT, OBJECT_STORE_ACCESS_KEY_ID, OBJECT_STORE_SECRET_ACCESS_KEY, and OBJECT_STORE_BUCKET must be configured together",
    );
  }

  return {
    endpoint: parseEndpoint(endpoint, kind),
    region: environment.OBJECT_STORE_REGION?.trim() || "us-east-1",
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: parseBoolean(environment.OBJECT_STORE_FORCE_PATH_STYLE),
    requestTimeoutMs: S3_REQUEST_TIMEOUT_MS,
  };
}
