import "./loadEnv.js";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { installAppConfig, parseAppConfig } from "./config.js";
import { bindDatabase, createDatabase } from "./db/index.js";
import { createWorkHandlers } from "./jobs/handlers.js";
import { PostgresQueueRepository, installQueueRepository } from "./jobs/repository.js";
import { createWorkerScheduler } from "./jobs/scheduling.js";
import { startQueueWorker } from "./jobs/workerRuntime.js";
import { createLifecycleRegistry } from "./lifecycle.js";
import { configureEmail } from "./lib/email.js";
import { configureHealthChecks } from "./lib/healthCheck.js";
import { closeStorage, configureStorage } from "./lib/storage.js";
import { configureRetrieval } from "./modules/retrieval/retrieval.composition.js";

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
    console.info(`Received ${signal}; shutting down worker`);
    void lifecycle.shutdown().then(
      () => {
        process.exitCode = 0;
      },
      (error: unknown) => {
        console.error("Worker shutdown failed", error);
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  try {
    await database.pool.query("SELECT 1");
    const repository = new PostgresQueueRepository(async (text, values) => {
      const result = await database.pool.query(text, values);
      return result.rows;
    });
    installQueueRepository(repository);
    configureEmail({
      mail: config.mail,
      trustedActionOrigins: config.auth.trustedOrigins,
    });
    configureRetrieval(config.rag);
    const objectStore = configureStorage(config.storage, config.secrets.downloadSigning);
    lifecycle.register("object storage", closeStorage);
    configureHealthChecks(config.worker.healthCheckUrl);

    const worker = startQueueWorker({
      repository,
      handlers: createWorkHandlers(objectStore),
      workerId: `${hostname()}:${process.pid}:${randomUUID()}`,
      concurrency: config.worker.concurrency,
      pollIntervalMs: config.worker.pollIntervalMs,
      leaseDurationMs: config.worker.leaseDurationMs,
      shutdownTimeoutMs: config.worker.shutdownTimeoutMs,
      schedule: createWorkerScheduler(repository, config.worker),
    });
    lifecycle.register("queue worker", worker.stop);
    console.info(`Prism worker running with concurrency ${config.worker.concurrency}`);

    await worker.done;
  } catch (startupError) {
    try {
      await lifecycle.shutdown();
    } catch (shutdownError) {
      throw new AggregateError([startupError, shutdownError], "Worker startup and cleanup failed", {
        cause: shutdownError,
      });
    }
    throw new Error("Worker startup failed", { cause: startupError });
  }
}

void main().catch((error: unknown) => {
  console.error("Worker startup failed", error);
  process.exitCode = 1;
});
