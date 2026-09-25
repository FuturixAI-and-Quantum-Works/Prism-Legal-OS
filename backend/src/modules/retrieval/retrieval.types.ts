export type RetrievalScopeType = "personal" | "project" | "workspace";
export type RetrievalSourceType = "document" | "drive_file";
export type RetrievalSourceStatus = "pending" | "indexed" | "failed" | "skipped_unsupported";

export type RetrievalScope = Readonly<{
  type: RetrievalScopeType;
  id: string;
  name: string;
  ownerUserId?: string | null;
}>;

export type RetrievalIndexInput = Readonly<{
  scope: RetrievalScope;
  sourceType: RetrievalSourceType;
  sourceId: string;
  versionId: string;
  userId: string;
  projectId?: string | null;
  workspaceId?: string | null;
  filename: string;
  mimeType: string;
  storagePath: string;
  checksum?: string | null;
}>;

export type RetrievalIndexSkippedResult = Readonly<{
  status: "skipped_disabled";
  reason: "rag_disabled";
}>;

export type RetrievalSearchResult = Readonly<{
  rank: number;
  document_name?: string;
  document_id: string;
  page_number?: number;
  text?: string;
  document_context?: string;
  vector_score?: number;
  bm25_score?: number;
  combined_score?: number;
  metadata?: Record<string, unknown>;
  document_url?: string;
}>;

export type NormalizedRetrievalError = Readonly<{
  summary: string;
  code: string | null;
  category: string | null;
  retryable: boolean;
  retryAfterSeconds: number | null;
  details: Record<string, unknown>;
}>;

export type RetrievalActor = Readonly<{
  userId: string;
  userEmail?: string | null;
}>;
