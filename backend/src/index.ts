import "./loadEnv.js";
import { createApplication } from "./app.js";
import { installAppConfig, parseAppConfig } from "./config.js";
import { bindDatabase, createDatabase } from "./db/index.js";
import { createHttpDrain } from "./httpLifecycle.js";
import { installQueueRepository, PostgresQueueRepository } from "./jobs/repository.js";
import { createLifecycleRegistry } from "./lifecycle.js";
import { createDocumentConverter } from "./lib/documentConverter.js";
import { closeStorage } from "./lib/storage.js";

async function main(): Promise<void> {
  const config = parseAppConfig(process.env);
  installAppConfig(config);
  const database = createDatabase(config.database);
  bindDatabase(database);
  const lifecycle = createLifecycleRegistry();
  lifecycle.register("PostgreSQL", database.close);
  let shutdownStarted = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    console.info(`Received ${signal}; shutting down`);
    void lifecycle.shutdown().then(
      () => {
        process.exitCode = 0;
      },
      (error: unknown) => {
        console.error("Shutdown failed", error);
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  const documentConverter = createDocumentConverter(config.conversion);
  lifecycle.register("document converter", documentConverter.close);

  try {
    await database.pool.query("SELECT 1");
    installQueueRepository(
      new PostgresQueueRepository(async (text, values) => {
        const result = await database.pool.query(text, values);
        return result.rows;
      }),
    );
    const { createProductionDependencies } = await import("./productionDependencies.js");
    const dependencies = createProductionDependencies(config, database.database, documentConverter);
    lifecycle.register("object storage", closeStorage);
    const app = createApplication(config, dependencies);

    const server = app.listen(config.runtime.port, "0.0.0.0");
    lifecycle.register("HTTP server", createHttpDrain(server, config.runtime.shutdownTimeoutMs));
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    console.info(`Prism backend running on port ${config.runtime.port}`);
  } catch (startupError) {
    try {
      await lifecycle.shutdown();
    } catch (shutdownError) {
      throw new AggregateError([startupError, shutdownError], "Startup and cleanup failed", {
        cause: shutdownError,
      });
    }
    throw new Error("Backend startup failed", { cause: startupError });
  }
}

void main().catch((error: unknown) => {
  console.error("Backend startup failed", error);
  process.exitCode = 1;
});
