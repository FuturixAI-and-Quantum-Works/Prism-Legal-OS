import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { DocumentContextService } from "../../src/modules/documents/documents.context.service.js";
import { createDocumentsContextController } from "../../src/modules/documents/documents.context.controller.js";
import {
  DocumentInsightsError,
  DocumentInsightsService,
  type DocumentInsightsDependencies,
} from "../../src/modules/documents/documents.insights.service.js";
import { DocumentsRepository } from "../../src/modules/documents/documents.repository.js";

const documentId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const actor = { userId, userEmail: "owner@example.com" };
const document = {
  id: documentId,
  projectId: null,
  workspaceId: null,
  userId,
  folderId: null,
  filename: "contract.txt",
  fileType: "txt",
  sizeBytes: 100,
  pageCount: null,
  structureTree: null,
  status: "ready",
  lifecycleStatus: "DRAFT" as const,
  currentVersionId: "00000000-0000-4000-8000-000000000003",
  attached: false,
  isPrimary: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const runtime = {
  connections: [
    {
      id: "connection-1",
      provider: "openai" as const,
      source: "user" as const,
      name: "OpenAI",
      credential: "secret",
    },
  ],
  models: [],
};

function createHarness(
  complete: DocumentInsightsDependencies["complete"],
  runtimeForUser: DocumentInsightsDependencies["runtimeForUser"] = vi.fn(async () => runtime),
) {
  const repository = new DocumentsRepository();
  vi.spyOn(repository, "findDocumentById").mockResolvedValue(document);
  const context = new DocumentContextService(repository);
  vi.spyOn(context, "readableRows").mockResolvedValue([]);
  const extract = vi.fn(
    async () =>
      "A sufficiently long legal document body that contains enough text for the summary path.",
  );
  const createAttentionItems = vi.fn(async () => undefined);
  const service = new DocumentInsightsService(repository, context, {
    content: { extract, read: vi.fn() },
    complete,
    runtimeForUser,
    modelForRuntime: vi.fn(() => "test-model"),
    createAttentionItems,
  });
  return { complete, context, createAttentionItems, extract, service };
}

describe("DocumentInsightsService", () => {
  it("uses shared extraction and returns the existing no-provider response", async () => {
    const complete = vi.fn<DocumentInsightsDependencies["complete"]>();
    const { service, extract } = createHarness(
      complete,
      vi.fn(async () => ({ connections: [], models: [] })),
    );

    const result = await service.generate(actor, documentId);

    expect(extract).toHaveBeenCalledWith({
      kind: "document",
      id: documentId,
      fileType: "txt",
    });
    expect(complete).not.toHaveBeenCalled();
    expect(result.mainDocument.summary).toEqual([
      "Connect an AI API key in settings to generate insights for this document.",
    ]);
  });

  it("keeps a valid empty risk array distinct from a failed analysis", async () => {
    const complete = vi.fn<DocumentInsightsDependencies["complete"]>(async ({ maxTokens }) =>
      maxTokens === 500 ? "- Clear summary" : "[]",
    );
    const { createAttentionItems, service } = createHarness(complete);

    await expect(service.generate(actor, documentId)).resolves.toMatchObject({
      mainDocument: {
        summary: ["Clear summary"],
        risks: [],
      },
    });
    expect(createAttentionItems).not.toHaveBeenCalled();
  });

  it("throws a typed invalid-response failure for malformed risks", async () => {
    const complete = vi.fn<DocumentInsightsDependencies["complete"]>(async ({ maxTokens }) =>
      maxTokens === 500 ? "- Clear summary" : "not-json",
    );
    const { service } = createHarness(complete);

    const result = service.generate(actor, documentId);

    await expect(result).rejects.toBeInstanceOf(DocumentInsightsError);
    await expect(result).rejects.toMatchObject({
      statusCode: 502,
      failure: { kind: "invalid-response", operation: "risks" },
    });
  });

  it("throws a typed upstream failure when risk generation fails", async () => {
    const complete = vi.fn<DocumentInsightsDependencies["complete"]>(async ({ maxTokens }) => {
      if (maxTokens === 500) return "- Clear summary";
      throw new Error("provider unavailable");
    });
    const { service } = createHarness(complete);

    const result = service.generate(actor, documentId);

    await expect(result).rejects.toBeInstanceOf(DocumentInsightsError);
    await expect(result).rejects.toMatchObject({
      statusCode: 502,
      failure: { kind: "upstream", operation: "risks" },
    });
  });

  it("returns a client-visible error response for typed insight failures", async () => {
    const { context, service } = createHarness(vi.fn<DocumentInsightsDependencies["complete"]>());
    vi.spyOn(service, "generate").mockRejectedValue(
      new DocumentInsightsError(
        { kind: "upstream", operation: "risks" },
        { cause: new Error("private provider detail") },
      ),
    );
    const controller = createDocumentsContextController(context, service);
    const json = vi.fn();
    const response = {
      locals: { auth: { user: { id: userId, email: actor.userEmail } } },
      status: vi.fn(),
      json,
    };
    response.status.mockReturnValue(response);

    controller.insights({ params: { documentId } } as Request, response as Response, vi.fn());

    await vi.waitFor(() => expect(response.status).toHaveBeenCalledWith(502));
    expect(json).toHaveBeenCalledWith({
      detail: "The AI provider could not generate document insights.",
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain("private provider detail");
  });
});
