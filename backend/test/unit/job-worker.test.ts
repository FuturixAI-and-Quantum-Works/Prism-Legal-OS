import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWorkHandlers } from "../../src/jobs/handlers.js";
import { startQueueWorker } from "../../src/jobs/workerRuntime.js";
import { configureEmail } from "../../src/lib/email.js";
import type { MailProvider } from "../../src/mail/types.js";
import { DisabledObjectStore } from "../../src/storage/disabledObjectStore.js";
import type {
  ClaimedJob,
  ClaimedOutboxEvent,
  EnqueueJobInput,
  EnqueueOutboxInput,
  QueueRepository,
  WorkClaim,
  WorkOutcome,
} from "../../src/jobs/types.js";

function claimedJob(kind: string, attemptNumber = 1): ClaimedJob {
  return {
    queue: "job",
    id: randomUUID(),
    kind,
    payload: {},
    attemptId: randomUUID(),
    attemptNumber,
    maxAttempts: 3,
    workerId: "test-worker",
    lockedUntil: new Date(Date.now() + 60_000),
  };
}

function claimedEmail(): ClaimedOutboxEvent {
  return {
    queue: "outbox",
    id: randomUUID(),
    topic: "email.template",
    aggregateType: "probe",
    aggregateId: null,
    payload: {
      providerIdempotencyKey: "email:stable",
      email: {
        to: "person@example.com",
        template: "generic",
        category: "transactional",
        data: { subject: "Probe", body: "Probe" },
      },
    },
    attemptNumber: 1,
    maxAttempts: 3,
    workerId: "test-worker",
    lockedUntil: new Date(Date.now() + 60_000),
  };
}

class FakeQueueRepository implements QueueRepository {
  readonly claims: ClaimedJob[] = [];
  readonly completed: WorkClaim[] = [];
  readonly failures: Array<{
    claim: WorkClaim;
    outcome: Exclude<WorkOutcome, { kind: "succeeded" }>;
  }> = [];
  claimCalls = 0;
  renewResult = true;

  enqueueJob(_input: EnqueueJobInput): Promise<string> {
    return Promise.resolve(randomUUID());
  }

  enqueueOutbox(_input: EnqueueOutboxInput): Promise<string> {
    return Promise.resolve(randomUUID());
  }

  claimJob(): Promise<ClaimedJob | null> {
    this.claimCalls += 1;
    return Promise.resolve(this.claims.shift() ?? null);
  }

  claimOutbox(): Promise<null> {
    return Promise.resolve(null);
  }

  renew(): Promise<boolean> {
    return Promise.resolve(this.renewResult);
  }

  complete(claim: WorkClaim): Promise<boolean> {
    this.completed.push(claim);
    return Promise.resolve(true);
  }

  fail(claim: WorkClaim, outcome: Exclude<WorkOutcome, { kind: "succeeded" }>): Promise<boolean> {
    this.failures.push({ claim, outcome });
    return Promise.resolve(true);
  }

  cancelJob(): Promise<boolean> {
    return Promise.resolve(true);
  }

  recoverStaleLeases(): Promise<number> {
    return Promise.resolve(0);
  }
}

async function until(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for worker state");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

const silentLogger = {
  info() {},
  warn() {},
  error() {},
};

describe("startQueueWorker", () => {
  it("rejects malformed persisted payloads as terminal failures", async () => {
    const handlers = createWorkHandlers(new DisabledObjectStore());
    const claim = claimedJob("rag.index");

    await expect(
      handlers.jobs["rag.index"]?.(claim, new AbortController().signal),
    ).resolves.toEqual({
      kind: "failed",
      error: "Invalid RAG job payload",
    });
  });

  it("maps retryable mail failures and preserves the provider idempotency key", async () => {
    const keys: string[] = [];
    const provider: MailProvider = {
      async send(request) {
        keys.push(request.idempotencyKey);
        return {
          status: "failed",
          failure: {
            kind: "transient",
            retryMode: "provider-idempotent",
            message: "mail unavailable",
          },
        };
      },
      async health() {
        return { status: "configured", provider: "resend" };
      },
    };
    configureEmail(
      {
        mail: { kind: "resend", apiKey: "test", fromEmail: "mail@example.com" },
        trustedActionOrigins: ["https://app.example.com"],
      },
      provider,
    );

    const handler = createWorkHandlers(new DisabledObjectStore()).outbox["email.template"];
    const outcome = await handler?.(claimedEmail(), new AbortController().signal);

    expect(outcome).toEqual({ kind: "retry", error: "mail unavailable" });
    expect(keys).toEqual(["email:stable"]);
  });

  it("records successful, retryable, and permanent handler outcomes", async () => {
    const repository = new FakeQueueRepository();
    repository.claims.push(claimedJob("success"), claimedJob("retry"), claimedJob("failure"));
    const worker = startQueueWorker({
      repository,
      handlers: {
        jobs: {
          success: async () => ({ kind: "succeeded" }),
          retry: async () => ({ kind: "retry", error: "temporary", retryAfterMs: 25 }),
          failure: async () => ({ kind: "failed", error: "permanent" }),
        },
        outbox: {},
      },
      workerId: "test-worker",
      concurrency: 1,
      pollIntervalMs: 2,
      leaseDurationMs: 1_000,
      shutdownTimeoutMs: 1_000,
      logger: silentLogger,
    });

    await until(() => repository.completed.length === 1 && repository.failures.length === 2);
    await worker.stop();

    expect(repository.completed[0]?.kind).toBe("success");
    expect(repository.failures.map(({ outcome }) => outcome)).toEqual([
      { kind: "retry", error: "temporary", retryAfterMs: 25 },
      { kind: "failed", error: "permanent" },
    ]);
  });

  it("stops taking claims and drains the active handler", async () => {
    const repository = new FakeQueueRepository();
    repository.claims.push(claimedJob("blocked"), claimedJob("must-not-start"));
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const handlerReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = startQueueWorker({
      repository,
      handlers: {
        jobs: {
          blocked: async () => {
            started?.();
            await handlerReleased;
            return { kind: "succeeded" };
          },
          "must-not-start": async () => ({ kind: "succeeded" }),
        },
        outbox: {},
      },
      workerId: "test-worker",
      concurrency: 1,
      pollIntervalMs: 2,
      leaseDurationMs: 1_000,
      shutdownTimeoutMs: 1_000,
      logger: silentLogger,
    });

    await handlerStarted;
    const stop = worker.stop();
    const stoppedEarly = await Promise.race([
      stop.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 10)),
    ]);
    expect(stoppedEarly).toBe(false);
    release?.();
    await stop;

    expect(repository.completed).toHaveLength(1);
    expect(repository.claimCalls).toBe(1);
  });

  it("turns thrown handler errors into retry outcomes", async () => {
    const repository = new FakeQueueRepository();
    repository.claims.push(claimedJob("throws"));
    const worker = startQueueWorker({
      repository,
      handlers: {
        jobs: {
          throws: async () => {
            throw new Error("provider unavailable");
          },
        },
        outbox: {},
      },
      workerId: "test-worker",
      concurrency: 1,
      pollIntervalMs: 2,
      leaseDurationMs: 1_000,
      shutdownTimeoutMs: 1_000,
      logger: silentLogger,
    });

    await until(() => repository.failures.length === 1);
    await worker.stop();

    expect(repository.failures[0]?.outcome).toEqual({
      kind: "retry",
      error: "provider unavailable",
    });
  });

  it("aborts a running handler after its lease is cancelled", async () => {
    const repository = new FakeQueueRepository();
    repository.claims.push(claimedJob("cancelled"));
    repository.renewResult = false;
    let observedAbort = false;
    const worker = startQueueWorker({
      repository,
      handlers: {
        jobs: {
          cancelled: async (_claim, signal) => {
            await new Promise<void>((resolve) =>
              signal.addEventListener(
                "abort",
                () => {
                  observedAbort = true;
                  resolve();
                },
                { once: true },
              ),
            );
            return { kind: "failed", error: "cancelled" };
          },
        },
        outbox: {},
      },
      workerId: "test-worker",
      concurrency: 1,
      pollIntervalMs: 2,
      leaseDurationMs: 10,
      shutdownTimeoutMs: 1_000,
      logger: silentLogger,
    });

    await until(() => observedAbort);
    await worker.stop();

    expect(repository.failures).toHaveLength(1);
  });
});
