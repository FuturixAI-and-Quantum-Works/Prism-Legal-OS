import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentGovernanceRepository } from "../../src/modules/documents/documents.governance.repository.js";
import { DocumentPermissionsService } from "../../src/modules/documents/documents.permissions.service.js";

const authority = vi.hoisted(() => ({
  grants: { findGrant: vi.fn() },
  decide: vi.fn(),
}));

vi.mock("../../src/modules/access/access.composition.js", () => ({
  accessAuthority: authority,
}));

const document = {
  id: "document-1",
  filename: "contract.docx",
  fileType: "docx",
  userId: "owner-1",
  projectId: null,
  lifecycleStatus: "DRAFT" as const,
};
const actor = { userId: "editor-1", email: "editor@example.com" };
const editorGrant = {
  role: "editor" as const,
  source: "direct-share" as const,
  documentRole: null,
  documentLifecycle: "DRAFT" as const,
};

function service(): DocumentPermissionsService {
  const repository: DocumentGovernanceRepository = Object.create(
    DocumentGovernanceRepository.prototype,
  );
  vi.spyOn(repository, "findSessionDocument").mockResolvedValue(document);
  vi.spyOn(repository, "findSessionUser").mockResolvedValue({
    id: actor.userId,
    email: actor.email,
    fullName: "Editor",
    role: null,
  });
  return new DocumentPermissionsService(repository);
}

describe("DocumentPermissionsService denial mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authority.grants.findGrant.mockResolvedValue(editorGrant);
  });

  it("conceals owner-only document metadata updates", async () => {
    authority.decide.mockResolvedValue({ allowed: false, reason: "not-found" });

    await expect(
      service().assertAllowed(document.id, actor.userId, actor.email, "update_document"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("preserves forbidden status for visible change-request management", async () => {
    authority.decide.mockResolvedValue({ allowed: false, reason: "forbidden" });

    await expect(
      service().assertAllowed(document.id, actor.userId, actor.email, "list_change_requests"),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
