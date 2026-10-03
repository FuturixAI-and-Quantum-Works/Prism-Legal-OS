import crypto from "node:crypto";
import { getAppConfig } from "../../config.js";
import { enqueueTemplateEmail } from "../../jobs/enqueue.js";
import {
  createAttentionItem,
  createWorkspaceInvitationAttentionItem,
  resolveAttentionItemsBySource,
} from "../../lib/attention.js";
import {
  notifyInvitationAccepted,
  notifyInvitationDeclined,
  notifyWorkspaceInvitation,
} from "../../lib/notifications.js";
import { accessAuthority } from "../access/access.composition.js";
import { recordDocumentActivity } from "../documents/documents.activity.service.js";
import { type ShareInvitationRow, SharingRepository } from "./sharing.repository.js";
import {
  type InviteDelivery,
  type ShareInvitationInput,
  type ShareResourceType,
  SharingError,
} from "./sharing.types.js";

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function resourceId(invitation: ShareInvitationRow): string | null {
  if (invitation.resourceType === "document") return invitation.documentId;
  if (invitation.resourceType === "project") return invitation.projectId;
  if (invitation.resourceType === "workspace") return invitation.workspaceId;
  return null;
}

function sourceType(invitation: ShareInvitationRow) {
  return invitation.resourceType === "workspace"
    ? "workspace_invitation"
    : invitation.resourceType === "project"
      ? "project_invitation"
      : "document_invitation";
}

export class SharingService {
  constructor(private readonly repository = new SharingRepository()) {}

  async create(input: ShareInvitationInput): Promise<{
    invitation: ShareInvitationRow;
    delivery: InviteDelivery;
  }> {
    await this.requireManagement(input.resourceType, input.resourceId, input.invitedByUserId);
    await this.repository.revokePendingDuplicates(
      input.resourceType,
      input.resourceId,
      input.email,
    );
    const token = crypto.randomBytes(32).toString("base64url");
    const inviter = await this.repository.findUser(input.invitedByUserId);
    const senderName = inviter?.fullName || inviter?.email || null;
    const invitation = await this.repository.createInvitation({
      tokenHash: tokenHash(token),
      resourceType: input.resourceType,
      documentId: input.resourceType === "document" ? input.resourceId : null,
      projectId: input.resourceType === "project" ? input.resourceId : null,
      workspaceId: input.resourceType === "workspace" ? input.resourceId : null,
      email: input.email,
      role: input.role,
      invitedByUserId: input.invitedByUserId,
      expiresAt: this.inviteExpiry(),
    });
    await this.sendInvitation(input, invitation, token, senderName);
    const invitee = await this.repository.findUserByEmail(input.email);
    if (invitee) {
      await this.notifyInvitee(input, invitation, invitee.id, senderName);
    }
    return {
      invitation,
      delivery: { email: input.email, status: "queued", attempts: 0 },
    };
  }

  invitationForToken(token: string) {
    return this.loadInvitation(() => this.repository.findInvitationByTokenHash(tokenHash(token)));
  }

  invitationById(invitationId: string) {
    return this.loadInvitation(() => this.repository.findInvitationById(invitationId));
  }

  async acceptByToken(input: { token: string; userId: string; userEmail: string }) {
    return this.decide(
      () => this.repository.findInvitationByTokenHash(tokenHash(input.token)),
      input.userId,
      input.userEmail,
      "accept",
    );
  }

  async declineByToken(input: { token: string; userId: string; userEmail: string }) {
    return this.decide(
      () => this.repository.findInvitationByTokenHash(tokenHash(input.token)),
      input.userId,
      input.userEmail,
      "decline",
    );
  }

  async acceptById(input: { invitationId: string; userId: string; userEmail: string }) {
    return this.decide(
      () => this.repository.findInvitationById(input.invitationId),
      input.userId,
      input.userEmail,
      "accept",
    );
  }

  async declineById(input: { invitationId: string; userId: string; userEmail: string }) {
    return this.decide(
      () => this.repository.findInvitationById(input.invitationId),
      input.userId,
      input.userEmail,
      "decline",
    );
  }

  listPending(input: { resourceType: ShareResourceType; resourceId: string }) {
    return this.repository.listPending(input.resourceType, input.resourceId);
  }

  private async decide(
    load: () => Promise<ShareInvitationRow | null>,
    userId: string,
    userEmail: string,
    action: "accept" | "decline",
  ) {
    const { invitation, resourceName } = await this.loadInvitation(load);
    if (invitation.status === "expired" || invitation.status === "revoked") {
      throw new SharingError(410, "This invitation is no longer active");
    }
    const access = await accessAuthority.decide({
      actor: { userId, email: userEmail.toLowerCase() },
      resource: { kind: "invitation", id: invitation.id },
      action,
    });
    if (!access.allowed) {
      throw new SharingError(403, "This invitation was sent to a different email address");
    }
    if (action === "accept" && invitation.status === "accepted") {
      return { invitation, resourceName };
    }
    if (action === "decline" && invitation.status === "accepted") {
      throw new SharingError(400, "This invitation has already been accepted");
    }

    let decided: ShareInvitationRow | null;
    if (action === "accept") {
      this.requireResourceAssociation(invitation);
      await this.repository.persistAcceptedShare(invitation, userId);
      if (invitation.resourceType === "document" && invitation.documentId) {
        await recordDocumentActivity(
          invitation.documentId,
          invitation.invitedByUserId,
          "document_share_accepted",
          { type: "user", id: userId, name: invitation.email },
          { role: invitation.role },
        );
      }
      decided = await this.repository.acceptInvitation(invitation.id, userId);
    } else {
      decided = await this.repository.declineInvitation(invitation.id);
    }
    const id = resourceId(invitation);
    if (invitation.invitedByUserId && id) {
      if (action === "accept") {
        await notifyInvitationAccepted({
          inviterUserId: invitation.invitedByUserId,
          acceptedByUserId: userId,
          resourceType: invitation.resourceType,
          resourceId: id,
          resourceName,
        });
      } else {
        await notifyInvitationDeclined({
          inviterUserId: invitation.invitedByUserId,
          declinedByUserId: userId,
          resourceType: invitation.resourceType,
          resourceId: id,
          resourceName,
        });
      }
    }
    await resolveAttentionItemsBySource(sourceType(invitation), invitation.id);
    return { invitation: decided ?? invitation, resourceName };
  }

  private async loadInvitation(load: () => Promise<ShareInvitationRow | null>) {
    const invitation = await load();
    if (!invitation) throw new SharingError(404, "Invitation not found");
    if (invitation.status === "pending" && invitation.expiresAt.getTime() < Date.now()) {
      await this.repository.expireInvitation(invitation.id);
      invitation.status = "expired";
    }
    return { invitation, resourceName: await this.repository.resourceName(invitation) };
  }

  private async requireManagement(
    resourceType: ShareResourceType,
    resourceId: string,
    userId: string,
  ) {
    const user = await this.repository.findUser(userId);
    const actor = { userId, email: user?.email.toLowerCase() ?? "" };
    const decision =
      resourceType === "document"
        ? await accessAuthority.decide({
            actor,
            resource: { kind: "document", id: resourceId },
            action: "assign_document_role",
          })
        : resourceType === "project"
          ? await accessAuthority.decide({
              actor,
              resource: { kind: "project", id: resourceId },
              action: "manage",
            })
          : await accessAuthority.decide({
              actor,
              resource: { kind: "workspace", id: resourceId },
              action: "manage",
            });
    if (!decision.allowed) {
      throw new SharingError(
        decision.reason === "not-found" ? 404 : 403,
        "You do not have permission to manage sharing",
      );
    }
  }

  private requireResourceAssociation(invitation: ShareInvitationRow): void {
    if (invitation.resourceType === "document" && !invitation.documentId) {
      throw new SharingError(400, "Invalid document invitation");
    }
    if (invitation.resourceType === "project" && !invitation.projectId) {
      throw new SharingError(400, "Invalid project invitation");
    }
    if (invitation.resourceType === "workspace" && !invitation.workspaceId) {
      throw new SharingError(400, "Invalid workspace invitation");
    }
  }

  private inviteExpiry(): Date {
    const configuredDays = getAppConfig().auth.shareInviteExpiryDays;
    const days = Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : 7;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private async sendInvitation(
    input: ShareInvitationInput,
    invitation: ShareInvitationRow,
    token: string,
    senderName: string | null,
  ) {
    const noun = input.resourceType;
    const template =
      input.resourceType === "document"
        ? "document-invitation"
        : input.resourceType === "project"
          ? "project-invitation"
          : "workspace-invitation";
    await enqueueTemplateEmail({
      idempotencyKey: `share-invitation:${invitation.id}`,
      aggregateType: "share_invitation",
      aggregateId: invitation.id,
      email: {
        to: input.email,
        template,
        category: "collaboration",
        data: {
          subject: `Invitation to collaborate on ${input.resourceName}`,
          title: `${noun[0].toUpperCase()}${noun.slice(1)} invitation`,
          body: `${senderName ?? "A teammate"} invited you to collaborate on "${input.resourceName}" in Prism Legal.`,
          actionUrl: `${getAppConfig().auth.frontendUrl}/share/accept/${token}`,
          senderName,
          documentName: input.resourceType === "document" ? input.resourceName : null,
          projectName: input.resourceType === "project" ? input.resourceName : null,
          workspaceName: input.resourceType === "workspace" ? input.resourceName : null,
          role: input.role === "editor" ? "Editor" : "Viewer",
          expiresAt: invitation.expiresAt,
        },
      },
    });
  }

  private async notifyInvitee(
    input: ShareInvitationInput,
    invitation: ShareInvitationRow,
    inviteeUserId: string,
    senderName: string | null,
  ) {
    if (input.resourceType === "workspace") {
      await createWorkspaceInvitationAttentionItem({
        userId: inviteeUserId,
        invitationId: invitation.id,
        workspaceId: input.resourceId,
        workspaceName: input.resourceName,
        inviterName: senderName ?? "A teammate",
        role: input.role,
      });
      await notifyWorkspaceInvitation({
        inviteeUserId,
        inviterUserId: input.invitedByUserId,
        workspaceId: input.resourceId,
        workspaceName: input.resourceName,
        role: input.role,
      });
      return;
    }
    await createAttentionItem({
      userId: inviteeUserId,
      sourceType: sourceType(invitation),
      sourceId: invitation.id,
      secondarySourceId: input.resourceId,
      severity: "medium",
      title: `Invitation to collaborate on "${input.resourceName}"`,
      description: `${senderName ?? "A teammate"} invited you to join as ${input.role}`,
      metadata: {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        resourceName: input.resourceName,
        inviterName: senderName,
        role: input.role,
        createdAt: new Date().toISOString(),
      },
    });
  }
}

export const sharingService = new SharingService();
