import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { createAuth } from "../../src/auth/auth.js";
import { parseAppConfig, parseDatabaseConfig } from "../../src/config.js";
import {
  documentMembers,
  documents,
  documentShares,
  projectMembers,
  projects,
  userProfiles,
  users,
} from "../../src/db/schema/index.js";
import { createDatabase } from "../../src/db/index.js";
import { AI_MODEL_CATALOG } from "../../src/lib/llm/models.js";
import { AccessAuthority } from "../../src/modules/access/access.authority.js";
import { DrizzleAccessRepository } from "../../src/modules/access/access.repository.js";
import {
  CORE_APPROVAL_ROLES,
  CORE_APPROVAL_RULES,
} from "../../src/scripts/seedApprovalPolicies.js";
import { SYSTEM_WORKFLOWS } from "../../src/scripts/seedWorkflows.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const backendRoot = path.join(repositoryRoot, "backend");
const adminUrl = process.env.PRISM_CI_POSTGRES_ADMIN_URL;

type SeedSnapshot = Readonly<Record<string, readonly unknown[]>>;

function requireAdminUrl(): URL {
  assert(adminUrl, "PRISM_CI_POSTGRES_ADMIN_URL is required");
  const parsed = new URL(adminUrl);
  assert(
    parsed.protocol === "postgres:" || parsed.protocol === "postgresql:",
    "PostgreSQL admin URL must use the postgres protocol",
  );
  assert(
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost",
    "PostgreSQL publication tests only create databases on loopback hosts",
  );
  assert.equal(
    parsed.pathname,
    "/postgres",
    "PostgreSQL admin URL must target the postgres database",
  );
  return parsed;
}

function runNpm(args: readonly string[], databaseUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NODE_ENV: "test",
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm ${args.join(" ")} failed with ${signal ?? `exit code ${code}`}`));
    });
  });
}

async function seedSnapshot(pool: Pool): Promise<SeedSnapshot> {
  const queries = {
    approvalRoles: `
      select to_jsonb(seed_row) - 'created_at' - 'updated_at' as value
      from approval_roles seed_row
      order by key
    `,
    approvalPolicies: `
      select to_jsonb(seed_row) - 'created_at' - 'updated_at' as value
      from approval_policies seed_row
      where key = 'core_document_review'
      order by key
    `,
    approvalRules: `
      select to_jsonb(seed_row) - 'created_at' - 'updated_at' as value
      from approval_policy_rules seed_row
      where key like 'core.%'
      order by key
    `,
    workflows: `
      select to_jsonb(seed_row) - 'created_at' - 'updated_at' as value
      from workflows seed_row
      where is_system = true
      order by stable_key
    `,
    aiModels: `
      select to_jsonb(seed_row) - 'created_at' - 'updated_at' as value
      from ai_provider_models seed_row
      where connection_id is null and owner_user_id is null
      order by id
    `,
  } as const;
  const snapshot: Record<string, readonly unknown[]> = {};
  for (const [name, query] of Object.entries(queries)) {
    snapshot[name] = (await pool.query<{ value: unknown }>(query)).rows.map(({ value }) => value);
  }
  return snapshot;
}

function authConfig(databaseUrl: string) {
  return parseAppConfig({
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_URL: "https://auth.example.test",
    FRONTEND_URL: "https://app.example.test",
    BETTER_AUTH_SECRET: "0123456789abcdef".repeat(4),
    AUTH_OTP_SECRET: "abcdef0123456789".repeat(4),
    AI_CREDENTIAL_ACTIVE_KEY_ID: "v1",
    AI_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
      v1: "fedcba9876543210".repeat(4),
    }),
    DOWNLOAD_SIGNING_SECRET: "89abcdef01234567".repeat(4),
  });
}

function authRequest(
  method: "GET" | "POST",
  pathname: string,
  body?: unknown,
  cookie?: string,
): Request {
  const headers = new Headers({ origin: "https://app.example.test" });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  return new Request(`https://auth.example.test/auth${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function verifyAuthLifecycle(databaseUrl: string): Promise<void> {
  const lifecycle = createDatabase(parseDatabaseConfig({ DATABASE_URL: databaseUrl }));
  const deliveries: Array<{ email: string; otp: string }> = [];
  try {
    const auth = createAuth(authConfig(databaseUrl), {
      database: lifecycle.database,
      async sendOtpEmail(email, otp) {
        deliveries.push({ email, otp });
        return { status: "sent", messageId: "ci-message", attempts: 1 };
      },
    });
    const email = "ci-auth@example.test";
    const sendResponse = await auth.handler(
      authRequest("POST", "/email-otp/send-verification-otp", { email, type: "sign-in" }),
    );
    assert.equal(sendResponse.status, 200);
    assert.equal(deliveries.length, 1);
    assert.match(deliveries[0].otp, /^\d{6}$/);

    const storedOtp = await lifecycle.pool.query<{ value: string }>(
      "select value from verifications where identifier like $1",
      [`%${email}%`],
    );
    assert.equal(storedOtp.rowCount, 1);
    assert(!storedOtp.rows[0].value.includes(deliveries[0].otp));
    const emailEvents = await lifecycle.pool.query<{ status: string }>(
      "select status from auth_email_events where recipient = $1",
      [email],
    );
    assert.deepEqual(emailEvents.rows, [{ status: "sent" }]);

    const rejectedResponse = await auth.handler(
      authRequest("POST", "/sign-in/email-otp", {
        email,
        otp: "000000",
        name: "CI User",
      }),
    );
    assert(rejectedResponse.status >= 400);
    assert.equal(
      Number((await lifecycle.pool.query("select count(*) from sessions")).rows[0].count),
      0,
    );

    const signInResponse = await auth.handler(
      authRequest("POST", "/sign-in/email-otp", {
        email,
        otp: deliveries[0].otp,
        name: "CI User",
      }),
    );
    assert.equal(signInResponse.status, 200);
    const cookieHeaders = signInResponse.headers.getSetCookie();
    assert(cookieHeaders.length > 0);
    const setCookie = cookieHeaders.join("\n");
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Secure/i);
    const cookie = cookieHeaders.map((value) => value.split(";", 1)[0]).join("; ");

    const sessionResponse = await auth.handler(
      authRequest("GET", "/get-session", undefined, cookie),
    );
    assert.equal(sessionResponse.status, 200);
    const sessionBody = (await sessionResponse.json()) as {
      session: { token: string };
      user: { email: string };
    };
    assert.equal(sessionBody.user.email, email);
    assert(sessionBody.session.token);
    assert.equal(
      Number((await lifecycle.pool.query("select count(*) from sessions")).rows[0].count),
      1,
    );
    assert.equal(
      Number((await lifecycle.pool.query("select count(*) from verifications")).rows[0].count),
      0,
    );

    const signOutResponse = await auth.handler(authRequest("POST", "/sign-out", undefined, cookie));
    assert.equal(signOutResponse.status, 200);
    assert.equal(
      Number((await lifecycle.pool.query("select count(*) from sessions")).rows[0].count),
      0,
    );
    const expiredSessionResponse = await auth.handler(
      authRequest("GET", "/get-session", undefined, cookie),
    );
    assert.equal(expiredSessionResponse.status, 200);
    assert.equal(await expiredSessionResponse.json(), null);
  } finally {
    await lifecycle.close();
  }
}

async function verifyAuthorization(databaseUrl: string): Promise<void> {
  const lifecycle = createDatabase(parseDatabaseConfig({ DATABASE_URL: databaseUrl }));
  const ownerId = "10000000-0000-4000-8000-000000000001";
  const editorId = "10000000-0000-4000-8000-000000000002";
  const reviewerId = "10000000-0000-4000-8000-000000000003";
  const viewerId = "10000000-0000-4000-8000-000000000004";
  const outsiderId = "10000000-0000-4000-8000-000000000005";
  const adminId = "10000000-0000-4000-8000-000000000006";
  const projectId = "10000000-0000-4000-8000-000000000011";
  const documentId = "10000000-0000-4000-8000-000000000012";
  const finalizedDocumentId = "10000000-0000-4000-8000-000000000013";
  try {
    await lifecycle.database.insert(users).values(
      [
        [ownerId, "owner@example.test"],
        [editorId, "editor@example.test"],
        [reviewerId, "reviewer@example.test"],
        [viewerId, "viewer@example.test"],
        [outsiderId, "outsider@example.test"],
        [adminId, "admin@example.test"],
      ].map(([id, email]) => ({
        id,
        email,
        fullName: email.split("@", 1)[0],
        emailVerified: true,
      })),
    );
    await lifecycle.database.insert(userProfiles).values({ userId: adminId, role: "admin" });
    await lifecycle.database.insert(projects).values({
      id: projectId,
      userId: ownerId,
      name: "CI authorization project",
    });
    await lifecycle.database.insert(projectMembers).values({
      projectId,
      userId: editorId,
      email: "editor@example.test",
      role: "editor",
    });
    await lifecycle.database.insert(documents).values([
      {
        id: documentId,
        projectId,
        userId: ownerId,
        filename: "authorization.docx",
      },
      {
        id: finalizedDocumentId,
        userId: ownerId,
        filename: "finalized.docx",
        lifecycleStatus: "FINALIZED",
      },
    ]);
    await lifecycle.database.insert(documentMembers).values({
      documentId,
      userId: reviewerId,
      email: "reviewer@example.test",
      role: "REVIEWER",
    });
    await lifecycle.database.insert(documentShares).values({
      documentId,
      userId: viewerId,
      email: "viewer@example.test",
      role: "viewer",
    });

    const authority = new AccessAuthority(new DrizzleAccessRepository(lifecycle.database));
    await assert.doesNotReject(async () => {
      assert.equal(
        (
          await authority.decide({
            actor: { userId: ownerId, email: "owner@example.test" },
            resource: { kind: "project", id: projectId },
            action: "manage",
          })
        ).allowed,
        true,
      );
      assert.equal(
        (
          await authority.decide({
            actor: { userId: editorId, email: "editor@example.test" },
            resource: { kind: "project", id: projectId },
            action: "write",
          })
        ).allowed,
        true,
      );
      assert.deepEqual(
        await authority.decide({
          actor: { userId: outsiderId, email: "outsider@example.test" },
          resource: { kind: "project", id: projectId },
          action: "read",
        }),
        { allowed: false, reason: "not-found" },
      );
      assert.equal(
        (
          await authority.decide({
            actor: { userId: reviewerId, email: "REVIEWER@example.test" },
            resource: { kind: "document", id: documentId },
            action: "prism_risk_scan",
          })
        ).allowed,
        true,
      );
      assert.deepEqual(
        await authority.decide({
          actor: { userId: viewerId, email: "VIEWER@example.test" },
          resource: { kind: "document", id: documentId },
          action: "update_document",
        }),
        { allowed: false, reason: "not-found" },
      );
      assert.deepEqual(
        await authority.decide({
          actor: { userId: ownerId, email: "owner@example.test" },
          resource: { kind: "document", id: finalizedDocumentId },
          action: "edit_document",
        }),
        { allowed: false, reason: "forbidden" },
      );
      assert.equal(
        (
          await authority.decide({
            actor: { userId: adminId, email: "admin@example.test" },
            resource: { kind: "project", id: projectId },
            action: "manage",
          })
        ).allowed,
        true,
      );
    });
  } finally {
    await lifecycle.close();
  }
}

test("PostgreSQL 16 publication contract", { timeout: 300_000 }, async () => {
  const parsedAdminUrl = requireAdminUrl();
  const databaseName = `prism_ci_${process.pid}_${randomBytes(5).toString("hex")}`;
  const databaseUrl = new URL(parsedAdminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  const adminPool = new Pool({ connectionString: parsedAdminUrl.toString() });
  let databaseCreated = false;
  try {
    const version = await adminPool.query<{ server_version_num: string }>(
      "select current_setting('server_version_num') as server_version_num",
    );
    assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10_000), 16);
    await adminPool.query(`create database "${databaseName}"`);
    databaseCreated = true;

    const migrationFiles = (await readdir(path.join(backendRoot, "drizzle")))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    assert.deepEqual(migrationFiles, ["0000_prism_baseline.sql"]);
    await runNpm(["run", "db:migrate", "--workspace", "@prism/backend"], databaseUrl.toString());
    await runNpm(["run", "db:migrate", "--workspace", "@prism/backend"], databaseUrl.toString());

    const pool = new Pool({ connectionString: databaseUrl.toString() });
    try {
      const migrationCount = await pool.query<{ count: number }>(
        "select count(*)::int as count from drizzle.__drizzle_migrations",
      );
      assert.equal(migrationCount.rows[0].count, 1);
      const tableCount = await pool.query<{ count: number }>(
        "select count(*)::int as count from information_schema.tables where table_schema = 'public'",
      );
      assert.equal(tableCount.rows[0].count, 73);

      await runNpm(["run", "seed:core", "--workspace", "@prism/backend"], databaseUrl.toString());
      const firstSeed = await seedSnapshot(pool);
      assert.equal(firstSeed.approvalRoles.length, CORE_APPROVAL_ROLES.length);
      assert.equal(firstSeed.approvalPolicies.length, 1);
      assert.equal(firstSeed.approvalRules.length, CORE_APPROVAL_RULES.length);
      assert.equal(firstSeed.workflows.length, SYSTEM_WORKFLOWS.length);
      assert.equal(firstSeed.aiModels.length, AI_MODEL_CATALOG.length);

      await runNpm(["run", "seed:core", "--workspace", "@prism/backend"], databaseUrl.toString());
      assert.deepEqual(await seedSnapshot(pool), firstSeed);
    } finally {
      await pool.end();
    }

    await verifyAuthLifecycle(databaseUrl.toString());
    await verifyAuthorization(databaseUrl.toString());
  } finally {
    try {
      assert.match(databaseName, /^prism_ci_[a-z0-9_]+$/);
      if (databaseCreated) {
        await adminPool.query(`drop database "${databaseName}" with (force)`);
      }
    } finally {
      await adminPool.end();
    }
  }
});
