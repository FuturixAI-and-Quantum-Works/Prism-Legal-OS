import type { AccessAuthority } from "../access/access.authority.js";
import type {
  DriveAccessRequest,
  DriveAccessRequestRepository,
  PendingDriveAccessRequest,
} from "./drive.access-request-repository.js";
import { DriveError, type WorkspaceMemberRole } from "./drive.types.js";

export type DriveAccessRequestEvents = Readonly<{
  requested(input: {
    adminUserIds: readonly string[];
    requesterUserId: string;
    accessRequestId: string;
    workspaceId: string;
    workspaceName: string;
    requesterName: string;
    requestedRole: string;
    message?: string;
  }): Promise<void>;
  resolve(accessRequestId: string): Promise<void>;
  approved(input: {
    requesterUserId: string;
    approverUserId: string;
    workspaceId: string;
    workspaceName: string;
    grantedRole: string;
  }): Promise<void>;
  rejected(input: {
    requesterUserId: string;
    rejectorUserId: string;
    workspaceId: string;
    workspaceName: string;
  }): Promise<void>;
}>;

export interface DriveAccessRequests {
  create(input: {
    workspaceId: string;
    requestedByUserId: string;
    requestedRole: WorkspaceMemberRole;
    message?: string;
  }): Promise<DriveAccessRequest>;
  list(workspaceId: string): Promise<readonly PendingDriveAccessRequest[]>;
  approve(input: { requestId: string; reviewedByUserId: string }): Promise<DriveAccessRequest>;
  reject(input: { requestId: string; reviewedByUserId: string }): Promise<DriveAccessRequest>;
}

export class DriveAccessRequestsService implements DriveAccessRequests {
  constructor(
    private readonly repository: DriveAccessRequestRepository,
    private readonly authority: AccessAuthority,
    private readonly events: DriveAccessRequestEvents,
  ) {}

  async create(input: {
    workspaceId: string;
    requestedByUserId: string;
    requestedRole: WorkspaceMemberRole;
    message?: string;
  }): Promise<DriveAccessRequest> {
    const workspace = await this.repository.findWorkspace(input.workspaceId);
    if (!workspace) throw new DriveError(404, "Workspace not found");

    const requester = await this.repository.findUser(input.requestedByUserId);
    const existingGrant = await this.authority.grants.findGrant(
      {
        userId: input.requestedByUserId,
        email: requester?.email.toLowerCase() ?? "",
      },
      { kind: "workspace", id: input.workspaceId },
    );
    if (existingGrant?.source === "owner") {
      throw new DriveError(400, "You are the owner of this workspace");
    }
    if (existingGrant) {
      throw new DriveError(400, "You are already a member of this workspace");
    }

    const request = await this.repository.create({
      workspaceId: input.workspaceId,
      requestedByUserId: input.requestedByUserId,
      requestedRole: input.requestedRole,
      message: input.message ?? null,
    });
    const adminUserIds = [
      ...new Set([
        workspace.ownerId,
        ...(await this.repository.listWorkspaceAdminUserIds(workspace.id)),
      ]),
    ];
    await this.events.requested({
      adminUserIds,
      requesterUserId: input.requestedByUserId,
      accessRequestId: request.id,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      requesterName: requester?.fullName || requester?.email || "Unknown user",
      requestedRole: request.requestedRole,
      message: input.message,
    });
    return request;
  }

  list(workspaceId: string): Promise<readonly PendingDriveAccessRequest[]> {
    return this.repository.listPending(workspaceId);
  }

  approve(input: { requestId: string; reviewedByUserId: string }): Promise<DriveAccessRequest> {
    return this.review({ ...input, status: "approved" });
  }

  reject(input: { requestId: string; reviewedByUserId: string }): Promise<DriveAccessRequest> {
    return this.review({ ...input, status: "rejected" });
  }

  private async review(input: {
    requestId: string;
    reviewedByUserId: string;
    status: "approved" | "rejected";
  }): Promise<DriveAccessRequest> {
    const request = await this.repository.find(input.requestId);
    if (!request) throw new DriveError(404, "Access request not found");
    if (request.status !== "pending") {
      throw new DriveError(400, "Access request has already been processed");
    }

    if (input.status === "approved") {
      await this.repository.upsertWorkspaceMember({
        workspaceId: request.workspaceId,
        userId: request.requestedByUserId,
        role: request.requestedRole,
      });
    }
    const updated = await this.repository.markReviewed({
      ...input,
      reviewedAt: new Date(),
    });
    await this.events.resolve(input.requestId);
    const workspace = await this.repository.findWorkspace(request.workspaceId);
    if (input.status === "approved") {
      await this.events.approved({
        requesterUserId: request.requestedByUserId,
        approverUserId: input.reviewedByUserId,
        workspaceId: request.workspaceId,
        workspaceName: workspace?.name ?? "Workspace",
        grantedRole: request.requestedRole,
      });
    } else {
      await this.events.rejected({
        requesterUserId: request.requestedByUserId,
        rejectorUserId: input.reviewedByUserId,
        workspaceId: request.workspaceId,
        workspaceName: workspace?.name ?? "Workspace",
      });
    }
    return updated;
  }
}
