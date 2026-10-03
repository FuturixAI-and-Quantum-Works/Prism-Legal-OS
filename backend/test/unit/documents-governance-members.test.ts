import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentGovernanceRepository } from "../../src/modules/documents/documents.governance.repository.js";
import { DocumentGovernanceService } from "../../src/modules/documents/documents.governance.service.js";

const effects = vi.hoisted(() => ({
  assertAllowed: vi.fn(),
  recordActivity: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("../../src/modules/documents/documents.permissions.service.js", async (load) => {
  const actual =
    await load<typeof import("../../src/modules/documents/documents.permissions.service.js")>();
  return { ...actual, assertDocumentActionAllowed: effects.assertAllowed };
});

vi.mock("../../src/modules/documents/documents.activity.service.js", async (load) => {
  const actual =
    await load<typeof import("../../src/modules/documents/documents.activity.service.js")>();
  return { ...actual, recordDocumentActivity: effects.recordActivity };
});

vi.mock("../../src/modules/documents/documents.notifications.service.js", async (load) => {
  const actual =
    await load<typeof import("../../src/modules/documents/documents.notifications.service.js")>();
  return { ...actual, recordAndSendDocumentEmail: effects.sendEmail };
});

const documentId = "00000000-0000-4000-8000-000000000002";
const actor = {
  userId: "00000000-0000-4000-8000-000000000001",
  userEmail: "Owner@Example.com",
};
const denied = Object.assign(new Error("Access denied"), { statusCode: 403 });

const createdAt = new Date("2026-01-01T00:00:00.000Z");

function memberRow(id: string, role: "DRAFTER" | "REVIEWER") {
  return {
    id,
    documentId,
    userId: null,
    email: null,
    role,
    assignedByUserId: actor.userId,
    createdAt,
    updatedAt: createdAt,
  };
}

function setup() {
  const repository = new DocumentGovernanceRepository();
  return { repository, service: new DocumentGovernanceService(repository) };
}

describe("document members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    effects.assertAllowed.mockResolvedValue(undefined);
    effects.recordActivity.mockResolvedValue(undefined);
    effects.sendEmail.mockResolvedValue(undefined);
  });

  it("lists members after checking the role-assignment permission", async () => {
    const { repository, service } = setup();
    const members = [
      {
        id: "member-1",
        document_id: documentId,
        user_id: null,
        email: "a@example.com",
        role: "REVIEWER" as const,
        assigned_by_user_id: actor.userId,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ];
    vi.spyOn(repository, "listMembers").mockResolvedValue(members);

    await expect(service.listMembers(actor, documentId)).resolves.toEqual(members);
    expect(effects.assertAllowed).toHaveBeenCalledWith(
      documentId,
      actor.userId,
      actor.userEmail,
      "assign_document_role",
    );
  });

  it("rejects listing without permission and reads nothing", async () => {
    const { repository, service } = setup();
    const listMembers = vi.spyOn(repository, "listMembers");
    effects.assertAllowed.mockRejectedValue(denied);

    await expect(service.listMembers(actor, documentId)).rejects.toBe(denied);
    expect(listMembers).not.toHaveBeenCalled();
  });

  it("assigns a member by normalised email, records activity, and notifies them", async () => {
    const { repository, service } = setup();
    const assignMember = vi
      .spyOn(repository, "assignMember")
      .mockResolvedValue(memberRow("member-1", "REVIEWER"));

    await expect(
      service.assignMember(actor, documentId, {
        email: "  New.Member@Example.COM ",
        targetUserId: "  ",
        role: "REVIEWER",
      }),
    ).resolves.toEqual(memberRow("member-1", "REVIEWER"));

    expect(effects.assertAllowed).toHaveBeenCalledWith(
      documentId,
      actor.userId,
      actor.userEmail,
      "assign_document_role",
    );
    expect(assignMember).toHaveBeenCalledWith({
      documentId,
      assignedByUserId: actor.userId,
      email: "new.member@example.com",
      targetUserId: null,
      role: "REVIEWER",
    });
    expect(effects.recordActivity).toHaveBeenCalledWith(
      documentId,
      actor.userId,
      "document_role_assigned",
      { type: "member", id: "member-1" },
      { role: "REVIEWER", email: "new.member@example.com", user_id: null },
    );
    expect(effects.sendEmail).toHaveBeenCalledWith(
      documentId,
      "new.member@example.com",
      "role-assignment",
      "role_assignment",
      "Document role assigned",
      "You have been assigned REVIEWER access. Open the document from your workspace.",
    );
  });

  it("assigns a member by user id without sending an email", async () => {
    const { repository, service } = setup();
    vi.spyOn(repository, "assignMember").mockResolvedValue(memberRow("member-2", "DRAFTER"));

    await service.assignMember(actor, documentId, {
      email: null,
      targetUserId: " user-9 ",
      role: "DRAFTER",
    });

    expect(effects.recordActivity).toHaveBeenCalledWith(
      documentId,
      actor.userId,
      "document_role_assigned",
      { type: "member", id: "member-2" },
      { role: "DRAFTER", email: null, user_id: "user-9" },
    );
    expect(effects.sendEmail).not.toHaveBeenCalled();
  });

  it("rejects an assignment with neither email nor user id", async () => {
    const { repository, service } = setup();
    const assignMember = vi.spyOn(repository, "assignMember");

    await expect(
      service.assignMember(actor, documentId, {
        email: " ",
        targetUserId: null,
        role: "APPROVER",
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: "email or user_id is required" });
    expect(assignMember).not.toHaveBeenCalled();
    expect(effects.recordActivity).not.toHaveBeenCalled();
  });

  it("rejects an assignment without permission and writes nothing", async () => {
    const { repository, service } = setup();
    const assignMember = vi.spyOn(repository, "assignMember");
    effects.assertAllowed.mockRejectedValue(denied);

    await expect(
      service.assignMember(actor, documentId, {
        email: "a@example.com",
        targetUserId: null,
        role: "APPROVER",
      }),
    ).rejects.toBe(denied);
    expect(assignMember).not.toHaveBeenCalled();
    expect(effects.recordActivity).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
  });

  it("revokes a member and records the revoked role", async () => {
    const { repository, service } = setup();
    const revokeMember = vi
      .spyOn(repository, "revokeMember")
      .mockResolvedValue({ id: "member-1", email: "a@example.com", role: "REVIEWER" });

    await expect(service.revokeMember(actor, documentId, "member-1")).resolves.toBeUndefined();

    expect(revokeMember).toHaveBeenCalledWith(documentId, "member-1");
    expect(effects.recordActivity).toHaveBeenCalledWith(
      documentId,
      actor.userId,
      "document_role_revoked",
      { type: "member", id: "member-1" },
      { role: "REVIEWER", email: "a@example.com" },
    );
  });

  it("returns 404 when revoking an unknown member", async () => {
    const { repository, service } = setup();
    vi.spyOn(repository, "revokeMember").mockResolvedValue(null);

    await expect(service.revokeMember(actor, documentId, "missing")).rejects.toMatchObject({
      statusCode: 404,
      message: "Document member not found",
    });
    expect(effects.recordActivity).not.toHaveBeenCalled();
  });

  it("rejects a revoke without permission and deletes nothing", async () => {
    const { repository, service } = setup();
    const revokeMember = vi.spyOn(repository, "revokeMember");
    effects.assertAllowed.mockRejectedValue(denied);

    await expect(service.revokeMember(actor, documentId, "member-1")).rejects.toBe(denied);
    expect(revokeMember).not.toHaveBeenCalled();
  });
});
