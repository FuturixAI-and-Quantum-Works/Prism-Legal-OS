import type { TabularGenerateEvent } from "@prism/protocol";

export type TabularActor = Readonly<{ userId: string; email: string }>;

export type TabularColumn = Readonly<{
  index: number;
  name: string;
  prompt: string;
  format?: string;
  tags?: readonly string[];
}>;

export type TabularReview = Readonly<{
  id: string;
  userId: string;
  projectId: string | null;
  title: string | null;
  columnsConfig: unknown;
}>;

export type TabularDocument = Readonly<{
  id: string;
  userId: string;
  projectId: string | null;
  filename: string;
  fileType: string | null;
}>;

export type TabularCell = Readonly<{
  id: string;
  reviewId: string;
  documentId: string;
  columnIndex: number;
  content: unknown;
  status: string | null;
  activeRunId: string | null;
  activeRunEpoch: number | null;
}>;

export type TabularCellResult = Readonly<{
  summary: string;
  flag: "green" | "grey" | "yellow" | "red";
  reasoning: string;
}>;

export type TabularRunOperation = "generate" | "regenerate-cell";

export type TabularGenerateRequest = Readonly<{
  operation: "generate";
  sourceDocumentIds: readonly string[];
  columns: readonly TabularColumn[];
  targets: readonly Readonly<{ documentId: string; columnIndexes: readonly number[] }>[];
  requestedModel: string | null;
}>;

export type TabularRegenerateRequest = Readonly<{
  operation: "regenerate-cell";
  sourceDocumentIds: readonly string[];
  documentId: string;
  column: TabularColumn;
  requestedModel: string | null;
}>;

export type TabularRunRequest = TabularGenerateRequest | TabularRegenerateRequest;

export type TabularRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type TabularRun = Readonly<{
  id: string;
  reviewId: string;
  userId: string;
  jobId: string | null;
  idempotencyKey: string;
  operation: TabularRunOperation;
  request: TabularRunRequest;
  requestHash: string;
  status: TabularRunStatus;
  error: string | null;
  executionEpoch: number;
  nextSequence: number;
  usedModelCalls: number;
  usedOutputTokens: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
}>;

export type PersistedTabularEvent = Exclude<
  TabularGenerateEvent,
  { type: "done" } | { type: "error" }
>;

export type TabularCellErrorKind = "extraction" | "unsupported-inline-pdf" | "missing-model-result";

export type TabularRunEventRecord = Readonly<{
  sequence: number;
  event: PersistedTabularEvent;
  errorKind: TabularCellErrorKind | null;
}>;

export class TabularError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TabularError";
  }
}

export class TabularRunConflictError extends Error {
  constructor() {
    super("Idempotency key was already used for a different request");
    this.name = "TabularRunConflictError";
  }
}

export class TabularActiveRunConflictError extends Error {
  constructor() {
    super("Another tabular run is already active for this review");
    this.name = "TabularActiveRunConflictError";
  }
}
