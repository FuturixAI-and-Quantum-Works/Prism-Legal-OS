import type { Request, RequestHandler, Response } from "express";
import { requireAuth } from "../../src/middleware/auth.js";

export const routeParams = {
  documentId: "11111111-1111-4111-8111-111111111111",
  editId: "22222222-2222-4222-8222-222222222222",
  versionId: "33333333-3333-4333-8333-333333333333",
  contextFileId: "44444444-4444-4444-8444-444444444444",
  requestId: "55555555-5555-4555-8555-555555555555",
  memberId: "66666666-6666-4666-8666-666666666666",
  shareId: "77777777-7777-4777-8777-777777777777",
  commentId: "88888888-8888-4888-8888-888888888888",
  workflowId: "99999999-9999-4999-8999-999999999999",
};

const actor = { userId: "user-1", userEmail: "user@example.com" };

const actorShapes = [
  JSON.stringify(actor),
  JSON.stringify({ userId: actor.userId, email: actor.userEmail }),
];

export type ServiceCall = Readonly<{ service: string; method: string; args: unknown[] }>;

export function recordingService<T>(service: string, calls: ServiceCall[]): T {
  return Object.create(
    new Proxy(
      {},
      {
        get(_target, method) {
          if (typeof method !== "string" || method === "then") return undefined;
          return (...args: unknown[]) => {
            calls.push({ service, method, args });
            return Promise.reject(Object.assign(new Error("recorded"), { statusCode: 418 }));
          };
        },
      },
    ),
  );
}

type Layer = Readonly<{
  handle: RequestHandler;
  method?: string;
  regexp?: Readonly<{ fast_slash?: boolean }>;
  route?: Readonly<{ path: string; stack: readonly Layer[] }>;
}>;

function layers(router: unknown): readonly Layer[] {
  const stack = Reflect.get(Object(router), "stack");
  if (!Array.isArray(stack)) throw new Error("Express router stack is unavailable");
  return stack;
}

function middlewareName(handle: unknown): string {
  if (handle === requireAuth) return "requireAuth";
  const uploadField = Reflect.get(Object(handle), "uploadField");
  if (typeof uploadField === "string") return `upload(${uploadField})`;
  throw new Error("Unrecognised route middleware; tag it with a vi.mock like upload.js");
}

function describeArgument(argument: unknown): string {
  const json =
    JSON.stringify(argument, (_key, value: unknown) =>
      Reflect.get(Object(value), "type") === "Buffer" ? "<bytes>" : value,
    ) ?? "undefined";
  if (actorShapes.includes(json)) return "actor";
  return Object.entries(routeParams).reduce(
    (described, [name, value]) => described.replaceAll(value, `:${name}`),
    json,
  );
}

async function dispatchedTo(
  handler: RequestHandler,
  body: unknown,
  calls: ServiceCall[],
): Promise<string> {
  const before = calls.length;
  const sent: { statusCode: number; body: unknown } = { statusCode: 200, body: null };
  const response = {
    locals: { auth: { user: { id: actor.userId, email: "User@Example.com" } } },
    status(code: number) {
      sent.statusCode = code;
      return response;
    },
    json(body: unknown) {
      sent.body = body;
      return response;
    },
  };
  const request = {
    params: routeParams,
    query: {},
    body,
    headers: {},
    file: { buffer: Buffer.from("pinned"), originalname: "pinned.docx", size: 6 },
  };
  const req: Request = Object.assign(Object.create(null), request);
  const res: Response = Object.assign(Object.create(null), response);
  handler(req, res, () => undefined);
  await new Promise((resolve) => setImmediate(resolve));
  const call = calls[before];
  if (call) return `${call.service}.${call.method}(${call.args.map(describeArgument).join(", ")})`;
  return `${sent.statusCode} ${JSON.stringify(sent.body)}`;
}

export type RouteBodies = Readonly<Record<string, unknown>>;

export async function routeTable(
  router: unknown,
  calls: ServiceCall[],
  bodies: RouteBodies = {},
): Promise<string[]> {
  const table: string[] = [];
  for (const layer of layers(router)) {
    if (!layer.route) {
      if (!layer.regexp?.fast_slash) throw new Error("Sub-router is not mounted at /");
      table.push(...(await routeTable(layer.handle, calls, bodies)));
      continue;
    }
    const handles = layer.route.stack.map(({ handle }) => handle);
    const handler = handles.at(-1);
    if (!handler) throw new Error("Route has no handler");
    const middleware = handles.slice(0, -1).map(middlewareName);
    const route = `${layer.route.stack[0]?.method?.toUpperCase()} ${layer.route.path}`;
    const dispatch = await dispatchedTo(handler, bodies[route] ?? {}, calls);
    table.push(`${route} ${middleware.join(" ")} -> ${dispatch}`);
  }
  return table;
}
