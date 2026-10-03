import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, documentEmailEvents } from "../db/index.js";
import {
  emailEventFields,
  isRetryable,
  sendTemplateEmail,
  type TemplateEmailInput,
} from "../lib/email.js";
import { cleanupOldHealthChecks, runAllHealthChecks } from "../lib/healthCheck.js";
import type { MailSendResult } from "../mail/types.js";
import { indexRetrievalSource } from "../modules/retrieval/retrieval.indexing.js";
import type { RetrievalIndexInput } from "../modules/retrieval/retrieval.types.js";
import { createProductionComplianceJobHandler } from "../modules/compliance/compliance.composition.js";
import { DocumentsRepository } from "../modules/documents/documents.repository.js";
import {
  DriveStorageReconciler,
  DrizzleDriveStorageOperationRepository,
} from "../modules/drive/drive.reconciliation.js";
import { createProductionTabularJobHandler } from "../modules/tabular/tabular.composition.js";
import { ObjectNotFoundError, parseObjectRef, type ObjectStore } from "../storage/types.js";
import type { ClaimedJob, ClaimedOutboxEvent, WorkHandlers, WorkOutcome } from "./types.js";

const nullableString = z.string().nullable().optional();
const ragPayloadSchema = z.object({
  scope: z.object({
    type: z.enum(["personal", "project", "workspace"]),
    id: z.string().uuid(),
    name: z.string(),
    ownerUserId: nullableString,
  }),
  sourceType: z.enum(["document", "drive_file"]),
  sourceId: z.string().uuid(),
  versionId: z.string().uuid(),
  userId: z.string().uuid(),
  projectId: nullableString,
  workspaceId: nullableString,
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  storagePath: z.string().min(1),
  checksum: nullableString,
});

const emailDataSchema = z.object({
  subject: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  otp: z.string().optional(),
  actionUrl: z.string().optional(),
  recipientName: nullableString,
  senderName: nullableString,
  documentName: nullableString,
  summary: z.array(z.string()).nullable().optional(),
  projectName: nullableString,
  workspaceName: nullableString,
  workflowName: nullableString,
  role: nullableString,
  note: nullableString,
  expiresAt: z.union([z.string(), z.date()]).nullable().optional(),
});

const queuedEmailSchema = z.object({
  providerIdempotencyKey: z.string().min(1),
  email: z.object({
    to: z.union([z.string(), z.array(z.string())]),
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
    replyTo: z.string().optional(),
    from: z.string().optional(),
    template: z.string().min(1),
    data: emailDataSchema,
    category: z.enum(["transactional", "collaboration", "security"]).optional(),
  }),
  tracking: z
    .object({
      documentEmailEventId: z.string().uuid(),
      documentId: z.string().uuid(),
      triggerType: z.string().min(1),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

const cleanupPayloadSchema = z.object({
  retentionDays: z.number().int().positive(),
});
const objectPathSchema = z
  .string()
  .min(1)
  .refine((path) => {
    try {
      parseObjectRef(path);
      return true;
    } catch {
      return false;
    }
  });
const documentArtifactCleanupPayloadSchema = z
  .object({
    operationId: z.string().uuid(),
    documentId: z.string().uuid(),
    paths: z.array(objectPathSchema).min(1).max(8),
  })
  .strict();

function ragInput(payload: ClaimedJob["payload"]): RetrievalIndexInput | null {
  const result = ragPayloadSchema.safeParse(payload);
  if (!result.success) return null;
  const parsed = result.data;
  return {
    scope: {
      type: parsed.scope.type,
      id: parsed.scope.id,
      name: parsed.scope.name,
      ownerUserId: parsed.scope.ownerUserId,
    },
    sourceType: parsed.sourceType,
    sourceId: parsed.sourceId,
    versionId: parsed.versionId,
    userId: parsed.userId,
    projectId: parsed.projectId,
    workspaceId: parsed.workspaceId,
    filename: parsed.filename,
    mimeType: parsed.mimeType,
    storagePath: parsed.storagePath,
    checksum: parsed.checksum,
  };
}

async function handleRag(claim: ClaimedJob, signal: AbortSignal): Promise<WorkOutcome> {
  if (signal.aborted) return { kind: "retry", error: "Worker is shutting down" };
  const input = ragInput(claim.payload);
  if (!input) return { kind: "failed", error: "Invalid RAG job payload" };
  const result = await indexRetrievalSource(input, signal);
  if (result.status !== "failed") return { kind: "succeeded" };
  return result.retryable
    ? {
        kind: "retry",
        error: result.lastError ?? "RAG indexing failed",
        retryAfterMs: result.retryAfterSeconds ? result.retryAfterSeconds * 1_000 : undefined,
      }
    : { kind: "failed", error: result.lastError ?? "RAG indexing failed" };
}

async function recordTrackedEmail(
  tracking: NonNullable<z.infer<typeof queuedEmailSchema>["tracking"]>,
  claim: ClaimedOutboxEvent,
  result: MailSendResult,
): Promise<void> {
  const terminal =
    result.status !== "failed" ||
    !isRetryable(result.failure) ||
    claim.attemptNumber >= claim.maxAttempts;
  if (!terminal) return;
  const { suppressed, ...record } = emailEventFields(result);
  await db
    .update(documentEmailEvents)
    .set({
      status: result.status,
      ...record,
      retryCount: claim.attemptNumber,
      updatedAt: new Date(),
      metadata: {
        ...(tracking.metadata ?? {}),
        suppressed,
      },
    })
    .where(eq(documentEmailEvents.id, tracking.documentEmailEventId));
}

async function handleEmail(claim: ClaimedOutboxEvent, signal: AbortSignal): Promise<WorkOutcome> {
  if (signal.aborted) return { kind: "retry", error: "Worker is shutting down" };
  const parsed = queuedEmailSchema.safeParse(claim.payload);
  if (!parsed.success) return { kind: "failed", error: "Invalid email outbox payload" };
  const payload = parsed.data;
  const input: TemplateEmailInput = {
    ...payload.email,
    idempotencyKey: payload.providerIdempotencyKey,
  };
  const result = await sendTemplateEmail(input);
  if (payload.tracking) await recordTrackedEmail(payload.tracking, claim, result);
  if (result.status !== "failed") return { kind: "succeeded" };
  return isRetryable(result.failure)
    ? { kind: "retry", error: result.failure.message }
    : { kind: "failed", error: result.failure.message };
}

async function handleDocumentArtifactCleanup(
  claim: ClaimedJob,
  signal: AbortSignal,
  objectStore: ObjectStore,
  references: Pick<DocumentsRepository, "isArtifactPathReferenced">,
): Promise<WorkOutcome> {
  if (signal.aborted) return { kind: "retry", error: "Worker is shutting down" };
  const parsed = documentArtifactCleanupPayloadSchema.safeParse(claim.payload);
  if (!parsed.success) {
    return { kind: "failed", error: "Invalid document artifact cleanup payload" };
  }
  let failureCount = 0;
  for (const path of parsed.data.paths) {
    if (signal.aborted) return { kind: "retry", error: "Worker is shutting down" };
    try {
      if (await references.isArtifactPathReferenced(path)) continue;
    } catch {
      failureCount += 1;
      continue;
    }
    try {
      await objectStore.delete(parseObjectRef(path));
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) failureCount += 1;
    }
  }
  if (failureCount > 0) {
    return {
      kind: "retry",
      error: `Document artifact cleanup failed for ${failureCount} object${
        failureCount === 1 ? "" : "s"
      }`,
    };
  }
  return { kind: "succeeded" };
}

export function createWorkHandlers(
  objectStore: ObjectStore,
  documentRepository: Pick<
    DocumentsRepository,
    "isArtifactPathReferenced"
  > = new DocumentsRepository(),
): WorkHandlers {
  const complianceRun = createProductionComplianceJobHandler();
  const tabularRun = createProductionTabularJobHandler();
  const driveStorageReconciler = new DriveStorageReconciler(
    new DrizzleDriveStorageOperationRepository(db),
    objectStore,
  );
  return {
    jobs: {
      "compliance.run": complianceRun,
      "tabular.generate": tabularRun,
      "rag.index": handleRag,
      "document.artifact.cleanup": (claim, signal) =>
        handleDocumentArtifactCleanup(claim, signal, objectStore, documentRepository),
      "drive.storage.reconcile": async (_claim, signal) => {
        if (signal.aborted) return { kind: "retry", error: "Worker is shutting down" };
        for (let processed = 0; processed < 100 && !signal.aborted; processed += 1) {
          if (!(await driveStorageReconciler.runOne())) break;
        }
        if (signal.aborted) return { kind: "retry", error: "Worker is shutting down" };
        return { kind: "succeeded" };
      },
      "health.check": async (_claim, signal) => {
        if (signal.aborted) return { kind: "retry", error: "Worker is shutting down" };
        await runAllHealthChecks();
        return { kind: "succeeded" };
      },
      "health.cleanup": async (claim, signal) => {
        if (signal.aborted) return { kind: "retry", error: "Worker is shutting down" };
        const parsed = cleanupPayloadSchema.safeParse(claim.payload);
        if (!parsed.success) return { kind: "failed", error: "Invalid health cleanup payload" };
        const payload = parsed.data;
        await cleanupOldHealthChecks(payload.retentionDays);
        return { kind: "succeeded" };
      },
    },
    outbox: {
      "email.template": handleEmail,
    },
  };
}
