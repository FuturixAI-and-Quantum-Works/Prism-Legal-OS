import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, HTTPRequest, Page } from "puppeteer";
import {
  abortable,
  abortError,
  ConversionLimitError,
  type ConversionAdapter,
} from "./documentConverter.internal.js";
import type {
  ChromiumBrowser,
  ChromiumLaunchInput,
  ChromiumPage,
  DocumentConverterConfig,
  DocumentConverterDependencies,
} from "./documentConverter.types.js";

class ExternalResourceError extends Error {
  constructor(url: string) {
    super(`HTML conversion blocked external resource: ${url}`);
    this.name = "ExternalResourceError";
  }
}

function htmlDocument(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 12pt;
      line-height: 1.6;
      color: #333;
      max-width: 100%;
      padding: 0;
      margin: 0;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 1em;
      margin-bottom: 0.5em;
    }
    p {
      margin: 0 0 1em 0;
    }
    ul, ol {
      margin: 0 0 1em 0;
      padding-left: 2em;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 1em;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

function isAllowedChromiumUrl(rawUrl: string): boolean {
  try {
    return ["about:", "data:", "blob:"].includes(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

function wrapPage(page: Page): ChromiumPage {
  return {
    setJavaScriptEnabled: (enabled) => page.setJavaScriptEnabled(enabled),
    setRequestInterception: (enabled) => page.setRequestInterception(enabled),
    onRequest(handler) {
      page.on("request", (request: HTTPRequest) => handler(request));
    },
    setContent: (html) => page.setContent(html, { waitUntil: "load" }),
    pdf: () =>
      page.pdf({
        format: "A4",
        margin: { top: "1in", right: "1in", bottom: "1in", left: "1in" },
        printBackground: true,
      }),
  };
}

function wrapBrowser(browser: Browser): ChromiumBrowser {
  return {
    async newPage() {
      return wrapPage(await browser.newPage());
    },
    close: () => browser.close(),
  };
}

export async function launchChromium(input: ChromiumLaunchInput): Promise<ChromiumBrowser> {
  const { launch } = await import("puppeteer");
  return wrapBrowser(
    await launch({
      headless: true,
      userDataDir: input.userDataDirectory,
      signal: input.signal,
    }),
  );
}

export async function probeChromium(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError(signal);
  const { executablePath } = await import("puppeteer");
  await access(await executablePath());
  if (signal.aborted) throw abortError(signal);
}

export function createChromiumAdapter(
  config: DocumentConverterConfig,
  dependencies: DocumentConverterDependencies,
): ConversionAdapter {
  return {
    kind: "chromium",
    conversions: ["html-to-pdf"],
    async convert(request, signal) {
      if (request.kind !== "html-to-pdf") {
        throw new Error(`Chromium cannot handle ${request.kind}`);
      }
      const directory = await mkdtemp(
        join(dependencies.temporaryRoot ?? tmpdir(), "prism-chromium-"),
      );
      let closeBrowser: (() => Promise<void>) | undefined;
      try {
        const browser = await abortable(
          dependencies.launchChromium({
            userDataDirectory: join(directory, "profile"),
            signal,
          }),
          signal,
          (launchedBrowser) => launchedBrowser.close(),
        );
        let browserClosePromise: Promise<void> | undefined;
        closeBrowser = () => {
          browserClosePromise ??= browser.close();
          return browserClosePromise;
        };
        const page = await abortable(browser.newPage(), signal, closeBrowser);
        await abortable(page.setJavaScriptEnabled(false), signal, closeBrowser);
        await abortable(page.setRequestInterception(true), signal, closeBrowser);

        let blockedResource: ExternalResourceError | undefined;
        page.onRequest((resource) => {
          if (isAllowedChromiumUrl(resource.url())) {
            void resource.continue().catch(() => undefined);
            return;
          }
          blockedResource ??= new ExternalResourceError(resource.url());
          void resource.abort().catch(() => undefined);
        });

        try {
          await abortable(page.setContent(htmlDocument(request.html)), signal, closeBrowser);
        } catch (error) {
          if (blockedResource) throw blockedResource;
          throw error;
        }
        if (blockedResource) throw blockedResource;
        const output = Buffer.from(await abortable(page.pdf(), signal, closeBrowser));
        if (blockedResource) throw blockedResource;
        if (output.byteLength > config.maxOutputBytes) {
          throw new ConversionLimitError("output", output.byteLength, config.maxOutputBytes);
        }
        return output;
      } finally {
        if (closeBrowser) await closeBrowser();
        await rm(directory, { recursive: true, force: true });
      }
    },
    async health(signal) {
      await dependencies.probeChromium?.(signal);
    },
  };
}
