import {
  createChromiumAdapter,
  launchChromium,
  probeChromium,
} from "./documentConverter.chromium.js";
import {
  abortError,
  ConverterClosedError,
  ConversionLimitError,
  ConversionQueueFullError,
  inputSize,
  type ConversionAdapter,
  type ConverterState,
} from "./documentConverter.internal.js";
import {
  createLibreOfficeAdapter,
  probeLibreOffice,
  runLibreOffice,
} from "./documentConverter.libreOffice.js";
import type {
  DocumentConversionRequest,
  DocumentConverter,
  DocumentConverterCapabilities,
  DocumentConverterConfig,
  DocumentConverterDependencies,
} from "./documentConverter.types.js";

export type {
  DocumentConversionKind,
  DocumentConversionRequest,
  DocumentConverter,
  DocumentConverterConfig,
  DocumentConverterDependencies,
} from "./documentConverter.types.js";

type QueueJob = {
  request: DocumentConversionRequest;
  signal: AbortSignal;
  resolve: (output: Buffer) => void;
  reject: (error: Error) => void;
  onAbort: () => void;
};

const defaultDependencies: DocumentConverterDependencies = {
  runLibreOffice,
  launchChromium,
  probeLibreOffice,
  probeChromium,
};

function createAdapterQueue(
  adapter: ConversionAdapter,
  concurrency: number,
  maxQueued: number,
  healthTimeoutMs: number,
) {
  let state: ConverterState = "open";
  let active = 0;
  const queued: QueueJob[] = [];
  const activeControllers = new Set<AbortController>();
  const activeOperations = new Set<Promise<void>>();
  let closePromise: Promise<void> | undefined;

  const dispatch = (): void => {
    while (state === "open" && active < concurrency) {
      const job = queued.shift();
      if (!job) return;
      job.signal.removeEventListener("abort", job.onAbort);
      if (job.signal.aborted) {
        job.reject(abortError(job.signal));
        continue;
      }

      active += 1;
      const controller = new AbortController();
      activeControllers.add(controller);
      const operationSignal = AbortSignal.any([job.signal, controller.signal]);
      const operation = adapter.convert(job.request, operationSignal).then(job.resolve, job.reject);
      const finish = () => {
        active -= 1;
        activeControllers.delete(controller);
        activeOperations.delete(completion);
        dispatch();
      };
      const completion = operation.then(finish, finish);
      activeOperations.add(completion);
    }
  };

  const submit = (request: DocumentConversionRequest, signal: AbortSignal): Promise<Buffer> => {
    if (state !== "open") return Promise.reject(new ConverterClosedError());
    if (signal.aborted) return Promise.reject(abortError(signal));
    if (active >= concurrency && queued.length >= maxQueued) {
      return Promise.reject(new ConversionQueueFullError(adapter.kind, maxQueued));
    }

    return new Promise<Buffer>((resolve, reject) => {
      const job: QueueJob = {
        request,
        signal,
        resolve,
        reject,
        onAbort() {
          const index = queued.indexOf(job);
          if (index === -1) return;
          queued.splice(index, 1);
          reject(abortError(signal));
        },
      };
      signal.addEventListener("abort", job.onAbort, { once: true });
      queued.push(job);
      dispatch();
    });
  };

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    state = "closing";
    const closedError = new ConverterClosedError();
    for (const job of queued.splice(0)) {
      job.signal.removeEventListener("abort", job.onAbort);
      job.reject(closedError);
    }
    for (const controller of activeControllers) controller.abort(closedError);
    closePromise = Promise.allSettled([...activeOperations])
      .then(async () => {
        await adapter.close?.();
      })
      .finally(() => {
        state = "closed";
      });
    return closePromise;
  };

  return {
    adapter,
    submit,
    close,
    async health() {
      if (state !== "open") {
        return { kind: adapter.kind, status: state, active, queued: queued.length };
      }
      try {
        await adapter.health(AbortSignal.timeout(healthTimeoutMs));
        return { kind: adapter.kind, status: "healthy" as const, active, queued: queued.length };
      } catch (error) {
        return {
          kind: adapter.kind,
          status: "unhealthy" as const,
          active,
          queued: queued.length,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

export function createDocumentConverter(
  config: DocumentConverterConfig,
  dependencies: DocumentConverterDependencies = defaultDependencies,
): DocumentConverter {
  const libreOfficeQueue = createAdapterQueue(
    createLibreOfficeAdapter(config, dependencies),
    config.concurrency,
    config.maxQueuedPerAdapter,
    Math.min(config.timeoutMs, 5_000),
  );
  const chromiumQueue = createAdapterQueue(
    createChromiumAdapter(config, dependencies),
    config.concurrency,
    config.maxQueuedPerAdapter,
    Math.min(config.timeoutMs, 5_000),
  );
  const queues = [libreOfficeQueue, chromiumQueue] as const;
  const capabilities: DocumentConverterCapabilities = Object.freeze({
    conversions: Object.freeze([
      "doc-to-pdf",
      "docx-to-pdf",
      "html-to-pdf",
    ] satisfies DocumentConversionRequest["kind"][]),
    maxInputBytes: config.maxInputBytes,
    maxOutputBytes: config.maxOutputBytes,
    adapters: Object.freeze(
      queues.map((queue) =>
        Object.freeze({
          kind: queue.adapter.kind,
          conversions: Object.freeze([...queue.adapter.conversions]),
          concurrency: config.concurrency,
          maxQueued: config.maxQueuedPerAdapter,
        }),
      ),
    ),
  });
  let state: ConverterState = "open";
  let closePromise: Promise<void> | undefined;

  const queueFor = (request: DocumentConversionRequest) => {
    switch (request.kind) {
      case "doc-to-pdf":
      case "docx-to-pdf":
        return libreOfficeQueue;
      case "html-to-pdf":
        return chromiumQueue;
    }
  };

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    state = "closing";
    closePromise = Promise.all(queues.map((queue) => queue.close()))
      .then(() => undefined)
      .finally(() => {
        state = "closed";
      });
    return closePromise;
  };

  return Object.freeze({
    capabilities,
    convert(request, signal) {
      if (state !== "open") return Promise.reject(new ConverterClosedError());
      const size = inputSize(request);
      if (size > config.maxInputBytes) {
        return Promise.reject(new ConversionLimitError("input", size, config.maxInputBytes));
      }
      return queueFor(request).submit(
        request,
        AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
      );
    },
    async health() {
      const adapters = await Promise.all(queues.map((queue) => queue.health()));
      const healthyAdapters = adapters.filter((adapter) => adapter.status === "healthy").length;
      return {
        status:
          state !== "open"
            ? state
            : healthyAdapters === adapters.length
              ? "healthy"
              : healthyAdapters === 0
                ? "unhealthy"
                : "degraded",
        active: adapters.reduce((total, adapter) => total + adapter.active, 0),
        queued: adapters.reduce((total, adapter) => total + adapter.queued, 0),
        adapters,
        capabilities,
      };
    },
    close,
  });
}
