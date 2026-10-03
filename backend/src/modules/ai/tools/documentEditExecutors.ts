import { loadActiveVersion } from "../../../lib/documentVersions.js";
import type { EditInput } from "../../../lib/docxTrackedChanges.js";
import { extractDocxBodyText } from "../../../lib/docxTrackedChangesXml.js";
import { downloadFile } from "../../../lib/storage.js";
import { DocumentPlaceholdersRepository } from "../../documents/documents.placeholders.repository.js";
import {
  buildPlaceholderEdits,
  detectPlaceholderOccurrences,
  placeholderFields,
} from "../../documents/documents.placeholders.service.js";
import { resolveDocLabel } from "./documentContent.js";
import { runEditDocument } from "./docxOperations.js";
import type { DocEditedResult } from "./runtimeTypes.js";
import type { ToolExecutionContext } from "./types.js";

const placeholderValues = new DocumentPlaceholdersRepository();

export async function executeEditDocument(
  context: ToolExecutionContext,
  input: {
    doc_id: string;
    edits: {
      find: string;
      replace: string;
      context_before: string;
      context_after: string;
      reason?: string;
    }[];
  },
): Promise<void> {
  const docId =
    resolveDocLabel(input.doc_id, context.documents.store, context.documents.index) ?? input.doc_id;
  const docInfo = context.documents.store.get(docId);
  const indexed = context.documents.index[docId];
  const emitEditError = (filename: string, documentId: string, error: string) => {
    context.write({ type: "doc_edited_start", filename });
    context.write({
      type: "doc_edited",
      filename,
      document_id: documentId,
      version_id: "",
      download_url: "",
      annotations: [],
      error,
    });
  };
  if (!docInfo || !indexed) {
    const err = `Document '${docId}' not found in this chat's attachments.`;
    emitEditError(docId, indexed?.document_id ?? "", err);
    context.events.toolResults.push({
      role: "tool",
      tool_call_id: context.callId,
      content: JSON.stringify({ error: err }),
    });
    return;
  }
  if (docInfo.file_type !== "docx") {
    const err = "edit_document only supports .docx files.";
    emitEditError(docInfo.filename, indexed.document_id, err);
    context.events.toolResults.push({
      role: "tool",
      tool_call_id: context.callId,
      content: JSON.stringify({ error: err }),
    });
    return;
  }

  context.write({
    type: "doc_edited_start",
    filename: docInfo.filename,
  });
  const edits: EditInput[] = input.edits.map((edit) => ({
    find: edit.find,
    replace: edit.replace,
    context_before: edit.context_before,
    context_after: edit.context_after,
    reason: edit.reason,
  }));
  const reuseVersion = context.documents.turnEdits.get(indexed.document_id);
  const result = await runEditDocument({
    documentId: indexed.document_id,
    userId: context.user.id,
    edits,
    reuseVersion,
    signal: context.signal,
  });
  if (!result.ok) {
    context.write({
      type: "doc_edited",
      filename: docInfo.filename,
      document_id: indexed.document_id,
      version_id: "",
      download_url: "",
      annotations: [],
      error: result.error,
    });
    context.events.toolResults.push({
      role: "tool",
      tool_call_id: context.callId,
      content: JSON.stringify({
        ok: false,
        error: result.error,
      }),
    });
    return;
  }

  context.documents.turnEdits.set(indexed.document_id, {
    versionId: result.version_id,
    versionNumber: result.version_number,
    storagePath: result.storage_path,
  });
  if (context.documents.index[docId]) {
    context.documents.index[docId] = {
      ...context.documents.index[docId],
      version_id: result.version_id,
      version_number: result.version_number,
    };
  }
  const currentDocStore = context.documents.store.get(docId);
  if (currentDocStore) {
    context.documents.store.set(docId, {
      ...currentDocStore,
      storage_path: result.storage_path,
    });
  }
  const payload: DocEditedResult = {
    filename: docInfo.filename,
    document_id: indexed.document_id,
    version_id: result.version_id,
    version_number: result.version_number,
    download_url: result.download_url,
    annotations: result.annotations,
  };
  context.events.docsEdited.push(payload);
  context.write({ type: "doc_edited", ...payload });
  context.events.toolResults.push({
    role: "tool",
    tool_call_id: context.callId,
    content: JSON.stringify({
      ok: true,
      doc_id: docId,
      document_id: indexed.document_id,
      version_id: result.version_id,
      version_number: result.version_number,
      applied: result.annotations.length,
      errors: result.errors,
    }),
  });
}

export async function executeSuggestEdit(
  context: ToolExecutionContext,
  input: {
    doc_id: string;
    suggestions: {
      find: string;
      replace: string;
      context_before?: string;
      context_after?: string;
      reason: string;
      category?: "clarity" | "legal_risk" | "compliance" | "style" | "error";
      priority?: "high" | "medium" | "low";
    }[];
  },
): Promise<void> {
  const { suggestions } = input;
  const docId =
    resolveDocLabel(input.doc_id, context.documents.store, context.documents.index) ?? input.doc_id;
  const docInfo = context.documents.store.get(docId);
  const indexed = context.documents.index[docId];
  if (!docInfo || !indexed) {
    context.events.toolResults.push({
      role: "tool",
      tool_call_id: context.callId,
      content: JSON.stringify({ ok: false, error: `Document '${docId}' not found.` }),
    });
    return;
  }

  const processedSuggestions = suggestions.map((suggestion, index) => ({
    id: `suggestion-${Date.now()}-${index}`,
    find: suggestion.find,
    replace: suggestion.replace,
    context_before: suggestion.context_before ?? "",
    context_after: suggestion.context_after ?? "",
    reason: suggestion.reason,
    category: suggestion.category ?? "style",
    priority: suggestion.priority ?? "medium",
  }));
  const result = {
    ok: true,
    doc_id: docId,
    document_id: indexed.document_id,
    filename: docInfo.filename,
    suggestion_count: processedSuggestions.length,
    suggestions: processedSuggestions,
    instructions:
      "Review each suggestion and accept or reject. Accepted suggestions will be applied as tracked changes.",
  };
  context.events.toolResults.push({
    role: "tool",
    tool_call_id: context.callId,
    content: JSON.stringify(result),
  });
}

export async function executeExtractPlaceholders(
  context: ToolExecutionContext,
  input: { doc_id: string },
): Promise<void> {
  const docId =
    resolveDocLabel(input.doc_id, context.documents.store, context.documents.index) ?? input.doc_id;
  const docInfo = context.documents.store.get(docId);
  const indexed = context.documents.index[docId];
  if (!docInfo || !indexed) {
    context.events.toolResults.push({
      role: "tool",
      tool_call_id: context.callId,
      content: JSON.stringify({
        ok: false,
        error: `Document '${docId}' not found.`,
      }),
    });
    return;
  }

  try {
    const active = await loadActiveVersion(indexed.document_id);
    if (!active) {
      context.events.toolResults.push({
        role: "tool",
        tool_call_id: context.callId,
        content: JSON.stringify({ ok: false, error: "No document version available." }),
      });
      return;
    }
    const raw = await downloadFile(active.storage_path);
    if (!raw) {
      context.events.toolResults.push({
        role: "tool",
        tool_call_id: context.callId,
        content: JSON.stringify({ ok: false, error: "Could not read document bytes." }),
      });
      return;
    }
    const text = await extractDocxBodyText(Buffer.from(raw), { signal: context.signal });
    const fields = placeholderFields(
      detectPlaceholderOccurrences(text),
      await placeholderValues.valuesByKey(indexed.document_id),
    );
    context.events.toolResults.push({
      role: "tool",
      tool_call_id: context.callId,
      content: JSON.stringify({
        ok: true,
        doc_id: docId,
        document_id: indexed.document_id,
        total_placeholders: fields.length,
        fields,
      }),
    });
  } catch (error) {
    context.events.toolResults.push({
      role: "tool",
      tool_call_id: context.callId,
      content: JSON.stringify({
        ok: false,
        error: `Failed to extract placeholders: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }),
    });
  }
}

export async function executeGetPlaceholderValues(
  context: ToolExecutionContext,
  input: { doc_id: string; keys?: string[] },
): Promise<void> {
  const keys = input.keys ?? [];
  const docId =
    resolveDocLabel(input.doc_id, context.documents.store, context.documents.index) ?? input.doc_id;
  const indexed = context.documents.index[docId];
  if (!indexed) {
    context.events.toolResults.push({
      role: "tool",
      tool_call_id: context.callId,
      content: JSON.stringify({ ok: false, error: `Document '${docId}' not found.` }),
    });
    return;
  }
  const saved = await placeholderValues.valuesByKey(indexed.document_id);
  const values: Record<string, string | null> = {};
  const keysToGet = keys.length ? keys : [...saved.keys()];
  for (const key of keysToGet) {
    values[key] = saved.get(key) ?? null;
  }
  context.events.toolResults.push({
    role: "tool",
    tool_call_id: context.callId,
    content: JSON.stringify({
      ok: true,
      doc_id: docId,
      document_id: indexed.document_id,
      values,
    }),
  });
}

export async function executeSetPlaceholderValue(
  context: ToolExecutionContext,
  input: { doc_id: string; key: string; value: string },
): Promise<void> {
  const { key, value } = input;
  const docId =
    resolveDocLabel(input.doc_id, context.documents.store, context.documents.index) ?? input.doc_id;
  const indexed = context.documents.index[docId];
  if (!indexed) {
    context.events.toolResults.push({
      role: "tool",
      tool_call_id: context.callId,
      content: JSON.stringify({ ok: false, error: `Document '${docId}' not found.` }),
    });
    return;
  }

  await placeholderValues.saveValues(indexed.document_id, context.user.id, { [key]: value });
  context.events.toolResults.push({
    role: "tool",
    tool_call_id: context.callId,
    content: JSON.stringify({
      ok: true,
      doc_id: docId,
      document_id: indexed.document_id,
      key,
      value,
    }),
  });
}

export async function executeFillPlaceholders(
  context: ToolExecutionContext,
  input: { doc_id: string; values: Record<string, string> },
): Promise<void> {
  const { values } = input;
  const docId =
    resolveDocLabel(input.doc_id, context.documents.store, context.documents.index) ?? input.doc_id;
  const docInfo = context.documents.store.get(docId);
  const indexed = context.documents.index[docId];
  if (!docInfo || !indexed) {
    context.events.toolResults.push({
      role: "tool",
      tool_call_id: context.callId,
      content: JSON.stringify({ ok: false, error: `Document '${docId}' not found.` }),
    });
    return;
  }

  try {
    await placeholderValues.saveValues(indexed.document_id, context.user.id, values);
    const active = await loadActiveVersion(indexed.document_id);
    if (!active) {
      context.events.toolResults.push({
        role: "tool",
        tool_call_id: context.callId,
        content: JSON.stringify({ ok: false, error: "No document version available." }),
      });
      return;
    }

    const raw = await downloadFile(active.storage_path);
    if (!raw) {
      context.events.toolResults.push({
        role: "tool",
        tool_call_id: context.callId,
        content: JSON.stringify({ ok: false, error: "Could not read document bytes." }),
      });
      return;
    }

    const text = await extractDocxBodyText(Buffer.from(raw), { signal: context.signal });
    const edits = buildPlaceholderEdits(
      detectPlaceholderOccurrences(text),
      new Map(Object.entries(values)),
    );
    if (!edits.length) {
      context.events.toolResults.push({
        role: "tool",
        tool_call_id: context.callId,
        content: JSON.stringify({
          ok: true,
          doc_id: docId,
          document_id: indexed.document_id,
          applied: 0,
          message: "No placeholders found to fill.",
        }),
      });
      return;
    }

    const result = await runEditDocument({
      documentId: indexed.document_id,
      userId: context.user.id,
      edits,
      signal: context.signal,
    });
    if (!result.ok) {
      context.events.toolResults.push({
        role: "tool",
        tool_call_id: context.callId,
        content: JSON.stringify({ ok: false, error: result.error }),
      });
      return;
    }

    const payload: DocEditedResult = {
      filename: docInfo.filename,
      document_id: indexed.document_id,
      version_id: result.version_id,
      version_number: result.version_number,
      download_url: result.download_url,
      annotations: result.annotations,
    };
    context.write({ type: "doc_edited", ...payload });
    context.events.docsEdited.push(payload);
    context.events.toolResults.push({
      role: "tool",
      tool_call_id: context.callId,
      content: JSON.stringify({
        ok: true,
        doc_id: docId,
        document_id: indexed.document_id,
        applied: result.annotations.length,
        version_id: result.version_id,
        version_number: result.version_number,
      }),
    });
  } catch (error) {
    context.events.toolResults.push({
      role: "tool",
      tool_call_id: context.callId,
      content: JSON.stringify({
        ok: false,
        error: `Failed to fill placeholders: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }),
    });
  }
}
