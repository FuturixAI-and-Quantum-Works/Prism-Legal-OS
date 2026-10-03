import { describe, expect, it } from "vitest";
import {
  computeLineDiff,
  extractClausesFromText,
  resolveDocLabel,
} from "../../src/modules/ai/tools/documentContent.js";
import type { DocIndex, DocStore } from "../../src/modules/ai/tools/runtimeTypes.js";
import { readTableCells } from "../../src/modules/ai/tools/tabularExecutors.js";
import { registerCreatedDocumentInTurn } from "../../src/modules/ai/tools/turnState.js";

describe("chat runtime helpers", () => {
  it("resolves document labels by label, filename, and document id", () => {
    const store: DocStore = new Map([
      ["doc-0", { storage_path: "documents/a.docx", file_type: "docx", filename: "a.docx" }],
    ]);
    const index: DocIndex = {
      "doc-0": { document_id: "document-a", filename: "a.docx" },
    };

    expect(resolveDocLabel("doc-0", store, index)).toBe("doc-0");
    expect(resolveDocLabel("a.docx", store, index)).toBe("doc-0");
    expect(resolveDocLabel("document-a", store, index)).toBe("doc-0");
    expect(resolveDocLabel("missing", store, index)).toBeNull();
  });

  it("registers a generated document at the first available label", () => {
    const store: DocStore = new Map();
    const index: DocIndex = {
      "doc-0": { document_id: "existing", filename: "existing.docx" },
      "doc-2": { document_id: "other", filename: "other.docx" },
    };

    expect(
      registerCreatedDocumentInTurn(index, store, {
        documentId: "created",
        filename: "created.docx",
        storagePath: "documents/created.docx",
        versionId: "version-created",
        versionNumber: 1,
      }),
    ).toBe("doc-1");
    expect(index["doc-1"]).toEqual({
      document_id: "created",
      filename: "created.docx",
      version_id: "version-created",
      version_number: 1,
    });
    expect(store.get("doc-1")).toEqual({
      storage_path: "documents/created.docx",
      file_type: "docx",
      filename: "created.docx",
    });
  });

  it("keeps line diff and clause extraction output stable", () => {
    expect(computeLineDiff("same\nbefore\nremoved", "same\nafter\nremoved\nadded")).toEqual([
      { type: "modified", lineNumber: 2, before: "before", after: "after" },
      { type: "added", lineNumber: 4, text: "added" },
    ]);
    expect(
      extractClausesFromText("1. TERMINATION\nEither party may terminate in 30 days."),
    ).toEqual([
      {
        type: "termination",
        title: "1. TERMINATION",
        content: "Either party may terminate in 30 days.",
        location: "Character 0",
        keyTerms: ["30 days"],
      },
    ]);
  });

  it("formats selected table cells with stable row and column coordinates", () => {
    expect(
      readTableCells(
        {
          columns: [
            { index: 3, name: "Term" },
            { index: 7, name: "Risk" },
          ],
          documents: [
            { id: "document-a", filename: "a.docx" },
            { id: "document-b", filename: "b.docx" },
          ],
          cells: new Map([
            ["7:document-a", { summary: "High", flag: "review" }],
            ["7:document-b", null],
          ]),
        },
        { columnIndices: [1] },
      ),
    ).toEqual({
      label: "1 column × 2 rows",
      content:
        '[COL:1 "Risk" | ROW:0 "a.docx"]\nSummary: High\nFlag: review\n[COL:1 "Risk" | ROW:1 "b.docx"]\n(not yet generated)\n',
    });
  });
});
