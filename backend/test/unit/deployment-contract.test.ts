import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrationsDirectory } from "../../src/scripts/migrate.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const backendRoot = path.join(repositoryRoot, "backend");

const runtimeCommands = {
  hostSetup: "npm run build && node dist/scripts/setup.js",
  setup: "node dist/scripts/setup.js",
  web: "node dist/index.js",
  worker: "node dist/worker.js",
} as const;
const localSetupCommands = [
  "cp .env.example .env",
  "docker compose up -d",
  "npm ci",
  "docker compose up -d postgres qdrant",
  "cp backend/.env.example backend/.env",
  "npm run setup --workspace @prism/backend",
  "npm run dev",
] as const;
const automaticMigrationStatement =
  "The backend container runs migrations automatically before it starts the API.";
const stalePostgresInitializationClaim =
  /PostgreSQL initialization (?:directory|hook)|PostgreSQL volume applies the baseline|Compose service applies the (?:single )?Drizzle baseline/i;
const operatorProvidedRenderUrls = [
  "BETTER_AUTH_URL",
  "FRONTEND_URL",
  "VITE_API_BASE_URL",
] as const;

function readRepositoryFile(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

describe("production deployment contract", () => {
  it("keeps required manifests and migration assets in the final backend image", async () => {
    const dockerfile = await readRepositoryFile("backend/Dockerfile");
    const runtimeStage = dockerfile.slice(dockerfile.indexOf(" AS runtime"));

    expect(runtimeStage).toContain(
      "COPY --from=production-dependencies --chown=node:node /app/backend ./backend",
    );
    expect(runtimeStage).toContain(
      "COPY --from=build --chown=node:node /app/packages/protocol/package.json ./packages/protocol/package.json",
    );
    expect(runtimeStage).toContain("COPY --chown=node:node backend/drizzle ./backend/drizzle");
    expect(runtimeStage).not.toContain("/app/backend/src");
    expect(runtimeStage).not.toMatch(/\/app\/package(?:-lock)?\.json/);
  });

  it("builds host setup and keeps deployment commands on compiled entrypoints", async () => {
    const [manifestSource, renderBlueprint, composeConfig] = await Promise.all([
      readFile(path.join(backendRoot, "package.json"), "utf8"),
      readRepositoryFile("render.yaml"),
      readRepositoryFile("compose.yaml"),
    ]);
    const manifest = JSON.parse(manifestSource) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts.setup).toBe(runtimeCommands.hostSetup);
    expect(renderBlueprint).toContain(`dockerCommand: ${runtimeCommands.web}`);
    expect(renderBlueprint).toContain(`preDeployCommand: ${runtimeCommands.setup}`);
    expect(renderBlueprint).toContain(`dockerCommand: ${runtimeCommands.worker}`);
    expect(renderBlueprint).not.toMatch(/(?:dockerCommand|preDeployCommand): npm /);
    expect(renderBlueprint).not.toContain(".onrender.com");
    for (const key of operatorProvidedRenderUrls) {
      expect(renderBlueprint).toMatch(new RegExp(`- key: ${key}\\n\\s+sync: false`));
    }
    expect(composeConfig).toContain(
      `command: ["/bin/sh", "-c", "${runtimeCommands.setup} && exec ${runtimeCommands.web}"]`,
    );
    expect(composeConfig).not.toContain("network_mode:");
  });

  it("documents quick start and host setup order consistently", async () => {
    const [readme, deploymentGuide] = await Promise.all([
      readRepositoryFile("README.md"),
      readRepositoryFile("docs/deployment.md"),
    ]);

    let previousPosition = -1;
    for (const command of localSetupCommands) {
      const position = readme.indexOf(command);
      expect(position).toBeGreaterThan(previousPosition);
      previousPosition = position;
    }

    for (const document of [readme, deploymentGuide]) {
      expect(document).toContain(automaticMigrationStatement);
      expect(document).not.toMatch(stalePostgresInitializationClaim);
    }
  });

  it("resolves migrations from the canonical backend directory", () => {
    expect(migrationsDirectory).toBe(path.join(backendRoot, "drizzle"));
  });

  it("runs migrations through the production ORM dependency", async () => {
    const migrationRunner = await readRepositoryFile("backend/src/scripts/migrate.ts");

    expect(migrationRunner).toContain('from "drizzle-orm/node-postgres/migrator"');
    expect(migrationRunner).not.toContain("drizzle-kit");
  });
});
