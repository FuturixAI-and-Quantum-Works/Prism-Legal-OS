import type { AccessAuthority } from "../access/access.authority.js";
import type {
  DriveAccessLevel,
  DriveActor,
  DriveFile,
  DriveFolder,
  WorkspaceAccess,
} from "./drive.types.js";
import { DriveError } from "./drive.types.js";

export type DrivePolicyRepository = Readonly<{
  workspaces: {
    findWorkspace(workspaceId: string): Promise<WorkspaceAccess["workspace"] | null>;
  };
  files: {
    findFile(fileId: string): Promise<DriveFile | null>;
  };
  folders: {
    findFolder(folderId: string): Promise<DriveFolder | null>;
  };
}>;

export type DriveFileAuthorizationPolicy = Pick<DriveAuthorizationPolicy, "file">;

export class DriveAuthorizationPolicy {
  constructor(
    private readonly repository: DrivePolicyRepository,
    private readonly authority: AccessAuthority,
  ) {}

  async workspace(
    actor: DriveActor,
    workspaceId: string,
    level: DriveAccessLevel,
  ): Promise<WorkspaceAccess> {
    const decision = await this.authority.decide({
      actor: { userId: actor.userId, email: "" },
      resource: { kind: "workspace", id: workspaceId },
      action: level === "admin" ? "manage" : level === "owner" ? "delete" : level,
    });
    if (!decision.allowed) {
      if (decision.reason === "not-found") throw new DriveError(404, "Workspace not found");
      throw new DriveError(403, permissionMessage(level));
    }
    const workspace = await this.repository.workspaces.findWorkspace(workspaceId);
    if (!workspace) throw new DriveError(404, "Workspace not found");
    return { workspace, role: decision.grant.role };
  }

  async scope(
    actor: DriveActor,
    workspaceId: string | null,
    level: "read" | "write",
  ): Promise<void> {
    if (workspaceId) await this.workspace(actor, workspaceId, level);
  }

  async file(actor: DriveActor, fileId: string, level: "read" | "write"): Promise<DriveFile> {
    const file = await this.repository.files.findFile(fileId);
    if (!file) throw new DriveError(404, "File not found");
    if (file.workspaceId) {
      await this.workspace(actor, file.workspaceId, level);
    } else if (file.userId !== actor.userId) {
      throw new DriveError(404, "File not found");
    }
    return file;
  }

  async folder(actor: DriveActor, folderId: string, level: "read" | "write"): Promise<DriveFolder> {
    const folder = await this.repository.folders.findFolder(folderId);
    if (!folder) throw new DriveError(404, "Folder not found");
    if (folder.workspaceId) {
      await this.workspace(actor, folder.workspaceId, level);
    } else if (folder.userId !== actor.userId) {
      throw new DriveError(404, "Folder not found");
    }
    return folder;
  }

  async folderInScope(
    actor: DriveActor,
    folderId: string | null,
    workspaceId: string | null,
    level: "read" | "write",
  ): Promise<DriveFolder | null> {
    if (!folderId) return null;
    const folder = await this.folder(actor, folderId, level);
    if ((folder.workspaceId ?? null) !== workspaceId) {
      throw new DriveError(404, "Folder not found in target scope");
    }
    return folder;
  }
}

export class DriveFileAccessPolicy implements DriveFileAuthorizationPolicy {
  constructor(private readonly policy: DriveFileAuthorizationPolicy) {}

  async file(...input: Parameters<DriveFileAuthorizationPolicy["file"]>) {
    try {
      return await this.policy.file(...input);
    } catch (error) {
      if (error instanceof DriveError && error.message !== "File not found") {
        throw new DriveError(error.status, "You do not have permission to access this file", {
          cause: error,
        });
      }
      throw error;
    }
  }
}

function permissionMessage(level: DriveAccessLevel): string {
  if (level === "admin") return "Only workspace owners and admins can manage this workspace";
  if (level === "owner") return "Only the workspace owner can perform this action";
  return "You do not have permission to modify this workspace";
}
