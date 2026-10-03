import { randomUUID } from "node:crypto";
import cors, { type CorsOptions } from "cors";
import express, { type Express, type RequestHandler, type Router } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { AppConfig } from "./config.js";
import type { TemplateEmailInput } from "./lib/email.js";

type RateLimitPolicy = keyof AppConfig["runtime"]["rateLimits"];
const rateLimitMessages: Partial<Record<RateLimitPolicy, string>> = {
  chat: "Too many chat requests. Please try again later.",
  upload: "Too many upload requests. Please try again later.",
  compliance: "Too many compliance review requests. Please try again later.",
};
type HttpMethod = "get" | "patch" | "post";

export type EndpointRateLimitRule = {
  method: HttpMethod;
  path: string;
  policy: RateLimitPolicy;
};

export const endpointRateLimitRules = [
  { method: "post", path: "/chat", policy: "chat" },
  { method: "post", path: "/projects/:projectId/chat", policy: "chat" },
  {
    method: "post",
    path: "/drive/workspaces/:workspaceId/chat",
    policy: "chat",
  },
  { method: "post", path: "/tabular-review/:reviewId/chat", policy: "chat" },
  { method: "post", path: "/rulebook/generate", policy: "chatCreate" },
  { method: "post", path: "/chat/create", policy: "chatCreate" },
  {
    method: "post",
    path: "/chat/:chatId/generate-title",
    policy: "chatCreate",
  },
  { method: "post", path: "/documents/upload", policy: "upload" },
  { method: "post", path: "/documents/:documentId/versions", policy: "upload" },
  { method: "post", path: "/drive/files", policy: "upload" },
  { method: "post", path: "/drive/files/:fileId/versions", policy: "upload" },
  {
    method: "post",
    path: "/compliance-review/:reviewId/run",
    policy: "compliance",
  },
  {
    method: "post",
    path: "/tabular-review/:reviewId/generate",
    policy: "compliance",
  },
  { method: "get", path: "/invitations/:token", policy: "invitationLookup" },
  {
    method: "post",
    path: "/invitations/:token/accept",
    policy: "invitationDecision",
  },
  {
    method: "post",
    path: "/invitations/:token/decline",
    policy: "invitationDecision",
  },
  {
    method: "post",
    path: "/invitations/by-id/:invitationId/accept",
    policy: "invitationDecision",
  },
  {
    method: "post",
    path: "/invitations/by-id/:invitationId/decline",
    policy: "invitationDecision",
  },
  {
    method: "post",
    path: "/projects/:projectId/invitations",
    policy: "invitationSend",
  },
  { method: "post", path: "/projects", policy: "invitationSend" },
  {
    method: "patch",
    path: "/projects/:projectId",
    policy: "invitationSend",
  },
  {
    method: "post",
    path: "/documents/:documentId/invitations",
    policy: "invitationSend",
  },
  {
    method: "post",
    path: "/drive/workspaces/:workspaceId/invitations",
    policy: "invitationSend",
  },
  {
    method: "get",
    path: "/approvals/public/:token",
    policy: "publicApprovalRead",
  },
  {
    method: "post",
    path: "/approvals/public/:token/decision",
    policy: "publicApprovalDecision",
  },
  { method: "post", path: "/tabular-review/prompt", policy: "tabularPrompt" },
  {
    method: "post",
    path: "/tabular-review/:reviewId/regenerate-cell",
    policy: "tabularRegenerate",
  },
  {
    method: "get",
    path: "/documents/:documentId/versions",
    policy: "fileVersionRead",
  },
  {
    method: "get",
    path: "/drive/files/:fileId/versions",
    policy: "fileVersionRead",
  },
  { method: "post", path: "/health/email/test", policy: "invitationSend" },
  { method: "post", path: "/status/check", policy: "providerCheck" },
  {
    method: "post",
    path: "/user/ai/connections/:connectionId/test",
    policy: "providerCheck",
  },
] as const satisfies readonly EndpointRateLimitRule[];

function corsOptions(allowedOrigins: ReadonlySet<string>): CorsOptions {
  return {
    credentials: true,
    exposedHeaders: "X-Compliance-Run-Id, X-Tabular-Run-Id",
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
  };
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createCookieOriginGuard(allowedOrigins: ReadonlySet<string>): RequestHandler {
  return (req, res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const cookieHeader = req.headers.cookie ?? "";
    if (!cookieHeader.includes("better-auth.session_token=")) {
      next();
      return;
    }

    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      res.status(403).json({ detail: "Origin not allowed" });
      return;
    }

    next();
  };
}

function makeLimiter(options: { windowMs: number; max: number; message?: string }) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS" || req.path === "/health",
    message: {
      detail: options.message ?? "Too many requests. Please try again later.",
    },
  });
}

export function attachEndpointRateLimits(
  app: Express,
  rateLimits: AppConfig["runtime"]["rateLimits"],
): void {
  for (const rule of endpointRateLimitRules) {
    const configured = rateLimits[rule.policy];
    app[rule.method](
      rule.path,
      makeLimiter({
        windowMs: configured.windowMs,
        max: configured.max,
        message: rateLimitMessages[rule.policy],
      }),
    );
  }
}

export function configureHttpPerimeter(app: Express, config: AppConfig): void {
  const allowedOrigins = new Set(config.auth.trustedOrigins);
  app.disable("x-powered-by");
  app.set("trust proxy", config.runtime.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      hsts:
        config.runtime.kind === "production"
          ? {
              maxAge: 15552000,
              includeSubDomains: true,
            }
          : false,
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use(cors(corsOptions(allowedOrigins)));
  app.use(
    makeLimiter({
      windowMs: config.runtime.rateLimits.general.windowMs,
      max: config.runtime.rateLimits.general.max,
    }),
  );
  attachEndpointRateLimits(app, config.runtime.rateLimits);
}

export type RouteRegistration = Readonly<{
  path: string;
  router: Router;
  guard?: RequestHandler;
}>;

export type ApplicationDependencies = Readonly<{
  authHandler: RequestHandler;
  auth?: import("./auth/auth.js").Auth;
  authGuard: RequestHandler;
  routes: readonly RouteRegistration[];
  isAdmin: (userId: string) => Promise<boolean>;
  enqueueEmailTest: (
    input: TemplateEmailInput,
    idempotencyKey: string,
    actorUserId: string,
  ) => Promise<string>;
  swagger: Readonly<{
    serve: readonly RequestHandler[];
    setup: RequestHandler;
  }>;
}>;

export function createApplication(
  config: AppConfig,
  dependencies: ApplicationDependencies,
): Express {
  const app = express();
  configureHttpPerimeter(app, config);
  if (config.runtime.kind === "development" && dependencies.auth) {
    const auth = dependencies.auth;
    app.post("/auth/test-login", (req, res) => {
      const specifier = "./auth/testLogin.local.js";
      void import(specifier)
        .then(
          (mod: {
            handleTestLogin?: (
              request: typeof req,
              response: typeof res,
              authApi: NonNullable<ApplicationDependencies["auth"]>,
              appConfig: AppConfig,
            ) => Promise<void>;
          }) => {
            if (!mod.handleTestLogin) {
              res.status(404).json({ detail: "Not found" });
              return;
            }
            return mod.handleTestLogin(req, res, auth, config);
          },
        )
        .catch(() => {
          if (!res.headersSent) res.status(404).json({ detail: "Not found" });
        });
    });
  }
  app.all("/auth/*", dependencies.authHandler);
  app.use(createCookieOriginGuard(new Set(config.auth.trustedOrigins)));
  app.use(express.json({ limit: "50mb" }));
  app.use("/api-docs", ...dependencies.swagger.serve, dependencies.swagger.setup);

  for (const route of dependencies.routes) {
    if (route.guard) app.use(route.path, route.guard, route.router);
    else app.use(route.path, route.router);
  }

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.post("/health/email/test", dependencies.authGuard, async (req, res, next) => {
    try {
      const userId = res.locals.auth.user.id;
      const userEmail = res.locals.auth.user.email.toLowerCase();
      if (!(await dependencies.isAdmin(userId))) {
        res.status(403).json({ detail: "Admin access required" });
        return;
      }
      const to =
        typeof req.body?.to === "string" && req.body.to.includes("@")
          ? req.body.to.trim()
          : userEmail;
      if (!to) {
        res.status(400).json({ detail: "Test recipient email required" });
        return;
      }
      const outboxEventId = await dependencies.enqueueEmailTest(
        {
          to,
          template: "email-test",
          category: "security",
          data: {
            subject: "Prism Legal email test",
            title: "Prism Legal email test",
            body: "This message tests the configured Prism Legal email provider.",
          },
        },
        `email-test:${userId}:${randomUUID()}`,
        userId,
      );
      res.status(202).json({ ok: true, status: "queued", outbox_event_id: outboxEventId });
    } catch (error) {
      next(error);
    }
  });
  return app;
}
