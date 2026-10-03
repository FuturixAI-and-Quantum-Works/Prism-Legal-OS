import type { Pool } from "pg";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bindDatabase, type Database } from "../../src/db/index.js";
import type { ToolExecutionContext } from "../../src/modules/ai/tools/types.js";

const mocks = vi.hoisted(() => ({
  assertDocumentActionAllowed: vi.fn(),
  downloadFile: vi.fn(),
  extractDocxBodyText: vi.fn(),
  loadActiveVersion: vi.fn(),
  recordDocumentActivity: vi.fn(),
  runEditDocument: vi.fn(),
}));

vi.mock("../../src/lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/storage.js")>()),
  downloadFile: mocks.downloadFile,
}));

vi.mock("../../src/lib/documentVersions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/documentVersions.js")>()),
  loadActiveVersion: mocks.loadActiveVersion,
}));

vi.mock("../../src/lib/docxTrackedChangesXml.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/docxTrackedChangesXml.js")>()),
  extractDocxBodyText: mocks.extractDocxBodyText,
}));

vi.mock("../../src/modules/ai/tools/docxOperations.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/modules/ai/tools/docxOperations.js")>()),
  runEditDocument: mocks.runEditDocument,
}));

vi.mock("../../src/modules/documents/documents.permissions.service.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/modules/documents/documents.permissions.service.js")
  >()),
  assertDocumentActionAllowed: mocks.assertDocumentActionAllowed,
}));

vi.mock("../../src/modules/documents/documents.activity.service.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/modules/documents/documents.activity.service.js")
  >()),
  recordDocumentActivity: mocks.recordDocumentActivity,
}));

import {
  executeExtractPlaceholders,
  executeFillPlaceholders,
} from "../../src/modules/ai/tools/documentEditExecutors.js";
import { createToolExecutionEvents } from "../../src/modules/ai/tools/types.js";
import { DocumentPlaceholdersRepository } from "../../src/modules/documents/documents.placeholders.repository.js";
import {
  buildPlaceholderEdits,
  detectPlaceholderOccurrences,
  DocumentPlaceholdersService,
  placeholderFields,
} from "../../src/modules/documents/documents.placeholders.service.js";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000001";

const DOCUMENT_TEXT = [
  "Units: {{item_quantity}}",
  "Term: [Number of Years] years",
  "Tenant: {{tenant_name}}, starting {{startDate}}",
].join("\n");

const savedValues = { tenant_name: "Acme Ltd" };

function fakeDatabase(): Database {
  const query = {
    from: () => query,
    where: () => query,
    limit: () => query,
    set: () => query,
    values: () => query,
    then: (resolve: (rows: unknown) => unknown) =>
      resolve(Object.entries(savedValues).map(([fieldKey, value]) => ({ fieldKey, value }))),
  };
  return { select: () => query, update: () => query, insert: () => query } as unknown as Database;
}

function toolContext(): ToolExecutionContext {
  return {
    callId: "call-1",
    user: { id: USER_ID, email: "user@example.com" },
    scope: { kind: "personal" },
    chatId: null,
    write: vi.fn(),
    signal: new AbortController().signal,
    documentCreator: { createBlank: vi.fn(), createFromBuffer: vi.fn() },
    documents: {
      store: new Map([
        [
          "doc-1",
          { storage_path: "documents/lease.docx", file_type: "docx", filename: "Lease.docx" },
        ],
      ]),
      index: { "doc-1": { document_id: DOCUMENT_ID, filename: "Lease.docx" } },
      turnEdits: new Map(),
    },
    workflows: new Map(),
    tabular: { columns: [], documents: [], cells: new Map() },
    events: createToolExecutionEvents(),
  };
}

function placeholdersService(
  values: Readonly<Record<string, string>> = savedValues,
): DocumentPlaceholdersService {
  const repository = new DocumentPlaceholdersRepository();
  vi.spyOn(repository, "findDocument").mockResolvedValue({
    id: DOCUMENT_ID,
    filename: "Lease.docx",
    fileType: "docx",
    userId: USER_ID,
    projectId: null,
  });
  vi.spyOn(repository, "findActiveVersion").mockResolvedValue({
    id: "version-1",
    storagePath: "documents/lease.docx",
    versionNumber: 1,
  });
  vi.spyOn(repository, "valuesByKey").mockResolvedValue(new Map(Object.entries(values)));
  vi.spyOn(repository, "saveValues").mockResolvedValue();
  return new DocumentPlaceholdersService(repository);
}

function toolResult(context: ToolExecutionContext): Record<string, unknown> {
  return JSON.parse(context.events.toolResults.at(-1)?.content ?? "null");
}

const actor = { userId: USER_ID, userEmail: "user@example.com" };

const fillValues = {
  item_quantity: "12",
  numberOfYears: "5",
  tenant_name: "Acme Ltd",
  startDate: "2026-09-02",
};

describe("placeholder fields are the same for the chat tool and the Placeholders tab", () => {
  beforeAll(() => {
    bindDatabase({
      database: fakeDatabase(),
      pool: {} as Pool,
      close: async () => {},
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertDocumentActionAllowed.mockResolvedValue(undefined);
    mocks.recordDocumentActivity.mockResolvedValue(undefined);
    mocks.loadActiveVersion.mockResolvedValue({
      id: "version-1",
      storage_path: "documents/lease.docx",
      version_number: 1,
    });
    mocks.downloadFile.mockResolvedValue(new Uint8Array([1]));
    mocks.extractDocxBodyText.mockResolvedValue(DOCUMENT_TEXT);
    mocks.runEditDocument.mockResolvedValue({
      ok: true,
      version_id: "version-2",
      version_number: 2,
      download_url: "/download",
      annotations: [],
      errors: [],
    });
  });

  const expectedFields = [
    {
      key: "item_quantity",
      label: "Item Quantity",
      type: "number",
      required: true,
      occurrences: 1,
      value: null,
    },
    {
      key: "numberOfYears",
      label: "Number Of Years",
      type: "number",
      required: true,
      occurrences: 1,
      value: null,
    },
    {
      key: "tenant_name",
      label: "Tenant Name",
      type: "text",
      required: true,
      occurrences: 1,
      value: "Acme Ltd",
    },
    {
      key: "startDate",
      label: "Start Date",
      type: "date",
      required: true,
      occurrences: 1,
      value: null,
    },
  ];

  it("lists the Placeholders tab fields", async () => {
    const result = await placeholdersService().get(actor, DOCUMENT_ID);
    expect(result.fields).toEqual(expectedFields);
  });

  it("lists the same fields from the chat extract tool", async () => {
    const context = toolContext();
    await executeExtractPlaceholders(context, { doc_id: "doc-1" });
    expect(toolResult(context)).toMatchObject({ ok: true, fields: expectedFields });
  });

  const expectedEdits = [
    {
      find: "{{item_quantity}}",
      replace: "12",
      context_before: "Units: ",
      context_after: "",
      reason: "Fill Item Quantity",
    },
    {
      find: "[Number of Years]",
      replace: "5",
      context_before: "Term: ",
      context_after: " years",
      reason: "Fill Number Of Years",
    },
    {
      find: "{{tenant_name}}",
      replace: "Acme Ltd",
      context_before: "Tenant: ",
      context_after: ", starting {{startDate}}",
      reason: "Fill Tenant Name",
    },
    {
      find: "{{startDate}}",
      replace: "2026-09-02",
      context_before: "Tenant: {{tenant_name}}, starting ",
      context_after: "",
      reason: "Fill Start Date",
    },
  ];

  it("fills the Placeholders tab fields with contextual edits", async () => {
    await expect(placeholdersService(fillValues).apply(actor, DOCUMENT_ID)).resolves.toMatchObject({
      kind: "applied",
    });
    expect(mocks.runEditDocument).toHaveBeenCalledWith(
      expect.objectContaining({ edits: expectedEdits }),
    );
  });

  it("fills the same edits from the chat fill tool", async () => {
    const saveValues = vi.spyOn(DocumentPlaceholdersRepository.prototype, "saveValues");
    const context = toolContext();
    await executeFillPlaceholders(context, { doc_id: "doc-1", values: fillValues });
    expect(toolResult(context)).toMatchObject({ ok: true });
    expect(saveValues).toHaveBeenCalledWith(DOCUMENT_ID, USER_ID, fillValues);
    expect(mocks.runEditDocument).toHaveBeenCalledWith(
      expect.objectContaining({ edits: expectedEdits }),
    );
  });

  it("counts a repeated placeholder once and fills every occurrence", () => {
    const occurrences = detectPlaceholderOccurrences(
      "Tenant: {{ tenant_name }}\nAgain: {{tenant_name}}",
    );
    const values = new Map([["tenant_name", "Acme Ltd"]]);
    expect(placeholderFields(occurrences, values)).toEqual([
      {
        key: "tenant_name",
        label: "Tenant Name",
        type: "text",
        required: true,
        occurrences: 2,
        value: "Acme Ltd",
      },
    ]);
    expect(buildPlaceholderEdits(occurrences, values)).toEqual([
      {
        find: "{{ tenant_name }}",
        replace: "Acme Ltd",
        context_before: "Tenant: ",
        context_after: "",
        reason: "Fill Tenant Name",
      },
      {
        find: "{{tenant_name}}",
        replace: "Acme Ltd",
        context_before: "Again: ",
        context_after: "",
        reason: "Fill Tenant Name",
      },
    ]);
  });
});
