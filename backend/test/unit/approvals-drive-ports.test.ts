import { describe, expect, it, vi } from "vitest";
import {
  type ApprovalRequestRow,
  ApprovalsRepository,
} from "../../src/modules/approvals/approvals.repository.js";
import { ApprovalsService } from "../../src/modules/approvals/approvals.service.js";
import type { AccessGrant } from "../../src/modules/access/access.types.js";
import {
  DriveAuthorizationPolicy,
  DriveFileAccessPolicy,
} from "../../src/modules/drive/drive.policy.js";
import type { DriveFile } from "../../src/modules/drive/drive.types.js";
import { ownerGrant, stubAccessAuthority } from "./access-test-helpers.js";

const file: DriveFile = {
  id: "file-1",
  userId: "owner-1",
  workspaceId: "workspace-1",
  folderId: null,
  name: "contract.pdf",
  description: null,
  storagePath: "drive/file-1.pdf",
  sizeBytes: 100n,
  mimeType: "application/pdf",
  extension: ".pdf",
  checksum: "checksum",
  version: 1,
  isPrimary: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastAccessedAt: new Date(),
};

const request: ApprovalRequestRow = {
  id: "request-1",
  subjectType: "drive_file",
  subjectId: file.id,
  approverId: "approver-1",
  role: "legal_reviewer",
  approverName: "Legal Reviewer",
  approverEmail: "approver@example.com",
  status: "pending",
  token: "token-hash",
  decisionNote: null,
  requestedByUserId: "owner-1",
  decidedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
  updatedAt: new Date(),
};

function decisionService(email: string) {
  const repository: ApprovalsRepository = Object.create(ApprovalsRepository.prototype);
  vi.spyOn(repository, "findRequestById").mockResolvedValue(request);
  vi.spyOn(repository, "findRequestByTokenHash").mockResolvedValue(request);
  vi.spyOn(repository, "findVerifiedUserById").mockResolvedValue({
    id: "approver-user-1",
    email,
  });
  vi.spyOn(repository, "listRoles").mockResolvedValue([
    {
      key: request.role,
      label: "Legal reviewer",
      description: null,
      enabled: true,
      sortOrder: 1,
    },
  ]);
  vi.spyOn(repository, "decideRequest").mockImplementation(async (input) => ({
    ...request,
    status: input.status,
    decisionNote: input.decisionNote,
    decidedAt: input.decidedAt,
    updatedAt: input.decidedAt,
  }));
  return {
    repository,
    service: new ApprovalsService(
      repository,
      { file: vi.fn(async () => file) },
      { findFile: vi.fn(async () => file) },
      {
        recordFile: vi.fn(async () => undefined),
        recordWorkspace: vi.fn(async () => undefined),
      },
    ),
  };
}

function drivePolicyService(storedFile: DriveFile | null, grant: AccessGrant | null) {
  const repository: ApprovalsRepository = Object.create(ApprovalsRepository.prototype);
  vi.spyOn(repository, "listApprovers").mockResolvedValue([]);
  vi.spyOn(repository, "listRoles").mockResolvedValue([]);
  const drivePolicy = new DriveAuthorizationPolicy(
    {
      workspaces: {
        findWorkspace: async () => ({
          id: "workspace-1",
          ownerId: "owner-1",
          name: "Workspace",
          description: null,
          storageAllocatedBytes: 100n,
          storageUsedBytes: 0n,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      files: { findFile: async () => storedFile },
      folders: { findFolder: async () => null },
    },
    stubAccessAuthority(() => grant),
  );
  return new ApprovalsService(
    repository,
    new DriveFileAccessPolicy(drivePolicy),
    { findFile: vi.fn(async () => storedFile) },
    {
      recordFile: vi.fn(async () => undefined),
      recordWorkspace: vi.fn(async () => undefined),
    },
  );
}

const actor = { userId: "actor-1", email: "actor@example.com" };

describe("ApprovalsService drive access errors", () => {
  it("reports a workspace viewer editing approvers as a file permission error", async () => {
    const service = drivePolicyService(file, { ...ownerGrant, role: "viewer", source: "member" });

    await expect(service.upsertApprovers(actor, "drive_file", file.id, [])).rejects.toMatchObject({
      status: 403,
      message: "You do not have permission to access this file",
    });
  });

  it("reports a file in an unshared workspace as a file permission error", async () => {
    const service = drivePolicyService(file, null);

    await expect(service.listApprovers(actor, "drive_file", file.id)).rejects.toMatchObject({
      status: 404,
      message: "You do not have permission to access this file",
    });
  });

  it("reports a missing drive file as not found", async () => {
    const service = drivePolicyService(null, ownerGrant);

    await expect(service.listApprovers(actor, "drive_file", file.id)).rejects.toMatchObject({
      status: 404,
      message: "File not found",
    });
  });
});

describe("ApprovalsService drive ports", () => {
  it("authorizes drive subjects through the injected drive policy", async () => {
    const repository: ApprovalsRepository = Object.create(ApprovalsRepository.prototype);
    vi.spyOn(repository, "listApprovers").mockResolvedValue([]);
    vi.spyOn(repository, "listRoles").mockResolvedValue([]);
    const authorizeFile = vi.fn(async () => file);
    const service = new ApprovalsService(
      repository,
      { file: authorizeFile },
      { findFile: vi.fn(async () => file) },
      {
        recordFile: vi.fn(async () => undefined),
        recordWorkspace: vi.fn(async () => undefined),
      },
    );

    await expect(
      service.listApprovers(
        { userId: "actor-1", email: "actor@example.com" },
        "drive_file",
        file.id,
      ),
    ).resolves.toEqual([]);
    expect(authorizeFile).toHaveBeenCalledWith({ userId: "actor-1" }, file.id, "read");
  });

  it("rejects an authenticated decision from a different document reader", async () => {
    const { repository, service } = decisionService("reader@example.com");

    await expect(
      service.decide({
        userId: "reader-1",
        requestIdOrToken: request.id,
        status: "approved",
        note: null,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.decideRequest).not.toHaveBeenCalled();
  });

  it("accepts the designated approver's normalized authenticated email", async () => {
    const { repository, service } = decisionService("  APPROVER@EXAMPLE.COM ");

    await expect(
      service.decide({
        userId: "approver-user-1",
        requestIdOrToken: request.id,
        status: "approved",
        note: "Approved",
      }),
    ).resolves.toMatchObject({ id: request.id, status: "approved" });
    expect(repository.decideRequest).toHaveBeenCalledOnce();
  });

  it("preserves decisions made with the designated secret token", async () => {
    const { repository, service } = decisionService("reader@example.com");

    await expect(
      service.decide({
        userId: null,
        requestIdOrToken: "secret-token",
        status: "approved",
        note: null,
        byToken: true,
      }),
    ).resolves.toEqual({
      role_label: "Legal reviewer",
      approver_name: request.approverName,
      status: "approved",
    });
    expect(repository.findVerifiedUserById).not.toHaveBeenCalled();
    expect(repository.decideRequest).toHaveBeenCalledOnce();
  });
});
