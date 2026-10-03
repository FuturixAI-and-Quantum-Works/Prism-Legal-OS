import { describe, expect, it, vi } from "vitest";
import { DriveFileAccessPolicy } from "../../src/modules/drive/drive.access.js";
import { DriveAuthorizationPolicy } from "../../src/modules/drive/drive.policy.js";
import {
  DriveError,
  type DriveFile,
  type DriveWorkspace,
  type WorkspaceRole,
} from "../../src/modules/drive/drive.types.js";
import { DriveWorkspacesService } from "../../src/modules/drive/drive.workspaces.service.js";
import { ownerGrant, stubAccessAuthority } from "./access-test-helpers.js";

const workspace: DriveWorkspace = {
  id: "workspace-1",
  ownerId: "owner-1",
  name: "Workspace",
  description: null,
  storageAllocatedBytes: 100n,
  storageUsedBytes: 0n,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const file: DriveFile = {
  id: "file-1",
  userId: "owner-1",
  workspaceId: workspace.id,
  folderId: null,
  name: "terms.pdf",
  description: null,
  storagePath: "workspaces/workspace-1/files/file-1/source.pdf",
  sizeBytes: 10n,
  mimeType: "application/pdf",
  extension: ".pdf",
  checksum: "checksum",
  version: 1,
  isPrimary: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastAccessedAt: new Date(),
};

function policy(role: WorkspaceRole | null) {
  const findWorkspace = vi.fn(async () => workspace);
  const authority = stubAccessAuthority(() =>
    role
      ? {
          role,
          source: role === "owner" ? "owner" : "member",
          documentRole: null,
          documentLifecycle: null,
        }
      : null,
  );
  return {
    instance: new DriveAuthorizationPolicy(
      {
        workspaces: { findWorkspace },
        files: { findFile: async () => file },
        folders: { findFolder: async () => null },
      },
      authority,
    ),
    findWorkspace,
  };
}

describe("DriveAuthorizationPolicy", () => {
  it.each([
    ["owner", true],
    ["admin", true],
    ["editor", true],
    ["viewer", false],
  ] as const)("enforces workspace write access for %s", async (role, allowed) => {
    const { instance } = policy(role);
    const operation = instance.workspace({ userId: "actor-1" }, workspace.id, "write");
    if (allowed) {
      await expect(operation).resolves.toMatchObject({ role });
    } else {
      await expect(operation).rejects.toMatchObject({ status: 403 });
    }
  });

  it("checks the workspace role before returning a workspace file", async () => {
    const { instance, findWorkspace } = policy("viewer");
    await expect(instance.file({ userId: "actor-1" }, file.id, "read")).resolves.toEqual(file);
    expect(findWorkspace).toHaveBeenCalledWith(workspace.id);
  });

  it("does not reveal inaccessible resources", async () => {
    const { instance } = policy(null);
    await expect(instance.file({ userId: "actor-1" }, file.id, "read")).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("DriveWorkspacesService.list", () => {
  it("lists the workspaces the actor holds grants for", async () => {
    const grants = new Map([[workspace.id, ownerGrant]]);
    const listWorkspaceGrants = vi.fn(async () => grants);
    const listWorkspaces = vi.fn(async () => []);
    const authority = stubAccessAuthority(undefined, { listWorkspaceGrants });
    const service = new DriveWorkspacesService(
      { listWorkspaces } as never,
      new DriveAuthorizationPolicy(
        {
          workspaces: { findWorkspace: async () => workspace },
          files: { findFile: async () => file },
          folders: { findFolder: async () => null },
        },
        authority,
      ),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.list({ userId: "actor-1" });

    expect(listWorkspaceGrants).toHaveBeenCalledWith({ userId: "actor-1", email: "" });
    expect(listWorkspaces).toHaveBeenCalledWith(grants);
  });
});

describe("DriveFileAccessPolicy", () => {
  it("preserves file-specific denial messages for cross-slice callers", async () => {
    const policy = new DriveFileAccessPolicy({
      file: vi.fn(async () => {
        throw new DriveError(403, "You do not have permission to modify this workspace");
      }),
    });

    await expect(policy.file({ userId: "actor-1" }, file.id, "read")).rejects.toMatchObject({
      status: 403,
      message: "You do not have permission to access this file",
    });
  });

  it("preserves the missing-file response", async () => {
    const missing = new DriveError(404, "File not found");
    const policy = new DriveFileAccessPolicy({
      file: vi.fn(async () => {
        throw missing;
      }),
    });

    await expect(policy.file({ userId: "actor-1" }, file.id, "read")).rejects.toBe(missing);
  });
});
