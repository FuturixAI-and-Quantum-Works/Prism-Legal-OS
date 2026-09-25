import { toNodeHandler } from "better-auth/node";
import swaggerUi from "swagger-ui-express";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/index.js";
import { createAuth } from "./auth/auth.js";
import { accessAuthority } from "./modules/access/access.composition.js";
import { configureEmail, sendOtpEmail } from "./lib/email.js";
import { enqueueTemplateEmail } from "./jobs/enqueue.js";
import { configureRetrieval } from "./modules/retrieval/retrieval.composition.js";
import { configureStorage } from "./lib/storage.js";
import { bindAuthMiddleware, loadProfile } from "./middleware/auth.js";
import type { DocumentConverter } from "./lib/documentConverter.js";
import { createDocumentsComposition } from "./modules/documents/documents.composition.js";
import { createChatComposition } from "./modules/chat/chat.composition.js";
import {
  createChatRouter,
  createProjectChatRouter,
  createWorkspaceChatRouter,
} from "./modules/chat/chat.routes.js";
import { complianceRouter } from "./modules/compliance/compliance.composition.js";
import { downloadsRouter } from "./modules/downloads/downloads.composition.js";
import { createProductionDriveRouter } from "./modules/drive/drive.composition.js";
import { projectsRouter } from "./modules/projects/projects.routes.js";
import { createProductionTabularRouter } from "./modules/tabular/tabular.composition.js";
import { createProductionTemplatesRouter } from "./modules/templates/templates.composition.js";
import { userRouter } from "./modules/users/users.composition.js";
import { rulebookRouter, workflowsRouter } from "./modules/workflows/workflows.composition.js";
import { approvalsRouter } from "./routes/approvals.js";
import { attentionRouter } from "./routes/attention.js";
import { invitationsRouter } from "./routes/invitations.js";
import { notificationsRouter } from "./routes/notifications.js";
import { sourcesRouter } from "./routes/sources.js";
import { statusRouter } from "./routes/status.js";
import { swaggerSpec } from "./swagger.js";
import type { ApplicationDependencies } from "./app.js";

export function createProductionDependencies(
  config: AppConfig,
  database: Database,
  documentConverter: Pick<DocumentConverter, "capabilities" | "convert">,
): ApplicationDependencies {
  configureEmail({
    mail: config.mail,
    trustedActionOrigins: config.auth.trustedOrigins,
  });
  configureRetrieval(config.rag);
  const objectStore = configureStorage(config.storage, config.secrets.downloadSigning);
  const auth = createAuth(config, { database, sendOtpEmail });
  const middleware = bindAuthMiddleware({
    getSession: (headers) => auth.api.getSession({ headers }),
    getProfile: loadProfile,
  });
  const documents = createDocumentsComposition(documentConverter);
  const chat = createChatComposition(documents.creator);

  return {
    auth,
    authHandler: toNodeHandler(auth),
    authGuard: middleware.requireAuth,
    routes: [
      { path: "/chat", router: createChatRouter(chat.controllers) },
      { path: "/projects", router: projectsRouter },
      {
        path: "/projects/:projectId/chat",
        router: createProjectChatRouter(chat.controllers.project),
      },
      { path: "/documents", router: documents.router },
      { path: "/tabular-review", router: createProductionTabularRouter(documents.creator) },
      { path: "/workflows", router: workflowsRouter },
      { path: "/rulebook", router: rulebookRouter },
      { path: "/user", router: userRouter },
      { path: "/download", router: downloadsRouter },
      {
        path: "/drive/workspaces/:workspaceId/chat",
        router: createWorkspaceChatRouter(chat.controllers.workspace),
      },
      { path: "/drive", router: createProductionDriveRouter(objectStore) },
      { path: "/approvals", router: approvalsRouter },
      {
        path: "/templates",
        router: createProductionTemplatesRouter(documents.creator, objectStore),
      },
      { path: "/sources", router: sourcesRouter },
      { path: "/compliance-review", router: complianceRouter },
      { path: "/status", router: statusRouter, guard: middleware.requireAuth },
      { path: "/invitations", router: invitationsRouter },
      { path: "/attention-items", router: attentionRouter },
      { path: "/notifications", router: notificationsRouter },
    ],
    isAdmin: (userId) => accessAuthority.isGlobalAdmin(userId),
    enqueueEmailTest: (email, idempotencyKey, actorUserId) =>
      enqueueTemplateEmail({
        email,
        idempotencyKey,
        aggregateType: "email_test",
        aggregateId: actorUserId,
      }),
    swagger: {
      serve: swaggerUi.serve,
      setup: swaggerUi.setup(swaggerSpec),
    },
  };
}
