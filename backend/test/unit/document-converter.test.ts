import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDocumentConverter,
  type DocumentConverterConfig,
  type DocumentConverterDependencies,
} from "../../src/lib/documentConverter.js";
import { createChromiumAdapter } from "../../src/lib/documentConverter.chromium.js";
import { createLibreOfficeAdapter } from "../../src/lib/documentConverter.libreOffice.js";
import { docxFixture } from "../fixtures/documentContentFixtures.js";

const roots: string[] = [];
const openSignal = new AbortController().signal;
const config: DocumentConverterConfig = {
  libreOfficePath: "/usr/bin/soffice",
  maxInputBytes: 2_048,
  maxOutputBytes: 1_024,
  timeoutMs: 1_000,
  concurrency: 1,
  maxQueuedPerAdapter: 2,
};

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "prism-converter-test-"));
  roots.push(root);
  return root;
}

function chromiumBrowser(output = Buffer.from("html-pdf")) {
  return {
    newPage: async () => ({
      setJavaScriptEnabled: async () => undefined,
      setRequestInterception: async () => undefined,
      onRequest: () => undefined,
      setContent: async () => undefined,
      pdf: async () => output,
    }),
    close: async () => undefined,
  };
}

function rejectOnAbort(signal: AbortSignal): Promise<void> {
  return new Promise((_resolve, reject) => {
    const rejectAbort = () => reject(signal.reason);
    if (signal.aborted) {
      rejectAbort();
      return;
    }
    signal.addEventListener("abort", rejectAbort, { once: true });
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createDocumentConverter", () => {
  it("does not invent cleanup capabilities for resource-free adapters", () => {
    const dependencies: DocumentConverterDependencies = {
      runLibreOffice: async () => undefined,
      launchChromium: async () => chromiumBrowser(),
    };

    expect(createLibreOfficeAdapter(config, dependencies)).not.toHaveProperty("close");
    expect(createChromiumAdapter(config, dependencies)).not.toHaveProperty("close");
  });

  it("routes its fixed capabilities to the matching adapters", async () => {
    const root = await temporaryRoot();
    const docx = await docxFixture();
    const officeInputs: string[] = [];
    const launches: string[] = [];
    const dependencies: DocumentConverterDependencies = {
      temporaryRoot: root,
      async runLibreOffice(input) {
        officeInputs.push(input.inputPath);
        await writeFile(join(input.outputDirectory, "input.pdf"), "office-pdf");
      },
      async launchChromium(input) {
        launches.push(input.userDataDirectory);
        return chromiumBrowser();
      },
    };
    const converter = createDocumentConverter(config, dependencies);

    await expect(
      converter.convert({ kind: "doc-to-pdf", content: Buffer.from("doc") }, openSignal),
    ).resolves.toEqual(Buffer.from("office-pdf"));
    await expect(
      converter.convert({ kind: "docx-to-pdf", content: docx }, openSignal),
    ).resolves.toEqual(Buffer.from("office-pdf"));
    await expect(
      converter.convert({ kind: "html-to-pdf", html: "<p>html</p>" }, openSignal),
    ).resolves.toEqual(Buffer.from("html-pdf"));

    expect(converter.capabilities.conversions).toEqual([
      "doc-to-pdf",
      "docx-to-pdf",
      "html-to-pdf",
    ]);
    expect(officeInputs.map((path) => path.endsWith(".doc") || path.endsWith(".docx"))).toEqual([
      true,
      true,
    ]);
    expect(launches).toHaveLength(1);
    expect(await readdir(root)).toEqual([]);
    await converter.close();
  });

  it("runs independent adapter queues concurrently and preserves FIFO within each queue", async () => {
    const root = await temporaryRoot();
    const docx = await docxFixture();
    let releaseOffice: (() => void) | undefined;
    let releaseChromium: (() => void) | undefined;
    const officeGate = new Promise<void>((resolve) => {
      releaseOffice = resolve;
    });
    const chromiumGate = new Promise<void>((resolve) => {
      releaseChromium = resolve;
    });
    let officeCalls = 0;
    let chromiumCalls = 0;
    const dependencies: DocumentConverterDependencies = {
      temporaryRoot: root,
      async runLibreOffice(input) {
        officeCalls += 1;
        if (officeCalls === 1) await officeGate;
        await writeFile(join(input.outputDirectory, "input.pdf"), `office-${officeCalls}`);
      },
      async launchChromium() {
        chromiumCalls += 1;
        const call = chromiumCalls;
        if (call === 1) await chromiumGate;
        return chromiumBrowser(Buffer.from(`html-${call}`));
      },
    };
    const converter = createDocumentConverter(config, dependencies);

    const conversions = [
      converter.convert({ kind: "doc-to-pdf", content: Buffer.from("one") }, openSignal),
      converter.convert({ kind: "docx-to-pdf", content: docx }, openSignal),
      converter.convert({ kind: "html-to-pdf", html: "one" }, openSignal),
      converter.convert({ kind: "html-to-pdf", html: "two" }, openSignal),
    ];
    await vi.waitFor(async () => {
      await expect(converter.health()).resolves.toMatchObject({ active: 2, queued: 2 });
    });

    releaseOffice?.();
    releaseChromium?.();
    await expect(Promise.all(conversions)).resolves.toEqual([
      Buffer.from("office-1"),
      Buffer.from("office-2"),
      Buffer.from("html-1"),
      Buffer.from("html-2"),
    ]);
    await converter.close();
  });

  it("applies timeout and caller cancellation while requests wait in a queue", async () => {
    const root = await temporaryRoot();
    const docx = await docxFixture();
    let releaseRun: (() => void) | undefined;
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const run = vi.fn(async () => {
      await runGate;
    });
    const dependencies: DocumentConverterDependencies = {
      temporaryRoot: root,
      runLibreOffice: run,
      launchChromium: async () => chromiumBrowser(),
    };
    const converter = createDocumentConverter({ ...config, timeoutMs: 20 }, dependencies);
    const first = converter.convert(
      { kind: "doc-to-pdf", content: Buffer.from("one") },
      openSignal,
    );
    const cancelled = new AbortController();
    const second = converter.convert({ kind: "docx-to-pdf", content: docx }, cancelled.signal);
    cancelled.abort(new Error("caller cancelled"));
    const third = converter.convert({ kind: "docx-to-pdf", content: docx }, openSignal);
    const releaseAfterThird = third.then(
      () => releaseRun?.(),
      () => releaseRun?.(),
    );

    await Promise.all([
      expect(first).rejects.toMatchObject({ name: "TimeoutError" }),
      expect(second).rejects.toThrow("caller cancelled"),
      expect(third).rejects.toMatchObject({ name: "TimeoutError" }),
      releaseAfterThird,
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    await converter.close();
  });

  it("cleans operation directories after adapter failure", async () => {
    const root = await temporaryRoot();
    const converter = createDocumentConverter(config, {
      temporaryRoot: root,
      runLibreOffice: async () => {
        throw new Error("conversion failed");
      },
      launchChromium: async () => chromiumBrowser(),
    });

    await expect(
      converter.convert({ kind: "doc-to-pdf", content: Buffer.from("doc") }, openSignal),
    ).rejects.toThrow("conversion failed");
    expect(await readdir(root)).toEqual([]);
    await converter.close();
  });

  it("enforces input, output, and queue limits", async () => {
    const root = await temporaryRoot();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const converter = createDocumentConverter(
      { ...config, maxInputBytes: 4, maxOutputBytes: 2, maxQueuedPerAdapter: 1 },
      {
        temporaryRoot: root,
        async runLibreOffice(input) {
          calls += 1;
          if (calls === 1) await gate;
          await writeFile(join(input.outputDirectory, "input.pdf"), "pdf");
        },
        launchChromium: async () => chromiumBrowser(),
      },
    );

    await expect(
      converter.convert({ kind: "doc-to-pdf", content: Buffer.from("large") }, openSignal),
    ).rejects.toThrow("input is 5 bytes; limit is 4 bytes");
    const active = converter.convert(
      { kind: "doc-to-pdf", content: Buffer.from("one") },
      openSignal,
    );
    const queued = converter.convert(
      { kind: "doc-to-pdf", content: Buffer.from("two") },
      openSignal,
    );
    await expect(
      converter.convert({ kind: "doc-to-pdf", content: Buffer.from("tri") }, openSignal),
    ).rejects.toThrow("queue is full");
    release?.();
    await expect(active).rejects.toThrow("output is 3 bytes; limit is 2 bytes");
    await expect(queued).rejects.toThrow("output is 3 bytes; limit is 2 bytes");
    await converter.close();
  });

  it("reports degraded health when one adapter probe fails", async () => {
    const root = await temporaryRoot();
    const converter = createDocumentConverter(config, {
      temporaryRoot: root,
      runLibreOffice: async () => undefined,
      launchChromium: async () => chromiumBrowser(),
      probeLibreOffice: async () => undefined,
      probeChromium: async () => {
        throw new Error("Chromium unavailable");
      },
    });

    await expect(converter.health()).resolves.toMatchObject({
      status: "degraded",
      adapters: [
        { kind: "libreoffice", status: "healthy" },
        { kind: "chromium", status: "unhealthy", detail: "Chromium unavailable" },
      ],
    });
    await converter.close();
  });

  it("disables JavaScript and rejects external Chromium resources", async () => {
    const root = await temporaryRoot();
    const calls: string[] = [];
    const close = vi.fn(async () => undefined);
    let requestHandler:
      | ((request: {
          url: () => string;
          abort: () => Promise<void>;
          continue: () => Promise<void>;
        }) => void)
      | undefined;
    const converter = createDocumentConverter(config, {
      temporaryRoot: root,
      runLibreOffice: async () => undefined,
      async launchChromium() {
        return {
          close,
          async newPage() {
            return {
              async setJavaScriptEnabled(enabled) {
                calls.push(`javascript:${String(enabled)}`);
              },
              async setRequestInterception(enabled) {
                calls.push(`interception:${String(enabled)}`);
              },
              onRequest(handler) {
                requestHandler = handler;
              },
              async setContent() {
                requestHandler?.({
                  url: () => "https://example.com/tracker.png",
                  abort: async () => {
                    calls.push("abort");
                  },
                  continue: async () => {
                    calls.push("continue");
                  },
                });
              },
              pdf: async () => Buffer.from("pdf"),
            };
          },
        };
      },
    });

    await expect(
      converter.convert(
        { kind: "html-to-pdf", html: "<img src='https://example.com'>" },
        openSignal,
      ),
    ).rejects.toThrow("blocked external resource");
    expect(calls).toEqual(["javascript:false", "interception:true", "abort"]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(await readdir(root)).toEqual([]);
    await converter.close();
  });

  it("closes its Chromium process when the caller cancels", async () => {
    const root = await temporaryRoot();
    const close = vi.fn(async () => undefined);
    const controller = new AbortController();
    const converter = createDocumentConverter(config, {
      temporaryRoot: root,
      runLibreOffice: async () => undefined,
      async launchChromium() {
        return {
          close,
          async newPage() {
            return {
              setJavaScriptEnabled: async () => undefined,
              setRequestInterception: async () => undefined,
              onRequest: () => undefined,
              setContent: async () => undefined,
              pdf: () => new Promise<Uint8Array>(() => undefined),
            };
          },
        };
      },
    });
    const conversion = converter.convert(
      { kind: "html-to-pdf", html: "<p>cancel</p>" },
      controller.signal,
    );
    const result = expect(conversion).rejects.toThrow("cancelled");
    await vi.waitFor(async () => {
      await expect(converter.health()).resolves.toMatchObject({ active: 1 });
    });

    controller.abort(new Error("cancelled"));

    await result;
    expect(close).toHaveBeenCalledTimes(1);
    await expect(converter.health()).resolves.toMatchObject({ active: 0, queued: 0 });
    expect(await readdir(root)).toEqual([]);
    await converter.close();
  });

  it("closes active work and returns the same close promise", async () => {
    const root = await temporaryRoot();
    const converter = createDocumentConverter(config, {
      temporaryRoot: root,
      runLibreOffice: (input) => rejectOnAbort(input.signal),
      launchChromium: async () => chromiumBrowser(),
    });
    const conversion = converter.convert(
      { kind: "doc-to-pdf", content: Buffer.from("doc") },
      openSignal,
    );
    await vi.waitFor(async () => {
      await expect(converter.health()).resolves.toMatchObject({ active: 1 });
    });

    const firstClose = converter.close();
    const secondClose = converter.close();
    expect(secondClose).toBe(firstClose);
    await expect(conversion).rejects.toThrow("closed");
    await firstClose;
    await expect(converter.health()).resolves.toMatchObject({ status: "closed" });
  });
});
