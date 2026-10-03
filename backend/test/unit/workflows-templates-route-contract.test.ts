import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import express from "express";
import swaggerJsdoc from "swagger-jsdoc";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createTemplatesController } from "../../src/modules/templates/templates.controller.js";
import { createTemplatesRouter } from "../../src/modules/templates/templates.routes.js";
import { TemplatesService } from "../../src/modules/templates/templates.service.js";
import { TemplateError } from "../../src/modules/templates/templates.types.js";
import {
  createRulebookRouter,
  createWorkflowsRouter,
} from "../../src/modules/workflows/workflows.routes.js";
import { recordingService, routeParams, routeTable, type ServiceCall } from "./route-table.js";

function routes(router: express.Router): Set<string> {
  const stack = Reflect.get(router, "stack");
  if (!Array.isArray(stack)) throw new Error("Express router stack is unavailable");
  return new Set(
    stack.flatMap((layer: unknown) => {
      if (!layer || typeof layer !== "object") return [];
      const route = Reflect.get(layer, "route");
      const path = route && Reflect.get(route, "path");
      const methods = route && Reflect.get(route, "methods");
      if (typeof path !== "string" || !methods || typeof methods !== "object") return [];
      return Object.entries(methods)
        .filter(([, enabled]) => enabled)
        .map(([method]) => `${method.toUpperCase()} ${path}`);
    }),
  );
}

describe("workflow and template route contracts", () => {
  it("pins every workflow and rulebook route's method, path, middleware, and handler", async () => {
    const calls: ServiceCall[] = [];
    const workflows = await routeTable(
      createWorkflowsRouter(recordingService("workflows", calls)),
      calls,
      {
        "POST /": { title: "NDA review", type: "assistant" },
        "POST /hidden": { workflow_id: routeParams.workflowId },
        "POST /:workflowId/share": { emails: ["invitee@example.com"] },
      },
    );
    const rulebook = await routeTable(
      createRulebookRouter(recordingService("rulebook", calls)),
      calls,
      {
        "POST /generate": {
          document_type: "Non-disclosure agreement",
          sample_document_id: routeParams.documentId,
          extra_requirements: "Mutual obligations",
          count: 8,
        },
      },
    );
    expect(workflows).toEqual([
      "GET / requireAuth -> workflows.list(actor, undefined)",
      'POST / requireAuth -> workflows.create(actor, {"title":"NDA review","type":"assistant"})',
      "GET /hidden requireAuth -> workflows.listHidden(actor)",
      'POST /hidden requireAuth -> workflows.hide(actor, ":workflowId")',
      'DELETE /hidden/:workflowId requireAuth -> workflows.unhide(actor, ":workflowId")',
      'GET /:workflowId requireAuth -> workflows.get(actor, ":workflowId")',
      'PUT /:workflowId requireAuth -> workflows.update(actor, ":workflowId", {})',
      'PATCH /:workflowId requireAuth -> workflows.update(actor, ":workflowId", {})',
      'DELETE /:workflowId requireAuth -> workflows.remove(actor, ":workflowId")',
      'GET /:workflowId/shares requireAuth -> workflows.listShares(actor, ":workflowId")',
      'POST /:workflowId/share requireAuth -> workflows.share(actor, ":workflowId", ["invitee@example.com"], false)',
      'DELETE /:workflowId/shares/:shareId requireAuth -> workflows.removeShare(actor, ":workflowId", ":shareId")',
    ]);
    expect(rulebook).toEqual([
      'POST /generate requireAuth -> rulebook.generate(actor, {"documentType":"Non-disclosure agreement","sampleDocumentId":":documentId","extraRequirements":"Mutual obligations","count":8})',
    ]);
  });

  it("preserves template endpoints", () => {
    const templateService: TemplatesService = Object.create(TemplatesService.prototype);
    expect(routes(createTemplatesRouter(templateService))).toEqual(
      new Set([
        "GET /",
        "POST /",
        "GET /:templateId",
        "PATCH /:templateId",
        "DELETE /:templateId",
        "POST /:templateId/create-document",
        "POST /:templateId/clone",
      ]),
    );
  });

  it("keeps route and controller modules free of direct infrastructure imports", async () => {
    for (const relativePath of [
      "../../src/modules/workflows/workflows.routes.ts",
      "../../src/modules/workflows/workflows.controller.ts",
      "../../src/modules/workflows/rulebook.controller.ts",
      "../../src/modules/templates/templates.routes.ts",
      "../../src/modules/templates/templates.controller.ts",
    ]) {
      const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
      const file = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
      const imports = file.statements.flatMap((statement) =>
        ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
          ? [statement.moduleSpecifier.text]
          : [],
      );
      expect(imports).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/(?:^|\/)(?:db|storage|mail|email|llm|aiRegistry)(?:\/|\.|$)/),
        ]),
      );
    }
  });

  it("publishes workflow and template paths in OpenAPI", () => {
    const specification = swaggerJsdoc({
      definition: {
        openapi: "3.0.0",
        info: { title: "Workflow and template contract", version: "1.0.0" },
      },
      apis: [
        fileURLToPath(
          new URL("../../src/modules/workflows/workflows.openapi.routes.ts", import.meta.url),
        ),
        fileURLToPath(
          new URL("../../src/modules/templates/templates.openapi.routes.ts", import.meta.url),
        ),
      ],
    });
    expect(Reflect.get(specification, "paths")).toMatchObject({
      "/workflows": { get: {}, post: {} },
      "/workflows/{workflowId}/shares/{shareId}": { delete: {} },
      "/templates": { get: {}, post: {} },
      "/templates/{templateId}/create-document": { post: {} },
    });
  });

  it("maps template validation and domain errors at the controller boundary", async () => {
    const service: TemplatesService = Object.create(TemplatesService.prototype);
    service.create = vi.fn();
    service.get = vi.fn(async () => {
      throw new TemplateError(404, "Template not found");
    });
    const controller = createTemplatesController(service);
    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      Reflect.set(res.locals, "auth", {
        user: { id: "user-1", email: "user@example.com" },
      });
      next();
    });
    app.post("/templates", controller.create);
    app.get("/templates/:templateId", controller.get);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server unavailable");
    try {
      const invalid = await fetch(`http://127.0.0.1:${address.port}/templates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: "Legal", content_html: "<p>x</p>" }),
      });
      expect(invalid.status).toBe(400);
      await expect(invalid.json()).resolves.toEqual({ detail: "name is required" });
      expect(service.create).not.toHaveBeenCalled();

      const missing = await fetch(`http://127.0.0.1:${address.port}/templates/missing`);
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toEqual({ detail: "Template not found" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
