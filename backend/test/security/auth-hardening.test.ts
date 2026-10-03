import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { requireStrongSecret } from "../../src/lib/security.js";
import { signDownload, verifyDownload } from "../../src/lib/downloadTokens.js";
import { installAppConfig, parseAppConfig } from "../../src/config.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const betterAuthSecret = "0123456789abcdef".repeat(4);
const otpSecret = "abcdef0123456789".repeat(4);
const aiCredentialKey = "fedcba9876543210".repeat(4);
const downloadSigningSecret = "89abcdef01234567".repeat(4);

test("startup security validation requires strong, pairwise-distinct secrets", () => {
  const environment = {
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://prism:secret@localhost:5432/prism",
    BETTER_AUTH_SECRET: betterAuthSecret,
    AUTH_OTP_SECRET: otpSecret,
    AI_CREDENTIAL_ACTIVE_KEY_ID: "v1",
    AI_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ v1: aiCredentialKey }),
    DOWNLOAD_SIGNING_SECRET: downloadSigningSecret,
  };

  assert.deepEqual(
    parseAppConfig({
      ...environment,
      BETTER_AUTH_SECRET: ` ${environment.BETTER_AUTH_SECRET} `,
    }).secrets,
    {
      betterAuth: betterAuthSecret,
      authOtp: otpSecret,
      downloadSigning: downloadSigningSecret,
    },
  );
  assert.throws(
    () =>
      parseAppConfig({
        ...environment,
        AUTH_OTP_SECRET: betterAuthSecret,
      }),
    /pairwise distinct/,
  );
  assert.throws(() => requireStrongSecret("BETTER_AUTH_SECRET", "short"), /BETTER_AUTH_SECRET/);
});

test("download signing uses only its dedicated secret", () => {
  installAppConfig(
    parseAppConfig({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://prism:secret@localhost:5432/prism",
      BETTER_AUTH_SECRET: betterAuthSecret,
      AUTH_OTP_SECRET: otpSecret,
      AI_CREDENTIAL_ACTIVE_KEY_ID: "v1",
      AI_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ v1: aiCredentialKey }),
      DOWNLOAD_SIGNING_SECRET: downloadSigningSecret,
    }),
  );
  const token = signDownload("object-key", "file.pdf");
  assert.deepEqual(verifyDownload(token), {
    path: "object-key",
    filename: "file.pdf",
  });
});

test("Better Auth owns cookies, OAuth state, OTP hashing, and database limits", async () => {
  const source = await readFile(resolve(testDirectory, "../../src/auth/auth.ts"), "utf8");

  assert.match(source, /betterAuth\(\{/);
  assert.match(source, /cookieCache:\s*\{\s*enabled:\s*false/s);
  assert.match(source, /httpOnly:\s*true/);
  assert.match(source, /useSecureCookies:\s*config\.runtime\.kind === "production"/);
  assert.match(source, /storeStateStrategy:\s*"database"/);
  assert.match(source, /encryptOAuthTokens:\s*true/);
  assert.match(source, /storage:\s*"database"/);
  assert.match(source, /createHmac\("sha256", config\.secrets\.authOtp\)/);
  assert.match(source, /trustedOrigins:\s*\[\.\.\.config\.auth\.trustedOrigins\]/);
  assert.doesNotMatch(source, /process\.env/);
});

test("identity schema and onboarding use the Better Auth profile split", async () => {
  const schema = await readFile(resolve(testDirectory, "../../src/db/schema/identity.ts"), "utf8");
  const [userRoutes, userRepository] = await Promise.all([
    readFile(resolve(testDirectory, "../../src/modules/users/users.routes.ts"), "utf8"),
    readFile(resolve(testDirectory, "../../src/modules/users/users.repository.ts"), "utf8"),
  ]);

  for (const table of ["users", "accounts", "sessions", "verifications", "rate_limits"]) {
    assert.match(schema, new RegExp(`pgTable\\(\\s*"${table}"`));
  }
  assert.doesNotMatch(schema, /pgTable\("auth_(?:accounts|sessions|otp)"/);
  assert.match(userRoutes, /router\.put\("\/onboarding", requireSession/);
  assert.match(userRepository, /\.onConflictDoUpdate\(/);
  assert.match(userRepository, /onboardingCompleted:\s*true/);
});

test("Better Auth mounts before JSON parsing and legacy auth routes are absent", async () => {
  const appSource = await readFile(resolve(testDirectory, "../../src/app.ts"), "utf8");
  const authMount = appSource.indexOf('app.all("/auth/*", dependencies.authHandler);');
  const jsonParser = appSource.indexOf('app.use(express.json({ limit: "50mb" }));');

  assert.notEqual(authMount, -1);
  assert.notEqual(jsonParser, -1);
  assert.ok(authMount < jsonParser);
  assert.doesNotMatch(appSource, /authRouter|\/auth\/me|\/auth\/logout/);
});

test("authentication has no bearer, query-token, local-storage, or JWT path", async () => {
  const middleware = await readFile(resolve(testDirectory, "../../src/middleware/auth.ts"), "utf8");
  const backendSources = await Promise.all(
    [
      "../../src/auth/auth.ts",
      "../../src/middleware/auth.ts",
      "../../src/index.ts",
      "../../src/modules/users/users.routes.ts",
    ].map((path) => readFile(resolve(testDirectory, path), "utf8")),
  );
  const source = backendSources.join("\n");

  assert.doesNotMatch(middleware, /authorization|Bearer/i);
  assert.doesNotMatch(source, /signJwt|verifyJwt|signSignupJwt|verifySignupJwt|tempToken/);
  assert.doesNotMatch(source, /req\.query\.(?:token|session)|localStorage|sessionStorage/);
});

test("authenticated backend routes use only the typed Better Auth context", async () => {
  const script = resolve(testDirectory, "../../../scripts/check-backend-auth-locals.mjs");
  const middleware = await readFile(resolve(testDirectory, "../../src/middleware/auth.ts"), "utf8");
  const { stdout } = await execFileAsync(process.execPath, [script]);
  const localsDeclaration = /interface Locals\s*\{(?<body>[^}]*)\}/.exec(middleware);

  assert.match(stdout, /No legacy auth-local references found/);
  assert.doesNotMatch(middleware, /applyLegacyLocals/);
  assert.ok(localsDeclaration?.groups);
  assert.equal(localsDeclaration.groups.body.trim(), "auth: AppAuthContext;");
});

test("dedicated secrets have no cross-purpose fallback", async () => {
  const aiCredentials = await readFile(
    resolve(testDirectory, "../../src/lib/llm/credentials.ts"),
    "utf8",
  );
  const downloadTokens = await readFile(
    resolve(testDirectory, "../../src/lib/downloadTokens.ts"),
    "utf8",
  );

  assert.doesNotMatch(aiCredentials, /BETTER_AUTH_SECRET|AUTH_OTP_SECRET/);
  assert.doesNotMatch(downloadTokens, /BETTER_AUTH_SECRET|AUTH_OTP_SECRET/);
});

test("Better Auth packages are pinned and legacy auth packages are removed", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(testDirectory, "../../package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };

  assert.equal(dependencies["better-auth"], "1.7.2");
  assert.equal(dependencies["@better-auth/drizzle-adapter"], "1.7.2");
  assert.equal(dependencies.jsonwebtoken, undefined);
  assert.equal(dependencies.bcryptjs, undefined);
  assert.equal(dependencies["@types/jsonwebtoken"], undefined);
  assert.equal(dependencies["@types/bcryptjs"], undefined);
});
