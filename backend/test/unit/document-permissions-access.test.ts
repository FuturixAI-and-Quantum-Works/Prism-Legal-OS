import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AccessGrant,
  DocumentLifecycleStatus,
} from "../../src/modules/access/access.types.js";
import { DocumentGovernanceRepository } from "../../src/modules/documents/documents.governance.repository.js";
import { DocumentPermissionsService } from "../../src/modules/documents/documents.permissions.service.js";

const findGrant = vi.hoisted(() => vi.fn<() => AccessGrant | null>());

vi.mock("../../src/modules/access/access.composition.js", async () => {
  const { stubAccessAuthority } = await import("./access-test-helpers.js");
  return { accessAuthority: stubAccessAuthority(() => findGrant()) };
});

const document = {
  id: "document-1",
  filename: "contract.docx",
  fileType: "docx",
  userId: "owner-1",
  projectId: null,
};
const actor = { userId: "editor-1", email: "editor@example.com" };

function grant(
  role: AccessGrant["role"],
  source: AccessGrant["source"],
  documentRole: AccessGrant["documentRole"] = null,
  documentLifecycle: AccessGrant["documentLifecycle"] = "DRAFT",
): AccessGrant {
  return { role, source, documentRole, documentLifecycle };
}

function service(lifecycleStatus: DocumentLifecycleStatus = "DRAFT"): DocumentPermissionsService {
  const repository: DocumentGovernanceRepository = Object.create(
    DocumentGovernanceRepository.prototype,
  );
  vi.spyOn(repository, "findSessionDocument").mockResolvedValue({ ...document, lifecycleStatus });
  vi.spyOn(repository, "findSessionUser").mockResolvedValue({
    id: actor.userId,
    email: actor.email,
    fullName: "Editor",
    role: null,
  });
  return new DocumentPermissionsService(repository);
}

describe("DocumentPermissionsService.assertAllowed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the grant once per permission check", async () => {
    findGrant.mockReturnValue(grant("editor", "direct-share"));

    await service().assertAllowed(document.id, actor.userId, actor.email, "edit_document");

    expect(findGrant).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["owner", grant("owner", "owner"), "update_document"],
    ["drafter member", grant("editor", "member", "DRAFTER"), "edit_document"],
    ["project member", grant("editor", "project"), "edit_document"],
    ["workspace member", grant("viewer", "workspace"), "read_document"],
    ["global admin", grant("admin", "global-admin"), "delete_document"],
  ] as const)("allows the %s and returns the loaded context", async (_, access, action) => {
    findGrant.mockReturnValue(access);

    await expect(
      service().assertAllowed(document.id, actor.userId, actor.email, action),
    ).resolves.toMatchObject({ document_id: document.id, access_source: access.source });
  });

  it.each([
    [
      "reviewer member editing",
      grant("viewer", "member", "REVIEWER"),
      "edit_document",
      403,
      "Access Restricted This action requires Drafter access. Your current role on this document is REVIEWER.",
    ],
    [
      "workspace viewer editing",
      grant("viewer", "workspace"),
      "edit_document",
      403,
      "Access Restricted This action requires Drafter access. Your current role on this document is Unverified.",
    ],
    [
      "project editor managing change requests",
      grant("editor", "project"),
      "list_change_requests",
      403,
      "Access Restricted This action requires Owner access. Your current role on this document is Unverified.",
    ],
    [
      "direct-share editor updating metadata",
      grant("editor", "direct-share"),
      "update_document",
      404,
      "Document not found",
    ],
    [
      "global admin updating metadata",
      grant("admin", "global-admin"),
      "update_document",
      404,
      "Document not found",
    ],
  ] as const)("denies the %s", async (_, access, action, statusCode, message) => {
    findGrant.mockReturnValue(access);

    await expect(
      service().assertAllowed(document.id, actor.userId, actor.email, action),
    ).rejects.toMatchObject({ statusCode, message });
  });

  it.each([
    ["FINALIZED", "This document is finalized and permanently immutable."],
    ["PENDING_APPROVAL", "This document is pending approval and locked for editing."],
  ] as const)("locks editing of a %s document", async (lifecycle, message) => {
    findGrant.mockReturnValue(grant("owner", "owner", null, lifecycle));

    await expect(
      service(lifecycle).assertAllowed(document.id, actor.userId, actor.email, "edit_document"),
    ).rejects.toMatchObject({ statusCode: 403, message });
  });

  it("conceals the document from an actor with no grant", async () => {
    findGrant.mockReturnValue(null);

    await expect(
      service().assertAllowed(document.id, actor.userId, actor.email, "read_document"),
    ).rejects.toMatchObject({ statusCode: 404, message: "Document not found" });
    expect(findGrant).toHaveBeenCalledTimes(1);
  });
});
