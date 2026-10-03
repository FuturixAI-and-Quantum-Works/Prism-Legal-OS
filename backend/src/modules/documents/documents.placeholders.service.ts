import { assertDocumentActionAllowed } from "./documents.permissions.service.js";
import { extractDocxBodyText } from "../../lib/docxTrackedChangesXml.js";
import { downloadFile } from "../../lib/storage.js";
import { runEditDocument } from "../ai/tools/docxOperations.js";
import type { EditAnnotation } from "../ai/tools/runtimeTypes.js";
import { recordDocumentActivity } from "./documents.activity.service.js";
import type { RequestUserContext } from "./documents.models.js";
import { DocumentPlaceholdersRepository } from "./documents.placeholders.repository.js";
import {
  type DeferredPlaceholderValues,
  requirePlaceholderValues,
} from "./documents.placeholders.validators.js";

export class DocumentPlaceholdersError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "DocumentPlaceholdersError";
  }
}

export type PlaceholderField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "date" | "number";
  required: boolean;
  occurrences: number;
  value: string | null;
};

export type PlaceholderOccurrence = {
  key: string;
  label: string;
  token: string;
  paragraph: string;
  matchIndex: number;
  order: number;
};

type BracketCandidate = {
  rawLabel: string;
  token: string;
  paragraph: string;
  matchIndex: number;
  order: number;
};

type PlaceholderDocument = NonNullable<
  Awaited<ReturnType<DocumentPlaceholdersRepository["findDocument"]>>
>;
type EditRow = Awaited<ReturnType<DocumentPlaceholdersRepository["listEdits"]>>[number];

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferFieldType(key: string): PlaceholderField["type"] {
  if (/date$/i.test(key) || /Date/i.test(key)) return "date";
  if (/address|description|purpose|premises|terms/i.test(key)) return "textarea";
  if (
    /rent|deposit|salary|rate|value|amount|price|fee|period|contribution|percentage|number|quantity|count|years?/i.test(
      key,
    )
  ) {
    return "number";
  }
  return "text";
}

function cleanBracketLabel(rawLabel: string): string | null {
  const label = rawLabel
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .trim();
  if (label.length < 2 || label.length > 80) return null;
  if (!/[A-Za-z]/.test(label)) return null;
  if (!/^[A-Za-z][A-Za-z0-9\s/&._-]*$/.test(label)) return null;
  return label.replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function toFieldKey(label: string): string {
  const words = label
    .replace(/&/g, " and ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "placeholder";
  const [first, ...rest] = words;
  return [
    first.charAt(0).toLowerCase() + first.slice(1),
    ...rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)),
  ]
    .join("")
    .slice(0, 120);
}

function getPartyContext(paragraph: string, matchIndex: number): "Party A" | "Party B" | null {
  const before = paragraph.slice(Math.max(0, matchIndex - 260), matchIndex).toLowerCase();
  const partyAIndex = before.lastIndexOf("party a");
  const partyBIndex = before.lastIndexOf("party b");
  if (partyAIndex === -1 && partyBIndex === -1) return null;
  return partyAIndex > partyBIndex ? "Party A" : "Party B";
}

function isPartyScopedGenericLabel(normalizedLabel: string): boolean {
  return [
    "address",
    "entity type",
    "state of incorporation organization",
    "state of incorporation",
    "state of organization",
    "name",
    "title",
  ].includes(normalizedLabel);
}

function isGenericBracketLabel(normalizedLabel: string): boolean {
  return (
    isPartyScopedGenericLabel(normalizedLabel) ||
    ["date", "number", "state"].includes(normalizedLabel)
  );
}

function deriveBracketFieldLabel(
  rawLabel: string,
  paragraph: string,
  matchIndex: number,
  tokenLength: number,
  ordinal: number,
  totalForRawLabel: number,
): string {
  const normalized = normalizeLabel(rawLabel);
  const partyContext = getPartyContext(paragraph, matchIndex);
  if (partyContext && isPartyScopedGenericLabel(normalized)) {
    return `${partyContext} ${rawLabel}`;
  }
  const before = paragraph.slice(Math.max(0, matchIndex - 160), matchIndex).toLowerCase();
  const after = paragraph
    .slice(matchIndex + tokenLength, matchIndex + tokenLength + 120)
    .toLowerCase();
  const around = `${before} ${after}`;
  if (normalized === "date" && /effective date/.test(around)) return "Effective Date";
  if (normalized === "state" && /(governing law|governed by|laws of the state)/.test(around)) {
    return "Governing Law State";
  }
  if (normalized === "number") {
    if (/(surviv|termination|expiration)/.test(before)) return "Survival Period Number";
    if (/(full force|continue|agreement shall|term)/.test(before)) {
      return "Agreement Term Number";
    }
    if (totalForRawLabel > 1) return `${rawLabel} ${ordinal}`;
  }
  if (totalForRawLabel > 1 && isGenericBracketLabel(normalized)) {
    return `${rawLabel} ${ordinal}`;
  }
  return rawLabel;
}

function stableKeyForLabel(
  label: string,
  labelKeys: Map<string, string>,
  keyLabels: Map<string, string>,
): string {
  const existing = labelKeys.get(label);
  if (existing) return existing;
  const baseKey = toFieldKey(label);
  let key = baseKey;
  let suffix = 2;
  while (keyLabels.has(key) && keyLabels.get(key) !== label) {
    key = `${baseKey}${suffix}`;
    suffix += 1;
  }
  labelKeys.set(label, key);
  keyLabels.set(key, label);
  return key;
}

export function detectPlaceholderOccurrences(text: string): PlaceholderOccurrence[] {
  const occurrences: PlaceholderOccurrence[] = [];
  const bracketCandidates: BracketCandidate[] = [];
  const paragraphs = text.split(/\r?\n/);
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    const braceRegex = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
    let braceMatch: RegExpExecArray | null;
    while ((braceMatch = braceRegex.exec(paragraph)) !== null) {
      const key = braceMatch[1];
      occurrences.push({
        key,
        label: humanizeKey(key),
        token: braceMatch[0],
        paragraph,
        matchIndex: braceMatch.index,
        order: paragraphIndex * 1_000_000 + braceMatch.index,
      });
    }
    const bracketRegex = /\[([^\u005b\u005d\r\n]{1,80})\]/g;
    let bracketMatch: RegExpExecArray | null;
    while ((bracketMatch = bracketRegex.exec(paragraph)) !== null) {
      const rawLabel = cleanBracketLabel(bracketMatch[1]);
      if (!rawLabel) continue;
      bracketCandidates.push({
        rawLabel,
        token: bracketMatch[0],
        paragraph,
        matchIndex: bracketMatch.index,
        order: paragraphIndex * 1_000_000 + bracketMatch.index,
      });
    }
  }
  const rawLabelCounts = new Map<string, number>();
  for (const candidate of bracketCandidates) {
    rawLabelCounts.set(candidate.rawLabel, (rawLabelCounts.get(candidate.rawLabel) ?? 0) + 1);
  }
  const rawLabelOrdinals = new Map<string, number>();
  const labelKeys = new Map<string, string>();
  const keyLabels = new Map<string, string>();
  for (const candidate of bracketCandidates.sort((left, right) => left.order - right.order)) {
    const ordinal = (rawLabelOrdinals.get(candidate.rawLabel) ?? 0) + 1;
    rawLabelOrdinals.set(candidate.rawLabel, ordinal);
    const label = deriveBracketFieldLabel(
      candidate.rawLabel,
      candidate.paragraph,
      candidate.matchIndex,
      candidate.token.length,
      ordinal,
      rawLabelCounts.get(candidate.rawLabel) ?? 1,
    );
    occurrences.push({
      key: stableKeyForLabel(label, labelKeys, keyLabels),
      label,
      token: candidate.token,
      paragraph: candidate.paragraph,
      matchIndex: candidate.matchIndex,
      order: candidate.order,
    });
  }
  return occurrences.sort((left, right) => left.order - right.order);
}

export function placeholderFields(
  occurrences: readonly PlaceholderOccurrence[],
  values: ReadonlyMap<string, string>,
): PlaceholderField[] {
  const fieldsByKey = new Map<string, PlaceholderField>();
  for (const occurrence of occurrences) {
    const existing = fieldsByKey.get(occurrence.key);
    if (existing) {
      existing.occurrences += 1;
    } else {
      fieldsByKey.set(occurrence.key, {
        key: occurrence.key,
        label: occurrence.label,
        type: inferFieldType(`${occurrence.key} ${occurrence.label}`),
        required: true,
        occurrences: 1,
        value: values.get(occurrence.key) ?? null,
      });
    }
  }
  return [...fieldsByKey.values()];
}

export function buildPlaceholderEdits(
  occurrences: readonly PlaceholderOccurrence[],
  values: ReadonlyMap<string, string>,
) {
  return occurrences.flatMap((occurrence) => {
    const value = values.get(occurrence.key);
    if (value == null || !value.trim()) return [];
    return [
      {
        find: occurrence.token,
        replace: value,
        context_before: occurrence.paragraph.slice(
          Math.max(0, occurrence.matchIndex - 80),
          occurrence.matchIndex,
        ),
        context_after: occurrence.paragraph.slice(
          occurrence.matchIndex + occurrence.token.length,
          occurrence.matchIndex + occurrence.token.length + 80,
        ),
        reason: `Fill ${occurrence.label}`,
      },
    ];
  });
}

function editStatus(value: string | null): EditAnnotation["status"] {
  return value === "accepted" || value === "rejected" ? value : "pending";
}

function editAnnotationFromRow(row: EditRow): EditAnnotation {
  return {
    kind: "edit",
    edit_id: row.id,
    document_id: row.documentId,
    version_id: row.versionId ?? "",
    version_number: row.versionNumber,
    change_id: row.changeId,
    del_w_id: row.delWId ?? undefined,
    ins_w_id: row.insWId ?? undefined,
    deleted_text: row.deletedText ?? "",
    inserted_text: row.insertedText ?? "",
    context_before: row.contextBefore ?? "",
    context_after: row.contextAfter ?? "",
    reason: row.reason ?? undefined,
    status: editStatus(row.status),
  };
}

export class DocumentPlaceholdersService {
  constructor(readonly repository = new DocumentPlaceholdersRepository()) {}

  private async requireDocument(
    actor: RequestUserContext,
    documentId: string,
    action:
      "extract_placeholders" | "set_placeholder_value" | "fill_placeholders" | "read_document",
  ): Promise<PlaceholderDocument> {
    await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      action,
    );
    const document = await this.repository.findDocument(documentId);
    if (!document) throw new DocumentPlaceholdersError(404, "Document not found");
    if (document.fileType && document.fileType !== "docx" && document.fileType !== "doc") {
      throw new DocumentPlaceholdersError(
        400,
        "Placeholder fill is only available for DOCX documents",
      );
    }
    return document;
  }

  private async loadFields(documentId: string) {
    const active = await this.repository.findActiveVersion(documentId);
    if (!active) throw new DocumentPlaceholdersError(404, "No file available");
    const raw = await downloadFile(active.storagePath);
    if (!raw) throw new DocumentPlaceholdersError(404, "Document bytes not available");
    const text = await extractDocxBodyText(Buffer.from(raw));
    const occurrences = detectPlaceholderOccurrences(text);
    const values = await this.repository.valuesByKey(documentId);
    return {
      versionId: active.id,
      versionNumber: active.versionNumber ?? null,
      fields: placeholderFields(occurrences, values),
      occurrences,
      values,
    };
  }

  async get(actor: RequestUserContext, documentId: string) {
    await this.requireDocument(actor, documentId, "extract_placeholders");
    const snapshot = await this.loadFields(documentId);
    return {
      document_id: documentId,
      version_id: snapshot.versionId,
      version_number: snapshot.versionNumber,
      fields: snapshot.fields,
    };
  }

  async save(
    actor: RequestUserContext,
    documentId: string,
    deferredValues: DeferredPlaceholderValues,
  ) {
    const document = await this.requireDocument(actor, documentId, "set_placeholder_value");
    const current = await this.loadFields(document.id);
    const values = requirePlaceholderValues(deferredValues);
    const knownKeys = new Set(current.fields.map((field) => field.key));
    const filtered = Object.fromEntries(
      Object.entries(values).filter(([key]) => knownKeys.has(key)),
    );
    await this.repository.saveValues(document.id, actor.userId, filtered);
    await recordDocumentActivity(
      document.id,
      actor.userId,
      "placeholder_values_saved",
      { type: "document", id: document.id, name: document.filename },
      { fields: Object.keys(filtered) },
    );
    const next = await this.loadFields(document.id);
    return {
      document_id: document.id,
      version_id: next.versionId,
      version_number: next.versionNumber,
      fields: next.fields,
    };
  }

  async apply(actor: RequestUserContext, documentId: string) {
    const document = await this.requireDocument(actor, documentId, "fill_placeholders");
    const snapshot = await this.loadFields(document.id);
    const missing = snapshot.fields
      .filter((field) => !snapshot.values.get(field.key)?.trim())
      .map((field) => field.key);
    if (missing.length) return { kind: "missing" as const, missing };
    const edits = buildPlaceholderEdits(snapshot.occurrences, snapshot.values);
    if (!edits.length) return { kind: "empty" as const };
    const result = await runEditDocument({
      documentId: document.id,
      userId: actor.userId,
      edits,
    });
    if (!result.ok) return { kind: "failed" as const, detail: result.error };
    await recordDocumentActivity(
      document.id,
      actor.userId,
      "placeholder_changes_created",
      { type: "version", id: result.version_id, name: `V${result.version_number}` },
      { applied: result.annotations.length },
    );
    return {
      kind: "applied" as const,
      document_id: document.id,
      filename: document.filename,
      version_id: result.version_id,
      version_number: result.version_number,
      download_url: result.download_url,
      applied: result.annotations.length,
      errors: result.errors,
      annotations: result.annotations,
    };
  }

  async listEdits(actor: RequestUserContext, documentId: string, status: string | null) {
    const document = await this.requireDocument(actor, documentId, "read_document");
    return (await this.repository.listEdits(document.id, status)).map(editAnnotationFromRow);
  }
}
