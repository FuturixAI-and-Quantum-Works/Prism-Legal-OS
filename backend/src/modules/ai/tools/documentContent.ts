import type { DocReadFailedEvent, StreamEventWriter } from "@prism/protocol";
import { extractDocxBodyText } from "../../../lib/docxTrackedChangesXml.js";
import { loadActiveVersion } from "../../../lib/documentVersions.js";
import { downloadFile } from "../../../lib/storage.js";
import {
  assertDocumentContentActive,
  decodeDocumentContent,
  DocumentContentError,
} from "../../content/documentContent.js";
import type { DocIndex, DocStore } from "./runtimeTypes.js";

export function resolveDocLabel(
  rawId: string,
  docStore: DocStore,
  docIndex?: DocIndex,
): string | null {
  if (docStore.has(rawId)) return rawId;
  for (const [label, info] of docStore.entries()) {
    if (info.filename === rawId) return label;
  }
  if (docIndex) {
    for (const [label, info] of Object.entries(docIndex)) {
      if (info.document_id === rawId) return label;
    }
  }
  return null;
}

export function citationReminder(docLabel: string, filename: string): string {
  return [
    `[Citation requirement for ${docLabel} ("${filename}")]:`,
    `If your final answer makes any factual claim from this document, include inline [N] markers and append a final <CITATIONS> JSON block.`,
    `Every citation entry for this document MUST use "doc_id": "${docLabel}".`,
    `Use this exact citation object shape: {"ref": 1, "doc_id": "${docLabel}", "page": 1, "quote": "exact verbatim text from the document"}.`,
    `Do not use "marker" or "text" keys in the citation block; use "ref" and "quote".`,
  ].join("\n");
}

export async function loadCurrentVersionBytes(
  documentId: string,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; storage_path: string } | null> {
  assertDocumentContentActive(signal);
  const active = await loadActiveVersion(documentId);
  if (!active) return null;
  const raw = await downloadFile(active.storage_path);
  assertDocumentContentActive(signal);
  if (!raw) throw new Error("Active document version could not be downloaded.");
  return { bytes: Buffer.from(raw), storage_path: active.storage_path };
}

export class DocumentReadError extends Error {
  constructor(
    readonly reason: DocReadFailedEvent["reason"],
    readonly docId: string,
    readonly filename: string | undefined,
    readonly documentId: string | undefined,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentReadError";
  }
}

export async function readDocumentContent(
  docLabel: string,
  docStore: DocStore,
  write: StreamEventWriter,
  docIndex?: DocIndex,
  opts?: { emitEvents?: boolean; signal?: AbortSignal },
): Promise<string> {
  const emitEvents = opts?.emitEvents ?? true;
  console.info("[read_document] started");
  const docInfo = docStore.get(docLabel);
  if (!docInfo) {
    console.warn("[read_document] not_found");
    const error = new DocumentReadError(
      "not_found",
      docLabel,
      undefined,
      undefined,
      "Document not found.",
    );
    if (emitEvents) {
      write({
        type: "doc_read_failed",
        doc_id: docLabel,
        reason: error.reason,
        error: error.message,
      });
    }
    throw error;
  }

  const documentId = docIndex?.[docLabel]?.document_id;
  const emitDocRead = () => {
    if (!emitEvents) return;
    write({ type: "doc_read", filename: docInfo.filename, document_id: documentId });
  };
  if (emitEvents) {
    write({
      type: "doc_read_start",
      filename: docInfo.filename,
      document_id: documentId,
    });
  }

  const fail = (reason: DocReadFailedEvent["reason"], message: string, cause?: unknown): never => {
    const error = new DocumentReadError(
      reason,
      docLabel,
      docInfo.filename,
      documentId,
      message,
      cause === undefined ? undefined : { cause },
    );
    if (emitEvents) {
      write({
        type: "doc_read_failed",
        doc_id: docLabel,
        filename: docInfo.filename,
        document_id: documentId,
        reason,
        error: message,
      });
    }
    throw error;
  };

  let raw: ArrayBuffer | null = null;
  try {
    if (documentId) {
      const current = await loadCurrentVersionBytes(documentId, opts?.signal);
      if (current) {
        raw = Uint8Array.from(current.bytes).buffer;
      }
    }
    if (!raw) raw = await downloadFile(docInfo.storage_path);
    assertDocumentContentActive(opts?.signal);
  } catch (error) {
    if (
      opts?.signal?.aborted ||
      (error instanceof DocumentContentError && error.code === "aborted")
    ) {
      throw error;
    }
    console.warn("[read_document] download_failed");
    return fail("download_failed", "Document could not be read.", error);
  }
  if (!raw) {
    console.warn("[read_document] download_failed");
    return fail("download_failed", "Document could not be read.");
  }
  const bytes = raw;

  try {
    let text: string;
    if (docInfo.file_type === "pdf") {
      text = (
        await decodeDocumentContent({
          bytes,
          filename: docInfo.filename,
          fileType: docInfo.file_type,
          output: "text",
          signal: opts?.signal,
        })
      ).text;
    } else if (docInfo.file_type === "docx") {
      text = await extractDocxBodyText(Buffer.from(bytes), { signal: opts?.signal });
    } else {
      text = (
        await decodeDocumentContent({
          bytes,
          filename: docInfo.filename,
          fileType: docInfo.file_type,
          output: "text",
          signal: opts?.signal,
        })
      ).text;
    }
    console.info("[read_document] completed");
    emitDocRead();
    return text;
  } catch (error) {
    if (
      opts?.signal?.aborted ||
      (error instanceof DocumentContentError && error.code === "aborted")
    ) {
      throw error;
    }
    console.error("[read_document] failed");
    return fail("decode_failed", "Document could not be read.", error);
  }
}

function normalizeWithMap(text: string): { norm: string; origIdx: number[] } {
  const norm: string[] = [];
  const origIdx: number[] = [];
  let prevSpace = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (/\s/.test(character)) {
      if (!prevSpace) {
        norm.push(" ");
        origIdx.push(index);
        prevSpace = true;
      }
    } else {
      norm.push(character.toLowerCase());
      origIdx.push(index);
      prevSpace = false;
    }
  }
  return { norm: norm.join(""), origIdx };
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function findInDocumentContent(params: {
  docLabel: string;
  query: string;
  maxResults?: number;
  contextChars?: number;
  docStore: DocStore;
  write: StreamEventWriter;
  docIndex?: DocIndex;
  signal?: AbortSignal;
}): Promise<string> {
  const {
    docLabel,
    query,
    maxResults = 20,
    contextChars = 80,
    docStore,
    write,
    docIndex,
    signal,
  } = params;
  if (!query.trim()) return JSON.stringify({ ok: false, error: "Empty query." });
  const docInfo = docStore.get(docLabel);
  if (!docInfo) {
    return JSON.stringify({ ok: false, error: `Document '${docLabel}' not found.` });
  }
  write({ type: "doc_find_start", filename: docInfo.filename, query });
  let text: string;
  try {
    text = await readDocumentContent(docLabel, docStore, write, docIndex, {
      emitEvents: false,
      signal,
    });
  } catch (error) {
    if (!(error instanceof DocumentReadError)) throw error;
    write({
      type: "doc_read_failed",
      doc_id: error.docId,
      ...(error.filename ? { filename: error.filename } : {}),
      ...(error.documentId ? { document_id: error.documentId } : {}),
      reason: error.reason,
      error: error.message,
    });
    return JSON.stringify({
      ok: false,
      filename: docInfo.filename,
      error: "Document could not be read.",
    });
  }

  const { norm, origIdx } = normalizeWithMap(text);
  const needle = normalizeQuery(query);
  if (!needle) return JSON.stringify({ ok: false, error: "Empty query after normalization." });
  const hits: { index: number; excerpt: string; context: string }[] = [];
  let from = 0;
  while (from <= norm.length - needle.length && hits.length < maxResults) {
    const position = norm.indexOf(needle, from);
    if (position < 0) break;
    const endPosition = position + needle.length;
    const originalStart = origIdx[position] ?? 0;
    const originalEnd =
      endPosition - 1 < origIdx.length ? origIdx[endPosition - 1] + 1 : text.length;
    const contextStart = Math.max(0, originalStart - contextChars);
    const contextEnd = Math.min(text.length, originalEnd + contextChars);
    hits.push({
      index: hits.length,
      excerpt: text.slice(originalStart, originalEnd),
      context:
        (contextStart > 0 ? "…" : "") +
        text.slice(contextStart, contextEnd).replace(/\s+/g, " ").trim() +
        (contextEnd < text.length ? "…" : ""),
    });
    from = position + Math.max(1, needle.length);
  }
  let totalMatches = hits.length;
  if (hits.length >= maxResults) {
    let probe = from;
    while (probe <= norm.length - needle.length) {
      const position = norm.indexOf(needle, probe);
      if (position < 0) break;
      totalMatches += 1;
      probe = position + Math.max(1, needle.length);
    }
  }
  write({ type: "doc_find", filename: docInfo.filename, query, total_matches: totalMatches });
  return JSON.stringify({
    ok: true,
    filename: docInfo.filename,
    query,
    total_matches: totalMatches,
    returned: hits.length,
    truncated: totalMatches > hits.length,
    hits,
  });
}

export type DiffChange = {
  type: "added" | "removed" | "modified" | "unchanged";
  lineNumber: number;
  before?: string;
  after?: string;
  text?: string;
};

export function computeLineDiff(textA: string, textB: string): DiffChange[] {
  const linesA = textA.split("\n");
  const linesB = textB.split("\n");
  const changes: DiffChange[] = [];
  const maxLength = Math.max(linesA.length, linesB.length);
  for (let index = 0; index < maxLength; index += 1) {
    const before = linesA[index];
    const after = linesB[index];
    if (before === undefined && after !== undefined) {
      changes.push({ type: "added", lineNumber: index + 1, text: after });
    } else if (after === undefined && before !== undefined) {
      changes.push({ type: "removed", lineNumber: index + 1, text: before });
    } else if (before !== after) {
      changes.push({ type: "modified", lineNumber: index + 1, before, after });
    }
  }
  return changes;
}

export type ExtractedClause = {
  type: string;
  title: string;
  content: string;
  location: string;
  keyTerms: string[];
};

export function extractClausesFromText(text: string, filterTypes?: string[]): ExtractedClause[] {
  const clauses: ExtractedClause[] = [];
  const clausePatterns = [
    {
      type: "termination",
      pattern: /(?:^|\n)(?:\d+\.?\s*)?(?:TERMINATION|Termination)[^\n]*\n([\s\S]*?)(?=\n\d+\.|$)/gi,
    },
    {
      type: "indemnification",
      pattern:
        /(?:^|\n)(?:\d+\.?\s*)?(?:INDEMNIFICATION|Indemnification|INDEMNITY|Indemnity)[^\n]*\n([\s\S]*?)(?=\n\d+\.|$)/gi,
    },
    {
      type: "confidentiality",
      pattern:
        /(?:^|\n)(?:\d+\.?\s*)?(?:CONFIDENTIALITY|Confidentiality|CONFIDENTIAL INFORMATION)[^\n]*\n([\s\S]*?)(?=\n\d+\.|$)/gi,
    },
    {
      type: "liability",
      pattern:
        /(?:^|\n)(?:\d+\.?\s*)?(?:LIMITATION OF LIABILITY|Limitation of Liability|LIABILITY)[^\n]*\n([\s\S]*?)(?=\n\d+\.|$)/gi,
    },
    {
      type: "governing_law",
      pattern:
        /(?:^|\n)(?:\d+\.?\s*)?(?:GOVERNING LAW|Governing Law)[^\n]*\n([\s\S]*?)(?=\n\d+\.|$)/gi,
    },
    {
      type: "dispute_resolution",
      pattern:
        /(?:^|\n)(?:\d+\.?\s*)?(?:DISPUTE RESOLUTION|Dispute Resolution|ARBITRATION|Arbitration)[^\n]*\n([\s\S]*?)(?=\n\d+\.|$)/gi,
    },
    {
      type: "force_majeure",
      pattern:
        /(?:^|\n)(?:\d+\.?\s*)?(?:FORCE MAJEURE|Force Majeure)[^\n]*\n([\s\S]*?)(?=\n\d+\.|$)/gi,
    },
    {
      type: "assignment",
      pattern: /(?:^|\n)(?:\d+\.?\s*)?(?:ASSIGNMENT|Assignment)[^\n]*\n([\s\S]*?)(?=\n\d+\.|$)/gi,
    },
    {
      type: "notices",
      pattern: /(?:^|\n)(?:\d+\.?\s*)?(?:NOTICES|Notices)[^\n]*\n([\s\S]*?)(?=\n\d+\.|$)/gi,
    },
    {
      type: "warranties",
      pattern:
        /(?:^|\n)(?:\d+\.?\s*)?(?:WARRANTIES|Warranties|REPRESENTATIONS AND WARRANTIES)[^\n]*\n([\s\S]*?)(?=\n\d+\.|$)/gi,
    },
  ];
  const activePatterns = filterTypes?.length
    ? clausePatterns.filter((candidate) =>
        filterTypes.some((type) => candidate.type.includes(type.toLowerCase())),
      )
    : clausePatterns;
  for (const { type, pattern } of activePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const title = match[0].match(/^[^\n]+/)?.[0].trim() ?? type;
      const content = (match[1] || "").trim().slice(0, 500);
      const keyTerms: string[] = [];
      for (const termPattern of [
        /\b(shall|must|will|may not|cannot|agrees to|warrants|represents)\b/gi,
        /\b(\d+)\s*(days?|months?|years?|business days?)/gi,
        /\$[\d,]+(?:\.\d{2})?/g,
      ]) {
        const terms = content.match(termPattern);
        if (terms) keyTerms.push(...terms.slice(0, 3));
      }
      clauses.push({
        type,
        title,
        content: content.length >= 500 ? `${content}...` : content,
        location: `Character ${match.index}`,
        keyTerms: [...new Set(keyTerms)].slice(0, 5),
      });
    }
  }
  return clauses;
}
