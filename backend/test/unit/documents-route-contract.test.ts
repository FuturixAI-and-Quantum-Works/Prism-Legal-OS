import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import swaggerJsdoc from "swagger-jsdoc";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createDocumentsRouter } from "../../src/modules/documents/documents.routes.js";
import {
  recordingService,
  routeParams,
  routeTable,
  type RouteBodies,
  type ServiceCall,
} from "./route-table.js";

vi.mock("../../src/lib/upload.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/upload.js")>();
  return {
    ...actual,
    singleFileUpload: (fieldName: string) =>
      Object.assign(actual.singleFileUpload(fieldName), { uploadField: fieldName }),
  };
});

const html = "<p>pinned</p>";
const routeBodies: RouteBodies = {
  "POST /download-zip": { document_ids: [routeParams.documentId] },
  "POST /:documentId/versions/from-html": { html },
  "POST /:documentId/export": { html, format: "pdf" },
  "POST /:documentId/context-files": { context_document_id: routeParams.contextFileId },
  "POST /:documentId/change-requests": { change_type: "wording" },
  "PATCH /:documentId/change-requests/:requestId": { action: "approve" },
  "POST /:documentId/members": { email: "reviewer@example.com", role: "REVIEWER" },
  "POST /:documentId/invitations": { email: "invitee@example.com", role: "editor" },
  "PATCH /:documentId/shares/:shareId": { role: "viewer" },
  "POST /:documentId/placeholders/apply": { confirm: "Confirm and fill" },
};

function hasNewExpression(node: ts.Node): boolean {
  if (ts.isNewExpression(node)) return true;
  let found = false;
  node.forEachChild((child) => {
    found ||= hasNewExpression(child);
  });
  return found;
}

describe("documents route contract", () => {
  it("pins every route's method, path, middleware, and handler in registration order", async () => {
    const calls: ServiceCall[] = [];
    const router = createDocumentsRouter({
      documents: recordingService("documents", calls),
      context: recordingService("context", calls),
      insights: recordingService("insights", calls),
      changes: recordingService("changes", calls),
      governance: recordingService("governance", calls),
      placeholders: recordingService("placeholders", calls),
    });
    expect(await routeTable(router, calls, routeBodies)).toEqual([
      'POST /download-zip requireAuth -> documents.downloadZip(actor, {"documentIds":[":documentId"],"mode":"atomic"})',
      'GET /:documentId/display requireAuth -> documents.rawContent(actor, ":documentId", undefined, true)',
      'GET /:documentId/url requireAuth -> documents.signedUrl(actor, ":documentId", undefined, false)',
      'GET /:documentId/preview-summary requireAuth -> documents.previewSummary(actor, ":documentId")',
      'GET /:documentId/docx requireAuth -> documents.rawContent(actor, ":documentId", undefined)',
      'GET /:documentId/html requireAuth -> documents.html(actor, ":documentId", undefined)',
      'GET /:documentId/versions requireAuth -> documents.listVersions(actor, ":documentId")',
      'POST /:documentId/versions requireAuth upload(file) -> documents.uploadVersion(actor, ":documentId", {"filename":"pinned.docx","buffer":"<bytes>"})',
      'POST /:documentId/versions/from-html requireAuth -> documents.saveHtmlVersion(actor, ":documentId", "<p>pinned</p>", undefined)',
      'PATCH /:documentId/versions/:versionId requireAuth -> documents.renameVersion(actor, ":documentId", ":versionId", null)',
      'GET /:documentId/tracked-change-ids requireAuth -> documents.trackedChangeIds(actor, ":documentId", undefined)',
      'POST /:documentId/export requireAuth -> documents.export(actor, ":documentId", "<p>pinned</p>", "pdf")',
      'GET /:documentId/context-files requireAuth -> context.list(actor, ":documentId")',
      'POST /:documentId/context-files requireAuth -> context.add(actor, ":documentId", ":contextFileId")',
      'DELETE /:documentId/context-files/:contextFileId requireAuth -> context.remove(actor, ":documentId", ":contextFileId")',
      'GET /:documentId/insights requireAuth -> insights.generate(actor, ":documentId")',
      'POST /:documentId/edits/:editId/accept requireAuth -> changes.resolveEdit(actor, ":documentId", ":editId", "accept")',
      'POST /:documentId/edits/:editId/reject requireAuth -> changes.resolveEdit(actor, ":documentId", ":editId", "reject")',
      'POST /:documentId/change-requests requireAuth -> changes.createRequest(actor, ":documentId", {"changeType":"wording"})',
      'GET /:documentId/change-requests requireAuth -> changes.listRequests(actor, ":documentId")',
      'PATCH /:documentId/change-requests/:requestId requireAuth -> changes.reviewRequest(actor, ":documentId", ":requestId", "approve", undefined)',
      'GET /:documentId/session-context requireAuth -> governance.sessionContext(actor, ":documentId")',
      'GET /:documentId/members requireAuth -> governance.listMembers(actor, ":documentId")',
      'POST /:documentId/members requireAuth -> governance.assignMember(actor, ":documentId", {"email":"reviewer@example.com","targetUserId":null,"role":"REVIEWER"})',
      'DELETE /:documentId/members/:memberId requireAuth -> governance.revokeMember(actor, ":documentId", ":memberId")',
      'GET /:documentId/shares requireAuth -> governance.listShares(actor, ":documentId")',
      'POST /:documentId/invitations requireAuth -> governance.invite(actor, ":documentId", {"email":"invitee@example.com","role":"editor"})',
      'PATCH /:documentId/shares/:shareId requireAuth -> governance.updateShare(actor, ":documentId", ":shareId", "viewer")',
      'DELETE /:documentId/shares/:shareId requireAuth -> governance.removeShare(actor, ":documentId", ":shareId")',
      'POST /:documentId/send-review requireAuth -> governance.transition(actor, ":documentId", "send_review", null, null)',
      'POST /:documentId/send-approval requireAuth -> governance.transition(actor, ":documentId", "send_approval", null, null)',
      'POST /:documentId/approve requireAuth -> governance.transition(actor, ":documentId", "approve_document", null, null)',
      'POST /:documentId/reject requireAuth -> governance.transition(actor, ":documentId", "reject_document", null, null)',
      'POST /:documentId/finalize requireAuth -> governance.transition(actor, ":documentId", "finalize_document", null, null)',
      'POST /:documentId/request-clarification requireAuth -> governance.transition(actor, ":documentId", "request_clarification", null, null)',
      'GET /:documentId/chat-messages requireAuth -> governance.listChatMessages(actor, ":documentId")',
      'GET /:documentId/comments requireAuth -> governance.listComments(actor, ":documentId")',
      'POST /:documentId/comments requireAuth -> governance.createComment(actor, ":documentId", {"versionId":null,"parentCommentId":null,"body":{"valid":false,"message":"body is required"},"anchorText":null,"anchorStart":null,"anchorEnd":null})',
      'PATCH /:documentId/comments/:commentId requireAuth -> governance.updateComment(actor, ":documentId", ":commentId", {"body":null,"resolved":null})',
      'DELETE /:documentId/comments/:commentId requireAuth -> governance.deleteComment(actor, ":documentId", ":commentId")',
      'GET /:documentId/activity requireAuth -> governance.listActivity(actor, ":documentId")',
      'GET /:documentId/placeholders requireAuth -> placeholders.get(actor, ":documentId")',
      'PUT /:documentId/placeholders/values requireAuth -> placeholders.save(actor, ":documentId", {"valid":false,"message":"values object is required"})',
      'POST /:documentId/placeholders/apply requireAuth -> placeholders.apply(actor, ":documentId")',
      'GET /:documentId/edits requireAuth -> placeholders.listEdits(actor, ":documentId", null)',
      "GET / requireAuth -> documents.list(actor, {})",
      "POST / requireAuth -> documents.createBlank(actor, {})",
      'POST /upload requireAuth upload(file) -> documents.upload({"userId":"user-1","userEmail":"user@example.com","filename":"pinned.docx","buffer":"<bytes>","attached":false})',
      'GET /:documentId requireAuth -> documents.get(actor, ":documentId")',
      'PATCH /:documentId requireAuth -> documents.update(actor, ":documentId", {})',
      'DELETE /:documentId requireAuth -> documents.remove(actor, ":documentId")',
    ]);
  });

  it("keeps routes and controllers free of infrastructure imports", async () => {
    const files = [
      "documents.routes.ts",
      "documents.openapi.routes.ts",
      "documents.core.controller.ts",
      "documents.content.controller.ts",
      "documents.context.controller.ts",
      "documents.changes.controller.ts",
      "documents.governance.controller.ts",
      "documents.placeholders.controller.ts",
    ];
    for (const filename of files) {
      const path = `../../src/modules/documents/${filename}`;
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const imports = parsed.statements.flatMap((statement) =>
        ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
          ? [statement.moduleSpecifier.text]
          : [],
      );
      expect(imports).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/(?:^|\/)(?:ai|db|storage|llm|aiRegistry)(?:\/|\.|$)/),
        ]),
      );
      if (filename.endsWith(".routes.ts")) {
        expect(hasNewExpression(parsed)).toBe(false);
      }
    }
  });

  it("preserves the published document OpenAPI contract", () => {
    const specification = swaggerJsdoc({
      definition: {
        openapi: "3.0.0",
        info: { title: "Document contract", version: "1.0.0" },
      },
      apis: [
        fileURLToPath(
          new URL("../../src/modules/documents/documents.openapi.routes.ts", import.meta.url),
        ),
      ],
      failOnErrors: true,
    });
    const paths = Reflect.get(specification, "paths");
    if (!paths || typeof paths !== "object") throw new Error("OpenAPI paths are unavailable");
    const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
    const operations = new Set(
      Object.entries(paths).flatMap(([path, pathItem]) => {
        if (!pathItem || typeof pathItem !== "object") return [];
        return Object.keys(pathItem)
          .filter((method) => methods.has(method))
          .map((method) => `${method.toUpperCase()} ${path}`);
      }),
    );

    expect(operations).toHaveLength(25);
    expect(operations).toEqual(
      new Set([
        "GET /documents",
        "POST /documents",
        "POST /documents/upload",
        "DELETE /documents/{documentId}",
        "PATCH /documents/{documentId}",
        "GET /documents/{documentId}/display",
        "POST /documents/download-zip",
        "GET /documents/{documentId}/url",
        "GET /documents/{documentId}/docx",
        "GET /documents/{documentId}/html",
        "GET /documents/{documentId}/versions",
        "POST /documents/{documentId}/versions",
        "POST /documents/{documentId}/versions/from-html",
        "POST /documents/{documentId}/export",
        "PATCH /documents/{documentId}/versions/{versionId}",
        "GET /documents/{documentId}/tracked-change-ids",
        "POST /documents/{documentId}/edits/{editId}/accept",
        "POST /documents/{documentId}/edits/{editId}/reject",
        "GET /documents/{documentId}/context-files",
        "POST /documents/{documentId}/context-files",
        "DELETE /documents/{documentId}/context-files/{contextFileId}",
        "GET /documents/{documentId}/insights",
        "POST /documents/{documentId}/change-requests",
        "GET /documents/{documentId}/change-requests",
        "PATCH /documents/{documentId}/change-requests/{requestId}",
      ]),
    );
    expect(createHash("sha256").update(JSON.stringify(paths)).digest("hex")).toBe(
      "e37f6b5b04b4ee63fcb3e064767cc9237478340bf7b47f4f83c5956f64c06512",
    );
  });
});
