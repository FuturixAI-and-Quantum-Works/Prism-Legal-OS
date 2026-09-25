import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, request } from "undici";

export type ResolveHostname = (hostname: string) => Promise<readonly string[]>;

const metadataHostnames = new Set([
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

export function isProhibitedProviderAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (!ipaddr.isValid(normalized)) return true;
  return ipaddr.process(normalized).range() !== "unicast";
}

async function systemResolve(hostname: string): Promise<readonly string[]> {
  if (isIP(hostname)) return [hostname];
  return (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);
}

function parseProviderUrl(raw: string): URL {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:") {
    throw new Error("Custom AI provider endpoints must use HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Custom AI provider endpoints must not include credentials");
  }
  if (metadataHostnames.has(hostname)) {
    throw new Error("Custom AI provider endpoint resolves to a prohibited metadata address");
  }
  return url;
}

async function normalizeRequestBody(
  body: BodyInit | null | undefined,
): Promise<string | Uint8Array | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new Error("Unsupported custom AI provider request body");
}

async function resolveSafeAddresses(
  url: URL,
  resolveHostname: ResolveHostname,
): Promise<readonly string[]> {
  const addresses = await resolveHostname(url.hostname);
  if (addresses.length === 0) throw new Error("Custom AI provider endpoint did not resolve");
  if (addresses.some(isProhibitedProviderAddress)) {
    throw new Error("Custom AI provider endpoint resolves to a prohibited network address");
  }
  return addresses;
}

export async function validateCustomProviderEndpoint(
  raw: string,
  options: Readonly<{ resolveHostname?: ResolveHostname }> = {},
): Promise<string> {
  const url = parseProviderUrl(raw);
  if (url.search || url.hash) {
    throw new Error("Custom AI provider endpoints must not include a query or fragment");
  }
  await resolveSafeAddresses(url, options.resolveHostname ?? systemResolve);
  return url.toString().replace(/\/$/, "");
}

export function createSafeProviderFetch(
  options: Readonly<{
    resolveHostname?: ResolveHostname;
    maxRedirects?: number;
  }> = {},
): typeof fetch {
  const resolveHostname = options.resolveHostname ?? systemResolve;
  const maxRedirects = options.maxRedirects ?? 4;

  return async (input, init) => {
    let url = parseProviderUrl(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
    );
    let requestInit = init;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const addresses = await resolveSafeAddresses(url, resolveHostname);
      const pinnedAddress = addresses[0];
      const dispatcher = new Agent({
        connect: {
          lookup(_hostname, lookupOptions, callback) {
            const family = isIP(pinnedAddress);
            if (lookupOptions.all) {
              callback(null, [{ address: pinnedAddress, family }]);
            } else {
              callback(null, pinnedAddress, family);
            }
          },
        },
      });
      let responseOwnsDispatcher = false;
      try {
        const body = await normalizeRequestBody(requestInit?.body);
        const response = await request(url, {
          method: requestInit?.method ?? "GET",
          headers: Object.fromEntries(new Headers(requestInit?.headers).entries()),
          body,
          signal: requestInit?.signal ?? undefined,
          dispatcher,
        });
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) {
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
        }
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          const location = headers.get("location");
          if (location) {
            await response.body.dump();
            if (redirectCount === maxRedirects) {
              throw new Error("Custom AI provider redirected too many times");
            }
            const redirectedUrl = parseProviderUrl(new URL(location, url).toString());
            if (redirectedUrl.origin !== url.origin) {
              throw new Error("Custom AI provider redirects must remain on the configured origin");
            }
            url = redirectedUrl;
            if (
              response.statusCode === 303 ||
              ((response.statusCode === 301 || response.statusCode === 302) &&
                requestInit?.method?.toUpperCase() === "POST")
            ) {
              requestInit = { ...requestInit, method: "GET", body: undefined };
            }
            continue;
          }
        }
        const iterator = response.body[Symbol.asyncIterator]();
        const responseBody = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const next = await iterator.next();
            if (next.done) {
              controller.close();
              await dispatcher.close();
            } else {
              controller.enqueue(new Uint8Array(next.value));
            }
          },
          async cancel() {
            await iterator.return?.();
            await dispatcher.close();
          },
        });
        const fetchResponse = new Response(responseBody, {
          status: response.statusCode,
          headers,
        });
        responseOwnsDispatcher = true;
        return fetchResponse;
      } finally {
        if (!responseOwnsDispatcher) await dispatcher.close();
      }
    }
    throw new Error("Custom AI provider redirected too many times");
  };
}
