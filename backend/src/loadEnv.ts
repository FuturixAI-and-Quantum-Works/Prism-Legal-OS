import { randomBytes } from "node:crypto";
import { existsSync, linkSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function generatedSecrets(): string {
  const secret = () => randomBytes(32).toString("hex");
  return [
    `BETTER_AUTH_SECRET=${secret()}`,
    `AUTH_OTP_SECRET=${secret()}`,
    `DOWNLOAD_SIGNING_SECRET=${secret()}`,
    `AI_CREDENTIAL_ENCRYPTION_KEYS=${JSON.stringify({ v1: secret() })}`,
    "",
  ].join("\n");
}

function ensureSecretsFile(path: string): void {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(temporary, generatedSecrets(), { mode: 0o600, flag: "wx" });
  try {
    linkSync(temporary, path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  } finally {
    unlinkSync(temporary);
  }
}

loadDotenv({ path: resolve(backendRoot, "../.env") });
loadDotenv({ path: resolve(backendRoot, ".env"), override: true });

const secretsFile = process.env.PRISM_SECRETS_FILE?.trim();
if (secretsFile) {
  const path = resolve(backendRoot, secretsFile);
  ensureSecretsFile(path);
  loadDotenv({ path });
}
