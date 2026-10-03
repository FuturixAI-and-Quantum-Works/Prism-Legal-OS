import { accessAuthority } from "../access/access.composition.js";
import { RETRIEVAL_DISABLED_MESSAGE } from "./retrieval.config.js";
import { retrievalProvider } from "./retrieval.composition.js";
import { retrievalRepository } from "./retrieval.repository.js";
import { unsupportedRetrievalReason } from "./retrieval.source-format.js";
import type { RetrievalActor, RetrievalScope } from "./retrieval.types.js";

export function scopeForRecord(input: {
  userId: string;
  projectId?: string | null;
  workspaceId?: string | null;
  scopeName?: string | null;
}): RetrievalScope {
  if (input.workspaceId) {
    return {
      type: "workspace",
      id: input.workspaceId,
      name: input.scopeName || `workspace_${input.workspaceId}`,
      ownerUserId: input.userId,
    };
  }
  if (input.projectId) {
    return {
      type: "project",
      id: input.projectId,
      name: input.scopeName || `project_${input.projectId}`,
      ownerUserId: input.userId,
    };
  }
  return {
    type: "personal",
    id: input.userId,
    name: "personal_sources",
    ownerUserId: input.userId,
  };
}

export async function accessibleRetrievalScopes(actor: RetrievalActor) {
  const accessActor = {
    userId: actor.userId,
    email: actor.userEmail?.toLowerCase() ?? "",
  };
  const [projectGrants, workspaceGrants] = await Promise.all([
    accessAuthority.grants.listProjectGrants(accessActor),
    accessAuthority.grants.listWorkspaceGrants(accessActor),
  ]);
  return {
    projectIds: [...projectGrants.keys()],
    workspaceIds: [...workspaceGrants.keys()],
  };
}

async function resolveSearchScope(
  actor: RetrievalActor,
  input: Readonly<{ projectId?: string | null; workspaceId?: string | null }>,
): Promise<RetrievalScope | null> {
  const accessActor = {
    userId: actor.userId,
    email: actor.userEmail?.toLowerCase() ?? "",
  };
  if (input.workspaceId) {
    const decision = await accessAuthority.decide({
      actor: accessActor,
      resource: { kind: "workspace", id: input.workspaceId },
      action: "read",
    });
    return decision.allowed
      ? retrievalRepository.findWorkspaceScope(input.workspaceId, actor.userId)
      : null;
  }
  if (input.projectId) {
    const decision = await accessAuthority.decide({
      actor: accessActor,
      resource: { kind: "project", id: input.projectId },
      action: "read",
    });
    return decision.allowed
      ? retrievalRepository.findProjectScope(input.projectId, actor.userId)
      : null;
  }
  return scopeForRecord({ userId: actor.userId });
}

export async function searchRetrievalSources(input: {
  userId: string;
  userEmail?: string | null;
  projectId?: string | null;
  workspaceId?: string | null;
  query: string;
  topK?: number;
  signal?: AbortSignal;
}) {
  if (!retrievalProvider.isConfigured) {
    return {
      ok: false,
      disabled: true,
      code: "rag_disabled",
      error: RETRIEVAL_DISABLED_MESSAGE,
      query: input.query,
      scope: null,
      results: [],
      count: 0,
    };
  }

  const scope = await resolveSearchScope(input, input);
  if (!scope) {
    return {
      ok: false,
      error: "No accessible source index is available for this chat.",
      query: input.query,
      scope: null,
      results: [],
      count: 0,
    };
  }

  const collection = await retrievalRepository.findCollection(scope);
  if (!collection) {
    return {
      ok: true,
      message: "This scope does not have an indexed source collection yet.",
      query: input.query,
      scope,
      results: [],
      count: 0,
    };
  }

  const query = input.query.trim();
  const results = await retrievalProvider.queryCollection(
    collection.collectionName,
    query,
    input.topK ?? 8,
    input.signal,
  );
  const entries = await retrievalRepository.findScopeEntriesByVersionIds(
    scope,
    results.map((result) => result.document_id).filter(Boolean),
  );
  const entryByVersion = new Map(entries.map((entry) => [entry.versionId, entry]));
  return {
    ok: true,
    query,
    scope,
    results: results.map((result) => {
      const entry = entryByVersion.get(result.document_id);
      const metadataUrl = result.metadata?.document_url;
      return {
        rank: result.rank,
        source_id: entry?.sourceId ?? null,
        source_type: entry?.sourceType ?? null,
        version_id: result.document_id,
        filename:
          entry?.filename || result.document_name || String(result.metadata?.filename ?? "Source"),
        mime_type: entry?.mimeType ?? null,
        page_number: result.page_number ?? null,
        text: result.text ?? "",
        document_context: result.document_context ?? null,
        score: result.combined_score ?? result.vector_score ?? result.bm25_score ?? null,
        document_url: result.document_url ?? (typeof metadataUrl === "string" ? metadataUrl : null),
      };
    }),
    count: results.length,
  };
}

export async function listRetrievalSourcesForUser(userId: string, userEmail?: string | null) {
  const { projectIds, workspaceIds } = await accessibleRetrievalScopes({ userId, userEmail });
  const rows = await retrievalRepository.listAccessibleSources(userId, projectIds, workspaceIds);
  return rows.map((row) => {
    const unsupported = unsupportedRetrievalReason(row.entry.filename, row.entry.mimeType);
    return {
      id: row.entry.id,
      collection_id: row.entry.collectionId,
      collection_name: row.collectionName,
      collection_display_name: row.collectionDisplayName,
      scope_type: row.entry.scopeType,
      scope_id: row.entry.scopeId,
      source_type: row.entry.sourceType,
      source_id: row.entry.sourceId,
      version_id: row.entry.versionId,
      project_id: row.entry.projectId,
      workspace_id: row.entry.workspaceId,
      filename: row.entry.filename,
      mime_type: row.entry.mimeType,
      storage_path: row.entry.storagePath,
      status: unsupported ? "skipped_unsupported" : row.entry.status,
      last_error: unsupported ?? row.entry.lastError,
      last_error_code: unsupported ? "unsupported_file_format" : (row.entry.lastErrorCode ?? null),
      last_error_category: unsupported ? "source_format" : (row.entry.lastErrorCategory ?? null),
      last_error_details: unsupported
        ? { filename: row.entry.filename, mime_type: row.entry.mimeType }
        : (row.entry.lastErrorDetails ?? null),
      retryable: unsupported ? false : row.entry.retryable,
      retry_after_seconds: unsupported ? null : row.entry.retryAfterSeconds,
      indexed_at: row.entry.indexedAt,
      updated_at: row.entry.updatedAt,
      created_at: row.entry.createdAt,
    };
  });
}
