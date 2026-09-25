import crypto from "node:crypto";
import { enqueueRagIndex } from "../../jobs/enqueue.js";
import { downloadFile } from "../../lib/storage.js";
import { normalizeRetrievalError } from "./retrieval.config.js";
import { retrievalProvider } from "./retrieval.composition.js";
import {
  accessibleRetrievalScopes,
  listRetrievalSourcesForUser,
  scopeForRecord,
} from "./retrieval.query.js";
import { retrievalRepository } from "./retrieval.repository.js";
import { mimeTypeForDocument, unsupportedRetrievalReason } from "./retrieval.source-format.js";
import type {
  RetrievalIndexInput,
  RetrievalIndexSkippedResult,
  RetrievalScope,
  RetrievalSourceStatus,
} from "./retrieval.types.js";

export function checksumBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function ensureCollection(scope: RetrievalScope, signal?: AbortSignal) {
  const collectionName = await retrievalProvider.createCollection(scope, signal);
  return retrievalRepository.upsertCollection(scope, collectionName);
}

export async function indexRetrievalSource(input: RetrievalIndexInput, signal?: AbortSignal) {
  if (!retrievalProvider.isConfigured) {
    return {
      status: "skipped_disabled",
      reason: "rag_disabled",
    } satisfies RetrievalIndexSkippedResult;
  }

  const unsupported = unsupportedRetrievalReason(input.filename, input.mimeType);
  const status: RetrievalSourceStatus = unsupported ? "skipped_unsupported" : "pending";
  const collection = unsupported ? null : await ensureCollection(input.scope, signal);
  const entry = await retrievalRepository.upsertSource(
    input,
    collection?.id ?? null,
    status,
    unsupported,
  );
  if (unsupported || !collection) return entry;

  try {
    const bytes = await downloadFile(input.storagePath);
    if (!bytes) throw new Error("RAG source file is missing from storage");
    await retrievalProvider.ingestDocument(
      collection.collectionName,
      input.versionId,
      { bytes: Buffer.from(bytes), filename: input.filename, mimeType: input.mimeType },
      signal,
    );
    return retrievalRepository.markIndexed(entry.id, collection.id);
  } catch (error) {
    const normalized = normalizeRetrievalError(error, "RAG ingest");
    const failedStatus =
      normalized.code === "unsupported_file_format" ? "skipped_unsupported" : "failed";
    return retrievalRepository.markFailed(entry.id, failedStatus, normalized);
  }
}

export async function queueDocumentVersionIndex(
  documentId: string,
  versionId: string,
  userId: string,
  checksum?: string | null,
): Promise<void> {
  if (!retrievalProvider.isConfigured) return;
  const row = await retrievalRepository.findDocumentVersion(documentId, versionId);
  if (!row) return;
  await enqueueRagIndex({
    scope: scopeForRecord({
      userId: row.userId,
      projectId: row.projectId,
      workspaceId: row.workspaceId,
    }),
    sourceType: "document",
    sourceId: row.id,
    versionId,
    userId,
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    filename: row.filename,
    mimeType: mimeTypeForDocument(row.filename, row.fileType),
    storagePath: row.storagePath,
    checksum,
  });
}

export async function queueDriveFileVersionIndex(
  fileId: string,
  versionId: string,
  userId: string,
  checksum?: string | null,
): Promise<void> {
  if (!retrievalProvider.isConfigured) return;
  const row = await retrievalRepository.findDriveFileVersion(fileId, versionId);
  if (!row) return;
  await enqueueRagIndex({
    scope: scopeForRecord({ userId: row.userId, workspaceId: row.workspaceId }),
    sourceType: "drive_file",
    sourceId: row.id,
    versionId,
    userId,
    workspaceId: row.workspaceId,
    filename: row.name,
    mimeType: row.mimeType,
    storagePath: row.storagePath,
    checksum: checksum ?? row.checksum,
  });
}

export async function retryRetrievalSource(
  sourceEntryId: string,
  userId: string,
  userEmail?: string | null,
) {
  const allowed = await listRetrievalSourcesForUser(userId, userEmail);
  const source = allowed.find((entry) => entry.id === sourceEntryId);
  if (!source) throw Object.assign(new Error("Source not found"), { statusCode: 404 });
  await enqueueRagIndex(
    {
      scope: {
        type: source.scope_type,
        id: source.scope_id,
        name: source.collection_display_name || source.scope_type,
        ownerUserId: userId,
      },
      sourceType: source.source_type,
      sourceId: source.source_id,
      versionId: source.version_id,
      userId,
      projectId: source.project_id,
      workspaceId: source.workspace_id,
      filename: source.filename,
      mimeType: source.mime_type,
      storagePath: source.storage_path,
    },
    `rag-index-retry:${source.id}:${source.updated_at.toISOString()}`,
  );
  return (await listRetrievalSourcesForUser(userId, userEmail)).find(
    (entry) => entry.id === sourceEntryId,
  );
}

export async function backfillRetrievalSources(userId: string, userEmail?: string | null) {
  if (!retrievalProvider.isConfigured) {
    return { queued: 0, documents: 0, drive_files: 0, skipped: "rag_disabled" as const };
  }
  const { projectIds, workspaceIds } = await accessibleRetrievalScopes({ userId, userEmail });
  const [documents, files] = await Promise.all([
    retrievalRepository.listBackfillDocuments(projectIds, workspaceIds, userId),
    retrievalRepository.listBackfillDriveFiles(workspaceIds, userId),
  ]);
  await Promise.all([
    ...documents.map((document) =>
      enqueueRagIndex({
        scope: scopeForRecord({
          userId: document.userId,
          projectId: document.projectId,
          workspaceId: document.workspaceId,
        }),
        sourceType: "document",
        sourceId: document.id,
        versionId: document.versionId,
        userId,
        projectId: document.projectId,
        workspaceId: document.workspaceId,
        filename: document.filename,
        mimeType: mimeTypeForDocument(document.filename, document.fileType),
        storagePath: document.storagePath,
      }),
    ),
    ...files.map((file) =>
      enqueueRagIndex({
        scope: scopeForRecord({ userId: file.userId, workspaceId: file.workspaceId }),
        sourceType: "drive_file",
        sourceId: file.id,
        versionId: file.versionId,
        userId,
        workspaceId: file.workspaceId,
        filename: file.name,
        mimeType: file.mimeType,
        storagePath: file.storagePath,
        checksum: file.checksum,
      }),
    ),
  ]);
  return {
    queued: documents.length + files.length,
    documents: documents.length,
    drive_files: files.length,
  };
}
