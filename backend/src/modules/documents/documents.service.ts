import { randomUUID } from "node:crypto";
import { accessAuthority } from "../access/access.composition.js";
import type {
  DocumentConversionKind,
  DocumentConversionRequest,
  DocumentConverter,
} from "../../lib/documentConverter.js";
import {
  assertDocumentActionAllowed,
  ensureDrafterMembership,
} from "./documents.permissions.service.js";
import { buildPreviewSummary } from "../../lib/previewSummary.js";
import { checksumBuffer, queueDocumentVersionIndex } from "../retrieval/retrieval.indexing.js";
import {
  buildContentDisposition,
  deleteFile,
  downloadFile,
  getSignedUrl,
} from "../../lib/storage.js";
import { renderDocxPreviewHtml } from "../../lib/docxTemplateAnalyzer.js";
import { extractTrackedChangeIds } from "../../lib/docxTrackedChangesXml.js";
import { createInitialDocxBuffer } from "./documents.docx.js";
import { decodeDocumentContent } from "../content/documentContent.js";
import { recordDocumentActivity } from "./documents.activity.service.js";
import {
  DocumentArtifactWriter,
  documentContentType,
  type PdfRenditionOutcome,
} from "./documents.artifacts.js";
import { extractDocumentMetadata } from "./documents.metadata.js";
import type {
  CreateBlankDocumentInput,
  CreateDocumentFromBufferInput,
  DocumentDto,
  DocumentListQuery,
  DocumentRow,
  RequestUserContext,
  UpdateDocumentInput,
  UploadDocumentInput,
} from "./documents.models.js";
import { type DocumentVersionRecord, DocumentsRepository } from "./documents.repository.js";
import {
  assertAllowedDocumentType,
  documentExtension,
  normalizeDocumentFilename,
  normalizeRenameFilename,
} from "./documents.validators.js";
import {
  generateDocumentZip,
  prepareDocumentZip,
  type DocumentZipFailure,
  type DocumentZipRequest,
  type DocumentZipResult,
  type ResolvedDocumentZipOccurrence,
} from "./documents.zip.js";

export type {
  DocumentZipFailure,
  DocumentZipFailureReason,
  DocumentZipMode,
  DocumentZipOutcome,
  DocumentZipRequest,
  DocumentZipResult,
} from "./documents.zip.js";

export class DocumentServiceError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentServiceError";
  }
}

export class DocumentConversionError extends DocumentServiceError {
  constructor(message: string, options?: ErrorOptions) {
    super(500, message, options);
    this.name = "DocumentConversionError";
  }
}

export class DocumentZipAtomicError extends DocumentServiceError {
  constructor(readonly failures: readonly DocumentZipFailure[]) {
    super(422, "Document archive could not be created");
    this.name = "DocumentZipAtomicError";
  }
}

export type DocumentConversionPort = Pick<DocumentConverter, "capabilities" | "convert">;
export type DocumentCreator = Pick<DocumentsService, "createBlank" | "createFromBuffer">;

export class MissingDocumentConversionCapabilityError extends Error {
  constructor(readonly capability: DocumentConversionKind) {
    super(`Document converter does not support ${capability}`);
    this.name = "MissingDocumentConversionCapabilityError";
  }
}

const requiredConversionCapabilities = [
  "doc-to-pdf",
  "docx-to-pdf",
  "html-to-pdf",
] as const satisfies readonly DocumentConversionKind[];
const neverAborted = new AbortController().signal;

function versionFilename(
  originalFilename: string,
  displayName: string | null | undefined,
  versionNumber: number | null,
): string {
  const originalDot = originalFilename.lastIndexOf(".");
  const extension = originalDot > 0 ? originalFilename.slice(originalDot) : "";
  if (displayName?.trim()) {
    const name = displayName.trim();
    return /\.[a-z0-9]{1,6}$/i.test(name) ? name : `${name}${extension}`;
  }
  if (!versionNumber || versionNumber < 1) return originalFilename;
  const stem = originalDot > 0 ? originalFilename.slice(0, originalDot) : originalFilename;
  return `${stem} [Edited V${versionNumber}]${extension || ".docx"}`;
}

function versionDto(version: DocumentVersionRecord) {
  return {
    id: version.id,
    version_number: version.versionNumber,
    source: version.source,
    created_at: version.createdAt,
    display_name: version.displayName,
  };
}

function storedPdfPath(rendition: PdfRenditionOutcome): string | null {
  switch (rendition.kind) {
    case "source-pdf":
    case "converted":
      return rendition.path;
    case "not-supported":
    case "degraded":
      return null;
    default: {
      const unsupported: never = rendition;
      return unsupported;
    }
  }
}

export function toDocumentDto(doc: DocumentRow, extra: Partial<DocumentDto> = {}): DocumentDto {
  return {
    id: doc.id,
    project_id: doc.projectId,
    workspace_id: doc.workspaceId,
    user_id: doc.userId,
    folder_id: doc.folderId,
    filename: doc.filename,
    file_type: doc.fileType,
    size_bytes: doc.sizeBytes,
    page_count: doc.pageCount,
    structure_tree: doc.structureTree,
    status: doc.status,
    lifecycle_status: doc.lifecycleStatus,
    current_version_id: doc.currentVersionId,
    attached: doc.attached,
    is_primary: doc.isPrimary,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    ...extra,
  };
}

export class DocumentsService {
  constructor(
    readonly repository: DocumentsRepository,
    private readonly converter: DocumentConversionPort,
    private readonly artifacts: DocumentArtifactWriter,
  ) {
    for (const capability of requiredConversionCapabilities) {
      if (!converter.capabilities.conversions.includes(capability)) {
        throw new MissingDocumentConversionCapabilityError(capability);
      }
    }
  }

  private convert(request: DocumentConversionRequest): Promise<Buffer> {
    return this.converter.convert(request, neverAborted);
  }

  private async assertProject(
    projectId: string | null | undefined,
    actor: RequestUserContext,
    write = false,
  ): Promise<void> {
    if (!projectId) return;
    const decision = await accessAuthority.decide({
      actor: { userId: actor.userId, email: actor.userEmail?.toLowerCase() ?? "" },
      resource: { kind: "project", id: projectId },
      action: write ? "write" : "read",
    });
    if (decision.allowed) return;
    if (decision.reason === "not-found") throw new DocumentServiceError(404, "Project not found");
    throw new DocumentServiceError(403, "You do not have permission to modify this project");
  }

  private async assertWorkspace(
    workspaceId: string | null | undefined,
    actor: RequestUserContext,
    write = false,
  ) {
    if (!workspaceId) return;
    const decision = await accessAuthority.decide({
      actor: { userId: actor.userId, email: actor.userEmail?.toLowerCase() ?? "" },
      resource: { kind: "workspace", id: workspaceId },
      action: write ? "write" : "read",
    });
    if (!decision.allowed) {
      throw new DocumentServiceError(
        decision.reason === "not-found" ? 404 : 403,
        "Workspace not found or access denied",
      );
    }
  }

  private async assertFolder(projectId?: string | null, folderId?: string | null) {
    if (folderId == null) return;
    if (!projectId) throw new DocumentServiceError(400, "folder_id requires project_id");
    if (!(await this.repository.findProjectFolder(projectId, folderId))) {
      throw new DocumentServiceError(404, "Folder not found");
    }
  }

  private async requireDocument(
    actor: RequestUserContext,
    documentId: string,
    action:
      | "read_document"
      | "edit_document"
      | "export_document"
      | "delete_document"
      | "update_document"
      | "assign_document_role",
  ): Promise<DocumentRow> {
    const document = await this.repository.findDocumentById(documentId);
    if (!document) throw new DocumentServiceError(404, "Document not found");
    await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      action,
    );
    return document;
  }

  async list(actor: RequestUserContext, query: DocumentListQuery): Promise<DocumentDto[]> {
    let rows: DocumentRow[];
    if (query.projectId) {
      await this.assertProject(query.projectId, actor);
      rows = await this.repository.listProjectDocuments(query.projectId);
    } else if (query.workspaceId) {
      await this.assertWorkspace(query.workspaceId, actor);
      rows = await this.repository.listWorkspaceDocuments(query.workspaceId);
    } else {
      const documentIds = [
        ...(
          await accessAuthority.grants.listDocumentGrants({
            userId: actor.userId,
            email: actor.userEmail?.toLowerCase() ?? "",
          })
        ).keys(),
      ];
      rows = await this.repository.listAccessibleDocuments(documentIds);
    }
    return Promise.all(
      rows.map(async (row) => {
        const versions = await this.repository.listVersions(row.id);
        const active = versions.find(({ id }) => id === row.currentVersionId);
        return toDocumentDto(row, {
          storage_path: active?.storagePath ?? null,
          pdf_storage_path: active?.pdfStoragePath ?? null,
          latest_version_number: versions.at(-1)?.versionNumber ?? null,
          active_version_number: active?.versionNumber ?? null,
        });
      }),
    );
  }

  async createBlank(
    actor: RequestUserContext,
    input: CreateBlankDocumentInput,
  ): Promise<DocumentDto> {
    const filename = normalizeDocumentFilename(input.filename ?? input.name);
    const buffer = await createInitialDocxBuffer(
      filename,
      input.contentHtml ? { kind: "html", value: input.contentHtml } : undefined,
    );
    return this.createFromBytes(actor, {
      ...input,
      filename,
      buffer,
      fileType: "docx",
      source: "user_create",
      generated: true,
    });
  }

  async upload(input: UploadDocumentInput): Promise<DocumentDto> {
    const fileType = assertAllowedDocumentType(input.filename);
    return this.createFromBytes(input, {
      ...input,
      filename: input.filename,
      buffer: input.buffer,
      fileType,
      source: "upload",
      generated: false,
    });
  }

  async createFromBuffer(
    actor: RequestUserContext,
    input: CreateDocumentFromBufferInput,
  ): Promise<DocumentDto> {
    return this.createFromBytes(actor, {
      ...input,
      filename: normalizeDocumentFilename(input.filename),
      fileType: "docx",
      source: "user_create",
      generated: true,
    });
  }

  private async createFromBytes(
    actor: RequestUserContext,
    input: CreateDocumentFromBufferInput & {
      fileType: string;
      source: string;
      generated: boolean;
      attached?: boolean;
    },
  ): Promise<DocumentDto> {
    const projectId = input.projectId || null;
    const workspaceId = input.workspaceId || null;
    const folderId = input.folderId || null;
    if (projectId && workspaceId) {
      throw new DocumentServiceError(400, "Document cannot belong to both project and workspace");
    }
    await this.assertProject(projectId, actor, true);
    await this.assertWorkspace(workspaceId, actor, true);
    await this.assertFolder(projectId, folderId);

    const documentId = randomUUID();
    const metadata = await extractDocumentMetadata(input.buffer, input.fileType);
    const persisted = await this.artifacts.write(
      {
        kind: "initial",
        userId: actor.userId,
        documentId,
        filename: input.filename,
        fileType: input.fileType,
        content: input.buffer,
        generated: input.generated,
        pdfRenditionPolicy: "best-effort",
      },
      async (artifacts) => {
        const pdfStoragePath = storedPdfPath(artifacts.pdfRendition);
        const document = await this.repository.createWithInitialVersion({
          document: {
            id: documentId,
            projectId,
            workspaceId,
            folderId,
            userId: actor.userId,
            filename: input.filename,
            fileType: input.fileType,
            sizeBytes: input.buffer.byteLength,
            pageCount: metadata.pageCount,
            structureTree: metadata.structureTree,
            status: "processing",
            attached: input.attached ?? false,
            isPrimary: input.isPrimary ?? true,
          },
          version: {
            storagePath: artifacts.sourcePath,
            pdfStoragePath,
            source: input.source,
            versionNumber: 1,
            displayName: input.filename,
          },
        });
        return { document, sourcePath: artifacts.sourcePath, pdfStoragePath };
      },
    );
    const activity = input.source === "upload" ? "document_uploaded" : "document_created";
    await recordDocumentActivity(persisted.document.id, actor.userId, activity, {
      type: "version",
      id: persisted.document.currentVersionId ?? persisted.document.id,
      name: input.filename,
    });
    await ensureDrafterMembership(persisted.document.id, actor.userId, actor.userEmail);
    if (persisted.document.currentVersionId) {
      await queueDocumentVersionIndex(
        persisted.document.id,
        persisted.document.currentVersionId,
        actor.userId,
        checksumBuffer(input.buffer),
      );
    }
    return toDocumentDto(persisted.document, {
      storage_path: persisted.sourcePath,
      pdf_storage_path: persisted.pdfStoragePath,
    });
  }

  async get(actor: RequestUserContext, documentId: string): Promise<DocumentDto> {
    return toDocumentDto(await this.requireDocument(actor, documentId, "read_document"));
  }

  async update(
    actor: RequestUserContext,
    documentId: string,
    input: UpdateDocumentInput,
  ): Promise<DocumentDto> {
    const document = await this.requireDocument(actor, documentId, "update_document");
    const projectId = input.projectId !== undefined ? input.projectId : document.projectId;
    const folderId = input.folderId !== undefined ? input.folderId : document.folderId;
    await this.assertProject(projectId, actor, true);
    await this.assertFolder(projectId, folderId);
    const updates: Partial<DocumentRow> = { updatedAt: new Date() };
    const requestedName = input.filename ?? input.name;
    if (requestedName !== undefined) {
      updates.filename = normalizeRenameFilename(requestedName, document.filename);
    }
    if (input.projectId !== undefined) updates.projectId = input.projectId;
    if (input.projectId === null) updates.folderId = null;
    if (input.folderId !== undefined) updates.folderId = input.folderId;
    const updated = await this.repository.updateDocument(documentId, updates);
    if (!updated) throw new DocumentServiceError(404, "Document not found");
    await recordDocumentActivity(documentId, actor.userId, "document_updated", {
      type: "document",
      id: documentId,
      name: updated.filename,
    });
    return toDocumentDto(updated);
  }

  async remove(actor: RequestUserContext, documentId: string): Promise<void> {
    await this.requireDocument(actor, documentId, "delete_document");
    const paths = await this.repository.deleteDocument(documentId);
    if (!paths) throw new DocumentServiceError(404, "Document not found");
    const results = await Promise.allSettled(paths.map((path) => deleteFile(path)));
    const failures = results.filter(({ status }) => status === "rejected").length;
    if (failures > 0) {
      console.error("[documents/delete] orphaned_objects", { documentId, failures });
    }
  }

  async listVersions(actor: RequestUserContext, documentId: string) {
    const document = await this.requireDocument(actor, documentId, "read_document");
    return {
      current_version_id: document.currentVersionId,
      versions: (await this.repository.listVersions(documentId)).map(versionDto),
    };
  }

  async uploadVersion(
    actor: RequestUserContext,
    documentId: string,
    file: Readonly<{ filename: string; buffer: Buffer; displayName?: string }>,
  ) {
    const document = await this.requireDocument(actor, documentId, "edit_document");
    const suffix = documentExtension(file.filename);
    if (document.fileType && suffix && document.fileType !== suffix) {
      throw new DocumentServiceError(
        400,
        `Uploaded file type (${suffix}) does not match document type (${document.fileType}).`,
      );
    }
    const suppliedName = file.displayName?.trim().slice(0, 200);
    const filename = suppliedName
      ? /\.[a-z0-9]{1,6}$/i.test(suppliedName)
        ? suppliedName
        : `${suppliedName}.${suffix || documentExtension(document.filename)}`
      : undefined;
    const version = await this.artifacts.write(
      {
        kind: "version",
        userId: actor.userId,
        documentId,
        filename: file.filename,
        fileType: suffix,
        content: file.buffer,
        pdfRenditionPolicy: "best-effort",
      },
      async (artifacts) => {
        const pdfStoragePath = storedPdfPath(artifacts.pdfRendition);
        return this.repository.appendVersion({
          documentId,
          storagePath: artifacts.sourcePath,
          pdfStoragePath,
          source: "user_upload",
          displayName: suppliedName || file.filename,
          filename,
          sizeBytes: file.buffer.byteLength,
        });
      },
    );
    await recordDocumentActivity(documentId, actor.userId, "version_uploaded", {
      type: "version",
      id: version.id,
      name: version.displayName ?? file.filename,
    });
    await queueDocumentVersionIndex(
      documentId,
      version.id,
      actor.userId,
      checksumBuffer(file.buffer),
    );
    return versionDto(version);
  }

  async saveHtmlVersion(
    actor: RequestUserContext,
    documentId: string,
    html: string,
    displayName?: string,
  ) {
    const document = await this.requireDocument(actor, documentId, "edit_document");
    const buffer = await createInitialDocxBuffer(document.filename, {
      kind: "html",
      value: html,
    });
    return this.uploadVersion(actor, documentId, {
      filename: document.filename,
      buffer,
      displayName,
    });
  }

  async renameVersion(
    actor: RequestUserContext,
    documentId: string,
    versionId: string,
    displayName: string | null,
  ) {
    await this.requireDocument(actor, documentId, "edit_document");
    const version = await this.repository.renameVersion(documentId, versionId, displayName);
    if (!version) throw new DocumentServiceError(404, "Version not found");
    await recordDocumentActivity(documentId, actor.userId, "version_renamed", {
      type: "version",
      id: version.id,
      name: version.displayName ?? undefined,
    });
    return versionDto(version);
  }

  async rawContent(
    actor: RequestUserContext,
    documentId: string,
    versionId?: string | null,
    preferPdf = false,
  ) {
    const document = await this.requireDocument(actor, documentId, "read_document");
    const version = await this.repository.findActiveVersion(documentId, versionId);
    if (!version) throw new DocumentServiceError(404, "No file available");
    const pdfStoragePath = preferPdf ? version.pdfStoragePath : null;
    const usePdf = Boolean(pdfStoragePath);
    const path = pdfStoragePath || version.storagePath;
    const bytes = await downloadFile(path);
    if (!bytes) throw new DocumentServiceError(404, "Document bytes not available");
    const filename = versionFilename(document.filename, version.displayName, version.versionNumber);
    return {
      bytes: Buffer.from(bytes),
      filename,
      contentType: usePdf ? "application/pdf" : documentContentType(document.fileType ?? ""),
    };
  }

  async html(actor: RequestUserContext, documentId: string, versionId?: string | null) {
    const content = await this.rawContent(actor, documentId, versionId);
    try {
      if (content.filename.toLowerCase().endsWith(".docx")) {
        return { html: await renderDocxPreviewHtml(content.bytes), messages: [] };
      }
      const result = await decodeDocumentContent({
        bytes: content.bytes,
        filename: content.filename,
        output: "html",
      });
      return { html: result.html, messages: result.messages };
    } catch (error) {
      throw new DocumentConversionError(
        `Conversion failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async signedUrl(
    actor: RequestUserContext,
    documentId: string,
    versionId?: string | null,
    inline = false,
  ) {
    const document = await this.requireDocument(
      actor,
      documentId,
      inline ? "read_document" : "export_document",
    );
    const version = await this.repository.findActiveVersion(documentId, versionId);
    if (!version) throw new DocumentServiceError(404, "No file available");
    const filename = versionFilename(document.filename, version.displayName, version.versionNumber);
    const url = await getSignedUrl(
      version.storagePath,
      3600,
      filename,
      inline ? "inline" : "attachment",
    );
    return {
      url,
      document_id: documentId,
      filename,
      version_id: version.id,
      has_pdf_rendition: Boolean(version.pdfStoragePath),
    };
  }

  async previewSummary(actor: RequestUserContext, documentId: string) {
    const document = await this.requireDocument(actor, documentId, "read_document");
    const version = await this.repository.findActiveVersion(documentId);
    if (!version) throw new DocumentServiceError(404, "No file available");
    return buildPreviewSummary({
      id: documentId,
      sourceType: "document",
      filename: document.filename,
      bytes: await downloadFile(version.storagePath),
      userId: actor.userId,
      fileType: document.fileType,
    });
  }

  async trackedChangeIds(actor: RequestUserContext, documentId: string, versionId?: string | null) {
    const content = await this.rawContent(actor, documentId, versionId);
    return { ids: await extractTrackedChangeIds(content.bytes) };
  }

  private async resolveZipOccurrence(
    actor: RequestUserContext,
    documentId: string,
    requestIndex: number,
  ): Promise<ResolvedDocumentZipOccurrence> {
    try {
      const document = await this.requireDocument(actor, documentId, "export_document");
      const version = await this.repository.findActiveVersion(documentId);
      if (!version) {
        return { requestIndex, documentId, status: "failed", reason: "no-active-version" };
      }
      const bytes = await downloadFile(version.storagePath);
      if (!bytes) {
        return { requestIndex, documentId, status: "failed", reason: "content-unavailable" };
      }
      return {
        requestIndex,
        documentId,
        status: "available",
        requestedFilename: document.filename,
        bytes: Buffer.from(bytes),
      };
    } catch (error) {
      const statusCode =
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        typeof error.statusCode === "number"
          ? error.statusCode
          : null;
      return {
        requestIndex,
        documentId,
        status: "failed",
        reason: statusCode === 403 || statusCode === 404 ? "unavailable" : "read-failed",
      };
    }
  }

  async downloadZip(
    actor: RequestUserContext,
    request: DocumentZipRequest,
  ): Promise<DocumentZipResult> {
    const resolved = await Promise.all(
      request.documentIds.map((documentId, requestIndex) =>
        this.resolveZipOccurrence(actor, documentId, requestIndex),
      ),
    );
    const prepared = prepareDocumentZip(resolved);
    if (request.mode === "atomic" && prepared.failures.length > 0) {
      throw new DocumentZipAtomicError(prepared.failures);
    }
    return {
      bytes: await generateDocumentZip(prepared, request.mode),
      outcomes: prepared.outcomes,
      failures: prepared.failures,
    };
  }

  async export(
    actor: RequestUserContext,
    documentId: string,
    html: string,
    format: "docx" | "pdf",
  ) {
    const document = await this.requireDocument(actor, documentId, "export_document");
    const stem = document.filename.replace(/\.[^/.]+$/, "");
    const bytes =
      format === "pdf"
        ? await this.convert({ kind: "html-to-pdf", html })
        : await createInitialDocxBuffer(document.filename, { kind: "html", value: html });
    return {
      bytes,
      filename: `${stem}.${format}`,
      contentType:
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      disposition: buildContentDisposition("attachment", `${stem}.${format}`),
    };
  }
}
