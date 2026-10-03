import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentArtifactWriter } from "../../src/modules/documents/documents.artifacts.js";
import { DocumentsRepository } from "../../src/modules/documents/documents.repository.js";
import {
  type DocumentConversionPort,
  DocumentConversionError,
  DocumentServiceError,
  DocumentsService,
  MissingDocumentConversionCapabilityError,
} from "../../src/modules/documents/documents.service.js";

const storage = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
}));
const cleanup = vi.hoisted(() => ({
  schedule: vi.fn(async () => undefined),
}));
const docxPreview = vi.hoisted(() => ({
  render: vi.fn(),
}));
const documentContent = vi.hoisted(() => ({
  decode: vi.fn(),
}));
const access = vi.hoisted(() => ({
  decide: vi.fn(async () => ({
    allowed: true,
    grant: {
      role: "owner",
      source: "owner",
      documentRole: null,
      documentLifecycle: "DRAFT",
    },
  })),
  grants: {
    listDocumentGrants: vi.fn(async () => new Map()),
  },
}));
const permissions = vi.hoisted(() => ({
  assertDocumentActionAllowed: vi.fn(async () => undefined),
  ensureDrafterMembership: vi.fn(async () => undefined),
}));
const convert = vi.fn(async () => Buffer.from("converted"));
const converter = {
  capabilities: {
    conversions: ["doc-to-pdf", "docx-to-pdf", "html-to-pdf"] as const,
    maxInputBytes: 1_024,
    maxOutputBytes: 1_024,
    adapters: [],
  },
  convert,
};

function createService(
  repository: DocumentsRepository,
  conversion: DocumentConversionPort = converter,
): DocumentsService {
  return new DocumentsService(
    repository,
    conversion,
    new DocumentArtifactWriter(conversion, cleanup.schedule),
  );
}

vi.mock("../../src/lib/storage.js", async (load) => {
  const actual = await load<typeof import("../../src/lib/storage.js")>();
  return { ...actual, ...storage };
});
vi.mock("../../src/lib/docxTemplateAnalyzer.js", () => ({
  renderDocxPreviewHtml: docxPreview.render,
}));
vi.mock("../../src/modules/content/documentContent.js", async (load) => {
  const actual = await load<typeof import("../../src/modules/content/documentContent.js")>();
  return { ...actual, decodeDocumentContent: documentContent.decode };
});
vi.mock("../../src/modules/access/access.composition.js", () => ({
  accessAuthority: access,
}));
vi.mock("../../src/modules/documents/documents.permissions.service.js", () => ({
  ...permissions,
}));
vi.mock("../../src/modules/documents/documents.activity.service.js", () => ({
  recordDocumentActivity: vi.fn(async () => undefined),
}));
vi.mock("../../src/modules/retrieval/retrieval.indexing.js", () => ({
  checksumBuffer: vi.fn(() => "checksum"),
  queueDocumentVersionIndex: vi.fn(async () => undefined),
}));

const document = {
  id: "00000000-0000-4000-8000-000000000001",
  projectId: null,
  workspaceId: null,
  userId: "00000000-0000-4000-8000-000000000002",
  folderId: null,
  filename: "contract.pdf",
  fileType: "pdf",
  sizeBytes: 3,
  pageCount: null,
  structureTree: null,
  status: "ready",
  lifecycleStatus: "DRAFT" as const,
  currentVersionId: "00000000-0000-4000-8000-000000000003",
  attached: false,
  isPrimary: true,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
  convert.mockResolvedValue(Buffer.from("converted"));
  storage.uploadFile.mockResolvedValue(undefined);
  storage.deleteFile.mockResolvedValue(undefined);
  cleanup.schedule.mockResolvedValue(undefined);
});

describe("DocumentArtifactWriter", () => {
  it("uploads source and rendition in order before persistence", async () => {
    const events: string[] = [];
    storage.uploadFile.mockImplementation(async (key: string) => {
      events.push(key.endsWith(".pdf") ? "upload-pdf" : "upload-source");
    });
    const writer = new DocumentArtifactWriter(converter, cleanup.schedule);

    const result = await writer.write(
      {
        kind: "initial",
        userId: document.userId,
        documentId: document.id,
        filename: "contract.docx",
        fileType: "docx",
        content: Buffer.from("docx"),
        generated: false,
        pdfRenditionPolicy: "best-effort",
      },
      async (artifacts) => {
        events.push("persist");
        expect(Object.keys(artifacts).sort()).toEqual(["pdfRendition", "sourcePath"]);
        return artifacts;
      },
    );

    expect(events).toEqual(["upload-source", "upload-pdf", "persist"]);
    expect(result.pdfRendition).toMatchObject({
      kind: "converted",
      path: expect.stringContaining("converted-pdfs/"),
    });
  });

  it("queues every attempted upload when persistence rejects", async () => {
    const writer = new DocumentArtifactWriter(converter, cleanup.schedule);

    await expect(
      writer.write(
        {
          kind: "initial",
          userId: document.userId,
          documentId: document.id,
          filename: "contract.docx",
          fileType: "docx",
          content: Buffer.from("docx"),
          generated: false,
          pdfRenditionPolicy: "best-effort",
        },
        async () => {
          throw new Error("database failed");
        },
      ),
    ).rejects.toThrow("database failed");

    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect(cleanup.schedule).toHaveBeenCalledWith({
      operationId: expect.any(String),
      documentId: document.id,
      paths: storage.uploadFile.mock.calls.map(([key]) => key),
      delayMs: 5_000,
    });
  });

  it("continues without a rendition when optional conversion fails", async () => {
    convert.mockRejectedValueOnce(new Error("conversion unavailable"));
    const writer = new DocumentArtifactWriter(converter, cleanup.schedule);

    const result = await writer.write(
      {
        kind: "version",
        userId: document.userId,
        documentId: document.id,
        filename: "contract.docx",
        fileType: "docx",
        content: Buffer.from("docx"),
        pdfRenditionPolicy: "best-effort",
      },
      async (artifacts) => artifacts,
    );

    expect(storage.uploadFile).toHaveBeenCalledOnce();
    expect(result.sourcePath).toContain("/versions/");
    expect(result.pdfRendition).toMatchObject({
      kind: "degraded",
      cause: expect.objectContaining({ message: "conversion unavailable" }),
    });
  });

  it("fails before storage when a required rendition cannot be converted", async () => {
    convert.mockRejectedValueOnce(new Error("conversion unavailable"));
    const writer = new DocumentArtifactWriter(converter, cleanup.schedule);
    const persist = vi.fn();

    await expect(
      writer.write(
        {
          kind: "version",
          userId: document.userId,
          documentId: document.id,
          filename: "contract.docx",
          fileType: "docx",
          content: Buffer.from("docx"),
          pdfRenditionPolicy: "required",
        },
        persist,
      ),
    ).rejects.toMatchObject({
      name: "RequiredPdfRenditionError",
      failure: {
        kind: "degraded",
        cause: expect.objectContaining({ message: "conversion unavailable" }),
      },
    });
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});

describe("DocumentsService storage sagas", () => {
  beforeEach(() => {
    docxPreview.render.mockResolvedValue("<p>preview</p>");
  });

  it("queues uploaded bytes when the document creation transaction has uncertain state", async () => {
    const repository = new DocumentsRepository();
    vi.spyOn(repository, "createWithInitialVersion").mockRejectedValue(
      new Error("database failed"),
    );
    const service = createService(repository);

    await expect(
      service.upload({
        userId: document.userId,
        userEmail: "owner@example.com",
        filename: "contract.pdf",
        buffer: Buffer.from("pdf"),
      }),
    ).rejects.toThrow("database failed");

    expect(storage.uploadFile).toHaveBeenCalledOnce();
    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect(cleanup.schedule).toHaveBeenCalledWith({
      operationId: expect.any(String),
      documentId: expect.any(String),
      paths: [expect.stringContaining("/source.pdf")],
      delayMs: 5_000,
    });
  });

  it("removes source bytes when rendition storage fails", async () => {
    const repository = new DocumentsRepository();
    const create = vi.spyOn(repository, "createWithInitialVersion");
    storage.uploadFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("rendition write failed"));
    const service = createService(repository);

    await expect(
      service.upload({
        userId: document.userId,
        userEmail: "owner@example.com",
        filename: "contract.docx",
        buffer: Buffer.from("docx"),
      }),
    ).rejects.toThrow("rendition write failed");

    expect(storage.deleteFile.mock.calls.map(([path]) => path)).toEqual(
      storage.uploadFile.mock.calls.map(([path]) => path),
    );
    expect(cleanup.schedule).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("queues version bytes when the version transaction has uncertain state", async () => {
    const repository = new DocumentsRepository();
    vi.spyOn(repository, "findDocumentById").mockResolvedValue(document);
    vi.spyOn(repository, "appendVersion").mockRejectedValue(new Error("database failed"));
    const service = createService(repository);

    await expect(
      service.uploadVersion(
        { userId: document.userId, userEmail: "owner@example.com" },
        document.id,
        { filename: "contract.pdf", buffer: Buffer.from("next") },
      ),
    ).rejects.toThrow("database failed");

    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect(cleanup.schedule).toHaveBeenCalledWith({
      operationId: expect.any(String),
      documentId: document.id,
      paths: [expect.stringContaining("/versions/")],
      delayMs: 5_000,
    });
  });

  it("deletes the database record before best-effort object cleanup", async () => {
    const repository = new DocumentsRepository();
    vi.spyOn(repository, "findDocumentById").mockResolvedValue(document);
    vi.spyOn(repository, "deleteDocument").mockResolvedValue(["a", "b"]);
    storage.deleteFile.mockRejectedValueOnce(new Error("object store unavailable"));
    const service = createService(repository);

    await expect(
      service.remove({ userId: document.userId, userEmail: "owner@example.com" }, document.id),
    ).resolves.toBeUndefined();
    expect(repository.deleteDocument).toHaveBeenCalledWith(document.id);
    expect(storage.deleteFile).toHaveBeenCalledTimes(2);
  });

  it("uses the owner-only document action before updating metadata", async () => {
    const repository = new DocumentsRepository();
    vi.spyOn(repository, "findDocumentById").mockResolvedValue(document);
    const updateDocument = vi.spyOn(repository, "updateDocument").mockResolvedValue({
      ...document,
      filename: "renamed.pdf",
    });
    const service = createService(repository);

    await service.update({ userId: document.userId, userEmail: "owner@example.com" }, document.id, {
      filename: "renamed",
    });

    expect(permissions.assertDocumentActionAllowed).toHaveBeenCalledWith(
      document.id,
      document.userId,
      "owner@example.com",
      "update_document",
    );
    expect(updateDocument).toHaveBeenCalledWith(
      document.id,
      expect.objectContaining({ filename: "renamed.pdf" }),
    );
  });

  it("rejects mismatched version types before writing storage", async () => {
    const repository = new DocumentsRepository();
    vi.spyOn(repository, "findDocumentById").mockResolvedValue(document);
    const service = createService(repository);

    await expect(
      service.uploadVersion(
        { userId: document.userId, userEmail: "owner@example.com" },
        document.id,
        { filename: "contract.docx", buffer: Buffer.from("docx") },
      ),
    ).rejects.toEqual(
      new DocumentServiceError(
        400,
        "Uploaded file type (docx) does not match document type (pdf).",
      ),
    );
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it("uses the injected converter for PDF exports", async () => {
    const repository = new DocumentsRepository();
    vi.spyOn(repository, "findDocumentById").mockResolvedValue(document);
    const service = createService(repository);

    await expect(
      service.export(
        { userId: document.userId, userEmail: "owner@example.com" },
        document.id,
        "<p>contract</p>",
        "pdf",
      ),
    ).resolves.toMatchObject({ bytes: Buffer.from("converted") });

    expect(convert).toHaveBeenCalledWith(
      { kind: "html-to-pdf", html: "<p>contract</p>" },
      expect.any(AbortSignal),
    );
  });

  it("rejects converters missing a required capability", () => {
    expect(() =>
      createService(new DocumentsRepository(), {
        ...converter,
        capabilities: {
          ...converter.capabilities,
          conversions: ["doc-to-pdf", "docx-to-pdf"],
        },
      }),
    ).toThrow(new MissingDocumentConversionCapabilityError("html-to-pdf"));
  });

  it("surfaces DOCX preview conversion failures without decoding through another path", async () => {
    const repository = new DocumentsRepository();
    vi.spyOn(repository, "findDocumentById").mockResolvedValue({
      ...document,
      filename: "contract.docx",
      fileType: "docx",
    });
    vi.spyOn(repository, "findActiveVersion").mockResolvedValue({
      id: document.currentVersionId,
      documentId: document.id,
      storagePath: "documents/contract/source.docx",
      pdfStoragePath: null,
      source: "upload",
      versionNumber: 1,
      displayName: null,
      createdAt: new Date("2026-01-01"),
    });
    storage.downloadFile.mockResolvedValue(Buffer.from("docx"));
    docxPreview.render.mockRejectedValue(new Error("preview converter failed"));

    const result = createService(repository).html(
      { userId: document.userId, userEmail: "owner@example.com" },
      document.id,
    );
    await expect(result).rejects.toBeInstanceOf(DocumentConversionError);
    await expect(result).rejects.toMatchObject({
      statusCode: 500,
      message: "Conversion failed: preview converter failed",
    });
    expect(documentContent.decode).not.toHaveBeenCalled();
  });
});
