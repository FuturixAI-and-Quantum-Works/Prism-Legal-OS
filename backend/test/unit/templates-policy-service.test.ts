import { describe, expect, it, vi } from "vitest";
import type { AccessAuthority } from "../../src/modules/access/access.authority.js";
import { TemplatesAuthorizationPolicy } from "../../src/modules/templates/templates.policy.js";
import type { TemplatesRepository } from "../../src/modules/templates/templates.repository.js";
import { TemplatesService } from "../../src/modules/templates/templates.service.js";
import { TemplateStorageCoordinator } from "../../src/modules/templates/templates.storage.js";
import { TemplateError, type Template } from "../../src/modules/templates/templates.types.js";
import {
  ObjectNotFoundError,
  parseObjectRef,
  type ObjectRef,
  type ObjectStore,
} from "../../src/storage/types.js";
import { ownerGrant, stubAccessAuthority } from "./access-test-helpers.js";

const actor = { userId: "user-1", email: "user@example.com" };
const template: Template = {
  id: "template-1",
  stableKey: null,
  userId: actor.userId,
  name: "Agreement",
  category: "Legal",
  description: null,
  contentHtml: "<p>Hello {{name}}</p>",
  fields: [{ id: "name", label: "Name", required: true }],
  sourceFilename: null,
  sourceStoragePath: null,
  sourceMimeType: null,
  sourceChecksum: null,
  sourceMetadata: null,
  isCreatedByUser: true,
  createdAt: new Date("2026-09-02T00:00:00.000Z"),
  updatedAt: new Date("2026-09-02T00:00:00.000Z"),
};

class MemoryStore implements ObjectStore {
  readonly objects = new Map<ObjectRef, ArrayBuffer>();

  async put(input: Parameters<ObjectStore["put"]>[0]): Promise<void> {
    this.objects.set(input.ref, input.content);
  }

  async get(ref: ObjectRef): Promise<ArrayBuffer> {
    const value = this.objects.get(ref);
    if (!value) throw new ObjectNotFoundError(ref);
    return value;
  }

  async delete(ref: ObjectRef): Promise<void> {
    this.objects.delete(ref);
  }

  async copy(input: Parameters<ObjectStore["copy"]>[0]): Promise<void> {
    this.objects.set(input.destinationRef, await this.get(input.sourceRef));
  }

  async signRead(): Promise<string> {
    return "https://example.test/template";
  }

  async health() {
    return { kind: "healthy" as const };
  }

  close(): void {}
}

function repository(overrides: Partial<TemplatesRepository> = {}): TemplatesRepository {
  return {
    list: vi.fn(async () => []),
    findById: vi.fn(async () => template),
    create: vi.fn(async () => template),
    updateOwned: vi.fn(async () => template),
    deleteOwned: vi.fn(async () => template),
    clone: vi.fn(async (_source, userId, name, sourceStoragePath) => ({
      ...template,
      userId,
      name,
      sourceStoragePath,
    })),
    ...overrides,
  };
}

function documents() {
  return {
    createBlank: vi.fn(async (_actor, input) => ({
      id: "document-1",
      user_id: actor.userId,
      filename: input.filename,
      file_type: "docx",
      size_bytes: 0,
      status: "ready",
      storage_path: null,
      pdf_storage_path: null,
      project_id: input.projectId,
      workspace_id: input.workspaceId,
      folder_id: input.folderId,
      is_primary: input.isPrimary ?? true,
      created_at: new Date(),
      updated_at: new Date(),
    })),
    createFromBuffer: vi.fn(),
  };
}

function templatesService(
  repo: TemplatesRepository,
  {
    authority = stubAccessAuthority(),
    store = new MemoryStore(),
    documents: documentCreator = documents(),
  }: Partial<{
    authority: AccessAuthority;
    store: ObjectStore;
    documents: ReturnType<typeof documents>;
  }> = {},
): TemplatesService {
  return new TemplatesService(
    repo,
    new TemplatesAuthorizationPolicy(repo, authority),
    authority,
    new TemplateStorageCoordinator(store),
    documentCreator,
  );
}

describe("template policies and services", () => {
  it("hides inaccessible and non-owned templates behind 404 responses", async () => {
    const repo = repository({
      findById: vi.fn(async () => ({ ...template, userId: "someone-else" })),
    });
    const policy = new TemplatesAuthorizationPolicy(
      repo,
      stubAccessAuthority(() => null),
    );
    await expect(policy.requireAccessible(template.id, actor.userId)).rejects.toEqual(
      new TemplateError(404, "Template not found"),
    );
    await expect(
      policy.requireOwned(template.id, actor.userId, "Template not found or not editable"),
    ).rejects.toEqual(new TemplateError(404, "Template not found or not editable"));
  });

  it("lists the templates the actor holds grants for", async () => {
    const repo = repository();
    const listTemplateGrants = vi.fn(async () => new Map([[template.id, ownerGrant]]));
    const service = templatesService(repo, {
      authority: stubAccessAuthority(undefined, { listTemplateGrants }),
    });
    await service.list(actor, "user");
    expect(listTemplateGrants).toHaveBeenCalledWith({ userId: actor.userId, email: "" });
    expect(repo.list).toHaveBeenCalledWith([template.id], "user");
  });

  it("renders HTML templates through the document boundary", async () => {
    const repo = repository();
    const documentCreator = documents();
    const service = templatesService(repo, { documents: documentCreator });
    const result = await service.createDocument(actor, template.id, {
      values: { name: "Aqua" },
    });
    expect(documentCreator.createBlank).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ contentHtml: "<p>Hello Aqua</p>" }),
    );
    expect(result).toMatchObject({ id: "document-1", template_id: template.id });
  });

  it("compensates a copied source object when the clone transaction fails", async () => {
    const sourceRef = parseObjectRef("templates/system/source.docx");
    const store = new MemoryStore();
    store.objects.set(sourceRef, new TextEncoder().encode("docx").buffer);
    const repo = repository({
      findById: vi.fn(async () => ({
        ...template,
        sourceFilename: "source.docx",
        sourceStoragePath: sourceRef,
      })),
      clone: vi.fn(async () => {
        throw new Error("database failed");
      }),
    });
    const service = templatesService(repo, { store });
    await expect(service.clone(actor, template.id)).rejects.toThrow("database failed");
    expect([...store.objects.keys()]).toEqual([sourceRef]);
  });
});
