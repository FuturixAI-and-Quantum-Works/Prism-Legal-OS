import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import {
  attachEndpointRateLimits,
  configureHttpPerimeter,
  createCookieOriginGuard,
  endpointRateLimitRules,
} from "../../src/app.js";
import { parseAppConfig } from "../../src/config.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const baseEnvironment = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://prism:secret@localhost:5432/prism",
  BETTER_AUTH_SECRET: "0123456789abcdef".repeat(4),
  AUTH_OTP_SECRET: "abcdef0123456789".repeat(4),
  AI_CREDENTIAL_ACTIVE_KEY_ID: "v1",
  AI_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
    v1: "fedcba9876543210".repeat(4),
  }),
  DOWNLOAD_SIGNING_SECRET: "89abcdef01234567".repeat(4),
} as const;

async function withServer(app: Express, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolveReady, reject) => {
    server.once("listening", resolveReady);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP test server");
    }
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolveClosed, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolveClosed();
      });
    });
  }
}

test("the frontend origin is normalized and validated as the only trusted origin", () => {
  const config = parseAppConfig({
    ...baseEnvironment,
    FRONTEND_URL: "https://app.example.com/",
  });

  assert.deepEqual(config.auth.trustedOrigins, ["https://app.example.com"]);
  assert.throws(
    () =>
      parseAppConfig({
        ...baseEnvironment,
        FRONTEND_URL: "*",
      }),
    /wildcard/,
  );
  assert.throws(
    () =>
      parseAppConfig({
        ...baseEnvironment,
        FRONTEND_URL: "https://app.example.com/path",
      }),
    /invalid origin/,
  );
  assert.throws(
    () => parseAppConfig({ ...baseEnvironment, NODE_ENV: "production" }),
    /required in production/,
  );
});

test("CORS allows configured origins with credential mode", async () => {
  const app = express();
  configureHttpPerimeter(
    app,
    parseAppConfig({
      ...baseEnvironment,
      FRONTEND_URL: "https://app.example.com",
    }),
  );
  app.get("/probe", (_req, res) => res.sendStatus(204));

  await withServer(app, async (baseUrl) => {
    const allowed = await fetch(`${baseUrl}/probe`, {
      headers: { Origin: "https://app.example.com" },
    });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.example.com");
    assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
    assert.equal(
      allowed.headers.get("access-control-expose-headers"),
      "X-Compliance-Run-Id, X-Tabular-Run-Id",
    );

    const denied = await fetch(`${baseUrl}/probe`, {
      headers: { Origin: "https://evil.example.com" },
    });
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  });
});

test("trust proxy defaults closed and rejects unsafe production values", () => {
  assert.equal(parseAppConfig(baseEnvironment).runtime.trustProxy, false);
  assert.equal(parseAppConfig({ ...baseEnvironment, TRUST_PROXY_HOPS: "2" }).runtime.trustProxy, 2);
  assert.throws(
    () => parseAppConfig({ ...baseEnvironment, TRUST_PROXY_HOPS: "true" }),
    /Invalid input/,
  );
  assert.throws(
    () =>
      parseAppConfig({
        ...baseEnvironment,
        NODE_ENV: "production",
        FRONTEND_URL: "https://app.example.com",
        BETTER_AUTH_URL: "https://api.example.com",
        TRUST_PROXY_HOPS: "2",
      }),
    /0 or 1 in production/,
  );
});

test("endpoint limiter registry covers sensitive perimeter routes", () => {
  const attached = new Set(
    endpointRateLimitRules.map((rule) => `${rule.method.toUpperCase()} ${rule.path}`),
  );
  const expected = [
    "GET /invitations/:token",
    "POST /invitations/:token/accept",
    "POST /projects",
    "PATCH /projects/:projectId",
    "POST /projects/:projectId/invitations",
    "POST /documents/:documentId/invitations",
    "POST /drive/workspaces/:workspaceId/invitations",
    "GET /approvals/public/:token",
    "POST /approvals/public/:token/decision",
    "POST /tabular-review/prompt",
    "POST /tabular-review/:reviewId/regenerate-cell",
    "GET /documents/:documentId/versions",
    "POST /documents/:documentId/versions",
    "GET /drive/files/:fileId/versions",
    "POST /drive/files/:fileId/versions",
    "POST /health/email/test",
    "POST /status/check",
  ];

  for (const endpoint of expected) {
    assert.ok(attached.has(endpoint), `missing limiter for ${endpoint}`);
  }
  assert.equal(attached.size, endpointRateLimitRules.length);
});

test("attached endpoint limiter blocks requests over its configured limit", async () => {
  const app = express();
  const { rateLimits } = parseAppConfig(baseEnvironment).runtime;
  attachEndpointRateLimits(app, {
    ...rateLimits,
    invitationDecision: { windowMs: 15 * 60_000, max: 1 },
  });
  app.use((_req, res) => res.sendStatus(204));

  await withServer(app, async (baseUrl) => {
    const first = await fetch(`${baseUrl}/invitations/token/accept`, {
      method: "POST",
    });
    const second = await fetch(`${baseUrl}/invitations/token/accept`, {
      method: "POST",
    });

    assert.equal(first.status, 204);
    assert.equal(second.status, 429);
  });
});

test("cookie-authenticated unsafe methods require an exact trusted origin", async () => {
  const app = express();
  app.use(createCookieOriginGuard(new Set(["https://app.example.com"])));
  app.post("/mutation", (_req, res) => res.sendStatus(204));

  await withServer(app, async (baseUrl) => {
    const cookie = "better-auth.session_token=session";
    const trusted = await fetch(`${baseUrl}/mutation`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://app.example.com" },
    });
    assert.equal(trusted.status, 204);

    const untrusted = await fetch(`${baseUrl}/mutation`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://evil.example.com" },
    });
    assert.equal(untrusted.status, 403);

    const missing = await fetch(`${baseUrl}/mutation`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(missing.status, 403);
  });
});

test("only the minimal health route remains public", async () => {
  const appSource = await readFile(resolve(testDirectory, "../../src/app.ts"), "utf8");
  const dependenciesSource = await readFile(
    resolve(testDirectory, "../../src/productionDependencies.ts"),
    "utf8",
  );

  assert.doesNotMatch(appSource, /app\.get\("\/health\/email"/);
  assert.match(appSource, /app\.get\("\/health"/);
  assert.match(
    dependenciesSource,
    /\{ path: "\/status", router: statusRouter, guard: middleware\.requireAuth \}/,
  );
});
