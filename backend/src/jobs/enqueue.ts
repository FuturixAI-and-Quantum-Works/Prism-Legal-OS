import { z } from "zod";
import type { TemplateEmailInput } from "../lib/email.js";
import type { DocumentArtifactCleanupRequest } from "../modules/documents/documents.artifacts.js";
import type { RetrievalIndexInput } from "../modules/retrieval/retrieval.types.js";
import { getQueueRepository } from "./repository.js";
import type { JobPayload, JsonValue } from "./types.js";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const payloadSchema = z.record(z.string(), jsonValueSchema);

function serializePayload(value: object): JobPayload {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  return payloadSchema.parse(parsed);
}

export type QueuedTemplateEmailInput = Omit<
  TemplateEmailInput,
  "attachments" | "idempotencyKey" | "maxAttempts"
>;

export type EmailTracking = Readonly<{
  documentEmailEventId: string;
  documentId: string;
  triggerType: string;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export async function enqueueRagIndex(
  input: RetrievalIndexInput,
  idempotencyKey = `rag-index:v2:${input.sourceType}:${input.sourceId}:${input.versionId}`,
): Promise<string> {
  return getQueueRepository().enqueueJob({
    kind: "rag.index",
    payload: serializePayload(input),
    idempotencyKey,
    actorUserId: input.userId,
    maxAttempts: 5,
  });
}

export async function enqueueDocumentArtifactCleanup(
  input: DocumentArtifactCleanupRequest,
): Promise<string> {
  return getQueueRepository().enqueueJob({
    kind: "document.artifact.cleanup",
    payload: serializePayload({
      operationId: input.operationId,
      documentId: input.documentId,
      paths: input.paths,
    }),
    idempotencyKey: `document-artifact-cleanup:${input.operationId}`,
    maxAttempts: 5,
    availableAt: new Date(Date.now() + Math.max(0, input.delayMs)),
  });
}

export async function enqueueTemplateEmail(input: {
  email: QueuedTemplateEmailInput;
  idempotencyKey: string;
  aggregateType: string;
  aggregateId?: string | null;
  tracking?: EmailTracking;
  maxAttempts?: number;
}): Promise<string> {
  return getQueueRepository().enqueueOutbox({
    topic: "email.template",
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payload: serializePayload({
      providerIdempotencyKey: input.idempotencyKey,
      email: input.email,
      tracking: input.tracking,
    }),
    idempotencyKey: input.idempotencyKey,
    maxAttempts: input.maxAttempts ?? 3,
  });
}
