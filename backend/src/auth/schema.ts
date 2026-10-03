import { createAuth } from "./auth.js";
import { parseAppConfig } from "../config.js";
import { createDatabase } from "../db/index.js";

const config = parseAppConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/prism",
  BETTER_AUTH_URL: "https://localhost:3001",
  FRONTEND_URL: "https://localhost:5173",
  BETTER_AUTH_SECRET: "0123456789abcdef".repeat(4),
  AUTH_OTP_SECRET: "abcdef0123456789".repeat(4),
  AI_CREDENTIAL_ACTIVE_KEY_ID: "v1",
  AI_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
    v1: "fedcba9876543210".repeat(4),
  }),
  DOWNLOAD_SIGNING_SECRET: "89abcdef01234567".repeat(4),
});
const database = createDatabase(config.database);

export const auth = createAuth(config, {
  database: database.database,
  async sendOtpEmail() {
    return {
      status: "failed",
      failure: {
        kind: "permanent",
        retryMode: "never",
        message: "Schema generation does not send mail",
      },
      attempts: 1,
    };
  },
});
