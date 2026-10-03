import { Router } from "express";
import { singleFileUpload } from "../../lib/upload.js";
import { requireAuth } from "../../middleware/auth.js";
import { createDocumentsChangesController } from "./documents.changes.controller.js";
import type { DocumentChangesService } from "./documents.changes.service.js";
import { createDocumentsContentController } from "./documents.content.controller.js";
import { createDocumentsContextController } from "./documents.context.controller.js";
import type { DocumentContextService } from "./documents.context.service.js";
import { createDocumentsCoreController } from "./documents.core.controller.js";
import { createDocumentsGovernanceController } from "./documents.governance.controller.js";
import type { DocumentGovernanceService } from "./documents.governance.service.js";
import { lifecycleRoutes } from "./documents.governance.validators.js";
import type { DocumentInsightsService } from "./documents.insights.service.js";
import { createDocumentsPlaceholdersController } from "./documents.placeholders.controller.js";
import type { DocumentPlaceholdersService } from "./documents.placeholders.service.js";
import type { DocumentsService } from "./documents.service.js";

export type DocumentsRouteServices = Readonly<{
  documents: DocumentsService;
  context: DocumentContextService;
  insights: DocumentInsightsService;
  changes: DocumentChangesService;
  governance: DocumentGovernanceService;
  placeholders: DocumentPlaceholdersService;
}>;

export function createDocumentsRouter(services: DocumentsRouteServices): Router {
  const router = Router();
  const content = createDocumentsContentController(services.documents);
  const context = createDocumentsContextController(services.context, services.insights);
  const changes = createDocumentsChangesController(services.changes);
  const governance = createDocumentsGovernanceController(services.governance);
  const placeholders = createDocumentsPlaceholdersController(services.placeholders);
  const core = createDocumentsCoreController(services.documents);

  router.post("/download-zip", requireAuth, content.downloadZip);
  router.get("/:documentId/display", requireAuth, content.display);
  router.get("/:documentId/url", requireAuth, content.url);
  router.get("/:documentId/preview-summary", requireAuth, content.previewSummary);
  router.get("/:documentId/docx", requireAuth, content.docx);
  router.get("/:documentId/html", requireAuth, content.html);
  router.get("/:documentId/versions", requireAuth, content.listVersions);
  router.post(
    "/:documentId/versions",
    requireAuth,
    singleFileUpload("file"),
    content.uploadVersion,
  );
  router.post("/:documentId/versions/from-html", requireAuth, content.saveHtmlVersion);
  router.patch("/:documentId/versions/:versionId", requireAuth, content.renameVersion);
  router.get("/:documentId/tracked-change-ids", requireAuth, content.trackedChanges);
  router.post("/:documentId/export", requireAuth, content.export);

  router.get("/:documentId/context-files", requireAuth, context.list);
  router.post("/:documentId/context-files", requireAuth, context.add);
  router.delete("/:documentId/context-files/:contextFileId", requireAuth, context.remove);
  router.get("/:documentId/insights", requireAuth, context.insights);

  router.post("/:documentId/edits/:editId/accept", requireAuth, changes.acceptEdit);
  router.post("/:documentId/edits/:editId/reject", requireAuth, changes.rejectEdit);
  router.post("/:documentId/change-requests", requireAuth, changes.createRequest);
  router.get("/:documentId/change-requests", requireAuth, changes.listRequests);
  router.patch("/:documentId/change-requests/:requestId", requireAuth, changes.reviewRequest);

  router.get("/:documentId/session-context", requireAuth, governance.sessionContext);
  router.get("/:documentId/members", requireAuth, governance.listMembers);
  router.post("/:documentId/members", requireAuth, governance.assignMember);
  router.delete("/:documentId/members/:memberId", requireAuth, governance.revokeMember);
  router.get("/:documentId/shares", requireAuth, governance.listShares);
  router.post("/:documentId/invitations", requireAuth, governance.invite);
  router.patch("/:documentId/shares/:shareId", requireAuth, governance.updateShare);
  router.delete("/:documentId/shares/:shareId", requireAuth, governance.removeShare);
  for (const [path, action] of lifecycleRoutes) {
    router.post(`/:documentId/${path}`, requireAuth, governance.transition(action));
  }
  router.get("/:documentId/chat-messages", requireAuth, governance.listChatMessages);
  router.get("/:documentId/comments", requireAuth, governance.listComments);
  router.post("/:documentId/comments", requireAuth, governance.createComment);
  router.patch("/:documentId/comments/:commentId", requireAuth, governance.updateComment);
  router.delete("/:documentId/comments/:commentId", requireAuth, governance.deleteComment);
  router.get("/:documentId/activity", requireAuth, governance.listActivity);

  router.get("/:documentId/placeholders", requireAuth, placeholders.get);
  router.put("/:documentId/placeholders/values", requireAuth, placeholders.save);
  router.post("/:documentId/placeholders/apply", requireAuth, placeholders.apply);
  router.get("/:documentId/edits", requireAuth, placeholders.listEdits);

  router.get("/", requireAuth, core.list);
  router.post("/", requireAuth, core.create);
  router.post("/upload", requireAuth, singleFileUpload("file"), core.upload);
  router.get("/:documentId", requireAuth, core.get);
  router.patch("/:documentId", requireAuth, core.update);
  router.delete("/:documentId", requireAuth, core.remove);
  return router;
}
