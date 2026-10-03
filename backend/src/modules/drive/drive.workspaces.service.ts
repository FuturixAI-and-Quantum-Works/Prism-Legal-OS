import crypto from "node:crypto";
import type { ObjectStore } from "../../storage/types.js";
import type { AccessAuthority } from "../access/access.authority.js";
import type { DriveActivityRepository } from "./drive.activity.js";
import type { DriveWorkspaceRepository } from "./drive.repository.js";
import { DriveStorageCoordinator } from "./drive.storage.js";
import { DriveError, type DriveActor, type WorkspaceMemberRole } from "./drive.types.js";
import type { DriveAuthorizationPolicy } from "./drive.policy.js";
import type { DriveStorageOperationRepository } from "./drive.reconciliation.js";

export type DriveMemberNotifications = Readonly<{
  roleChanged(input: {
    memberUserId: string;
    changerUserId: string;
    workspaceId: string;
    workspaceName: string;
    oldRole: string;
    newRole: string;
  }): Promise<void>;
  removed(input: {
    removedUserId: string;
    removerUserId: string;
    workspaceId: string;
    workspaceName: string;
  }): Promise<void>;
}>;

export class DriveWorkspacesService {
  private readonly storage: DriveStorageCoordinator;

  constructor(
    private readonly repository: DriveWorkspaceRepository,
    private readonly policy: DriveAuthorizationPolicy,
    private readonly authority: AccessAuthority,
    private readonly activity: DriveActivityRepository,
    objectStore: ObjectStore,
    operations: DriveStorageOperationRepository,
    private readonly notifications: DriveMemberNotifications,
  ) {
    this.storage = new DriveStorageCoordinator(objectStore, operations);
  }

  async list(actor: DriveActor) {
    return this.repository.listWorkspaces(
      await this.authority.grants.listWorkspaceGrants({ userId: actor.userId, email: "" }),
    );
  }

  async create(actor: DriveActor, input: { name: string; description: string | null }) {
    const workspace = await this.repository.createWorkspace({
      ownerId: actor.userId,
      ...input,
    });
    await this.activity.recordWorkspace(workspace.id, actor.userId, "workspace_created");
    return workspace;
  }

  async get(actor: DriveActor, workspaceId: string) {
    const access = await this.policy.workspace(actor, workspaceId, "read");
    return {
      ...access,
      collaborators: await this.repository.listWorkspaceMembers(access.workspace.id),
    };
  }

  async update(
    actor: DriveActor,
    workspaceId: string,
    updates: Readonly<{ name?: string; description?: string | null }>,
  ) {
    const access = await this.policy.workspace(actor, workspaceId, "admin");
    const workspace = await this.repository.updateWorkspace(access.workspace.id, updates);
    await this.activity.recordWorkspace(workspace.id, actor.userId, "workspace_updated");
    return { workspace, role: access.role };
  }

  async remove(actor: DriveActor, workspaceId: string): Promise<void> {
    const access = await this.policy.workspace(actor, workspaceId, "owner");
    const operationId = await this.repository.deleteWorkspaceWithStorageOperation(
      access.workspace.id,
      `drive-delete-workspace:${access.workspace.id}:${crypto.randomUUID()}`,
    );
    await this.storage.reconcileDelete(operationId);
  }

  async activityFeed(actor: DriveActor, workspaceId: string) {
    const access = await this.policy.workspace(actor, workspaceId, "read");
    return this.activity.listWorkspace(access.workspace.id);
  }

  async members(actor: DriveActor, workspaceId: string) {
    const access = await this.policy.workspace(actor, workspaceId, "read");
    return {
      ownerId: access.workspace.ownerId,
      members: await this.repository.listWorkspaceMembers(access.workspace.id),
    };
  }

  async upsertMember(
    actor: DriveActor,
    workspaceId: string,
    input: { userId: string; role: WorkspaceMemberRole },
  ) {
    const access = await this.policy.workspace(actor, workspaceId, "admin");
    if (input.userId === access.workspace.ownerId) {
      throw new DriveError(400, "Workspace owner is already a member");
    }
    if (!(await this.repository.findUser(input.userId))) {
      throw new DriveError(404, "User not found");
    }
    const result = await this.repository.upsertWorkspaceMember({
      workspaceId: access.workspace.id,
      userId: input.userId,
      role: input.role,
    });
    await this.activity.recordWorkspace(access.workspace.id, actor.userId, "member_upserted", {
      type: "user",
      id: input.userId,
    });
    if (result.previousRole && result.previousRole !== input.role) {
      await this.notifications.roleChanged({
        memberUserId: input.userId,
        changerUserId: actor.userId,
        workspaceId: access.workspace.id,
        workspaceName: access.workspace.name,
        oldRole: result.previousRole,
        newRole: input.role,
      });
    }
    return { ...result, created: result.previousRole === null };
  }

  async removeMember(actor: DriveActor, workspaceId: string, memberUserId: string): Promise<void> {
    const access = await this.policy.workspace(actor, workspaceId, "admin");
    if (memberUserId === access.workspace.ownerId) {
      throw new DriveError(400, "Cannot remove the workspace owner");
    }
    await this.repository.removeWorkspaceMember(access.workspace.id, memberUserId);
    await this.activity.recordWorkspace(access.workspace.id, actor.userId, "member_removed", {
      type: "user",
      id: memberUserId,
    });
    await this.notifications.removed({
      removedUserId: memberUserId,
      removerUserId: actor.userId,
      workspaceId: access.workspace.id,
      workspaceName: access.workspace.name,
    });
  }
}
