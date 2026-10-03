import { describe, expect, it, vi } from "vitest";
import { RulebookDraftService } from "../../src/modules/workflows/rulebook.service.js";
import { RulebookAuthorizationPolicy } from "../../src/modules/workflows/rulebook.policy.js";
import type { WorkflowsRepository } from "../../src/modules/workflows/workflows.repository.js";
import { WorkflowsService } from "../../src/modules/workflows/workflows.service.js";
import { WorkflowError, type Workflow } from "../../src/modules/workflows/workflows.types.js";
import { stubAccessAuthority } from "./access-test-helpers.js";

const actor = { userId: "user-1", email: "user@example.com" };
const workflow: Workflow = {
  id: "workflow-1",
  stableKey: null,
  userId: "owner-1",
  title: "Review",
  type: "assistant",
  promptMd: null,
  columnsConfig: null,
  practice: null,
  isSystem: false,
  createdAt: new Date("2026-09-02T00:00:00.000Z"),
  updatedAt: new Date("2026-09-02T00:00:00.000Z"),
};

function workflowRepository(overrides: Partial<WorkflowsRepository> = {}): WorkflowsRepository {
  return {
    findByIdentifier: async () => workflow,
    listAccessible: async () => [],
    create: async () => workflow,
    update: async () => workflow,
    delete: async () => undefined,
    listHidden: async () => [],
    hide: async () => undefined,
    unhide: async () => undefined,
    listShares: async () => [],
    upsertShares: async () => undefined,
    deleteShare: async () => undefined,
    ...overrides,
  };
}

describe("workflow policies and services", () => {
  it("keeps system workflows readable with stable response IDs and immutable otherwise", async () => {
    const systemWorkflow = {
      ...workflow,
      id: "system-1",
      stableKey: "builtin-review",
      userId: null,
      isSystem: true,
    };
    const update = vi.fn(async () => systemWorkflow);
    const service = new WorkflowsService(
      workflowRepository({
        findByIdentifier: async () => systemWorkflow,
        update,
      }),
      stubAccessAuthority(() => ({
        role: "viewer",
        source: "system",
        documentRole: null,
        documentLifecycle: null,
      })),
    );

    await expect(service.get(actor, "builtin-review")).resolves.toMatchObject({
      id: "builtin-review",
      allow_edit: false,
      is_owner: false,
    });
    await expect(service.update(actor, "builtin-review", { title: "Changed" })).rejects.toEqual(
      new WorkflowError(404, "Workflow not found or not editable"),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("uses stable keys only for system workflow response IDs", async () => {
    const repository = workflowRepository({
      listAccessible: vi.fn(async () => [
        {
          workflow: {
            ...workflow,
            id: "database-id",
            stableKey: "builtin-review",
            userId: null,
            isSystem: true,
          },
          sharedByName: null,
        },
      ]),
    });
    const authority = stubAccessAuthority();
    vi.spyOn(authority, "listWorkflowGrants").mockResolvedValue(
      new Map([
        [
          "database-id",
          {
            role: "viewer",
            source: "system",
            documentRole: null,
            documentLifecycle: null,
          },
        ],
      ]),
    );
    const service = new WorkflowsService(repository, authority);

    await expect(service.list(actor)).resolves.toEqual([
      expect.objectContaining({
        id: "builtin-review",
        allow_edit: false,
        is_owner: false,
      }),
    ]);
  });

  it("denies cross-tenant reads, edits, deletes, and sharing without mutations", async () => {
    const update = vi.fn(async () => workflow);
    const deleteWorkflow = vi.fn(async () => undefined);
    const hide = vi.fn(async () => undefined);
    const upsertShares = vi.fn(async () => undefined);
    const deleteShare = vi.fn(async () => undefined);
    const listShares = vi.fn(async () => []);
    const service = new WorkflowsService(
      workflowRepository({
        update,
        delete: deleteWorkflow,
        hide,
        upsertShares,
        deleteShare,
        listShares,
      }),
      stubAccessAuthority(() => null),
    );

    await expect(service.get(actor, workflow.id)).rejects.toEqual(
      new WorkflowError(404, "Workflow not found"),
    );
    await expect(service.hide(actor, workflow.id)).rejects.toEqual(
      new WorkflowError(404, "Workflow not found"),
    );
    await expect(service.update(actor, workflow.id, { title: "Changed" })).rejects.toEqual(
      new WorkflowError(404, "Workflow not found or not editable"),
    );
    await expect(service.remove(actor, workflow.id)).rejects.toEqual(
      new WorkflowError(404, "Workflow not found or not editable"),
    );
    await expect(service.listShares(actor, workflow.id)).rejects.toEqual(
      new WorkflowError(404, "Workflow not found or not editable"),
    );
    await expect(service.share(actor, workflow.id, ["other@example.com"], true)).rejects.toEqual(
      new WorkflowError(404, "Workflow not found or not editable"),
    );
    await expect(service.removeShare(actor, workflow.id, "share-1")).rejects.toEqual(
      new WorkflowError(404, "Workflow not found"),
    );
    expect(update).not.toHaveBeenCalled();
    expect(deleteWorkflow).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
    expect(upsertShares).not.toHaveBeenCalled();
    expect(deleteShare).not.toHaveBeenCalled();
    expect(listShares).not.toHaveBeenCalled();
  });

  it("treats rulebook generation as a non-persisting AI draft", async () => {
    const repository = {
      findSampleDocument: vi.fn(async () => ({
        id: "document-1",
        filename: "credit.docx",
        fileType: "docx",
      })),
    };
    const access = new RulebookAuthorizationPolicy(async (ids) => ids);
    const content = {
      extract: vi.fn(async () => "Credit agreement text"),
      read: vi.fn(),
    };
    const ai = {
      complete: vi.fn(async () =>
        JSON.stringify({
          title: "Credit checks",
          faqs: [
            {
              question: "Is the governing law stated?",
              prompt: "Identify the governing law.",
              format: "yes_no",
              category: "Legal",
              severity: "warning",
              rationale: "Confirms applicable law.",
            },
          ],
        }),
      ),
    };
    const service = new RulebookDraftService(repository, access, content, ai);
    const result = await service.generate(actor, {
      documentType: "Credit agreement",
      sampleDocumentId: "document-1",
      extraRequirements: "",
      count: 12,
    });

    expect(result).toMatchObject({
      title: "Credit checks",
      source: "llm",
      sample_document: { id: "document-1", filename: "credit.docx" },
    });
    expect(result.columns_config).toHaveLength(1);
    expect(repository.findSampleDocument).toHaveBeenCalledOnce();
    expect(ai.complete).toHaveBeenCalledOnce();
  });

  it("hides a rulebook sample document the actor cannot read", async () => {
    const repository = { findSampleDocument: vi.fn() };
    const ai = { complete: vi.fn() };
    const service = new RulebookDraftService(
      repository,
      new RulebookAuthorizationPolicy(async () => []),
      { extract: vi.fn(), read: vi.fn() },
      ai,
    );

    await expect(
      service.generate(actor, {
        documentType: "Credit agreement",
        sampleDocumentId: "document-1",
        extraRequirements: "",
        count: 12,
      }),
    ).rejects.toEqual(new WorkflowError(404, "Sample document not found"));
    expect(repository.findSampleDocument).not.toHaveBeenCalled();
    expect(ai.complete).not.toHaveBeenCalled();
  });
});
