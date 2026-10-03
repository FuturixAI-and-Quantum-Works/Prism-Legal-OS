import { accessAuthority } from "../access/access.composition.js";
import type { DocumentRole } from "../access/access.types.js";
import {
  assertDocumentActionAllowed,
  loadDocumentSessionContext,
} from "./documents.permissions.service.js";
import { type ShareRole } from "../sharing/sharing.types.js";
import { sharingService } from "../sharing/sharing.service.js";
import type { RequestUserContext } from "./documents.models.js";
import { documentActivityService, recordDocumentActivity } from "./documents.activity.service.js";
import { documentLifecycleService } from "./documents.lifecycle.service.js";
import {
  notifyDocumentRole,
  recordAndSendDocumentEmail,
} from "./documents.notifications.service.js";
import {
  type CommentUpdate,
  DocumentGovernanceRepository,
} from "./documents.governance.repository.js";
import {
  type DeferredValue,
  type LifecycleAction,
  requireDeferredValue,
} from "./documents.governance.validators.js";

export class DocumentGovernanceError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "DocumentGovernanceError";
  }
}

type GovernanceDocument = NonNullable<
  Awaited<ReturnType<DocumentGovernanceRepository["findDocument"]>>
>;
type CommentRow = Awaited<ReturnType<DocumentGovernanceRepository["listComments"]>>[number];

export type CreateCommentInput = Readonly<{
  versionId: string | null;
  parentCommentId: string | null;
  body: DeferredValue<string>;
  anchorText: string | null;
  anchorStart: number | null;
  anchorEnd: number | null;
}>;

export type UpdateCommentInput = Readonly<{
  body: DeferredValue<string> | null;
  resolved: boolean | null;
}>;

type AssignMemberInput = Readonly<{
  email: string | null;
  targetUserId: string | null;
  role: DocumentRole;
}>;

function sessionDto(context: Awaited<ReturnType<typeof loadDocumentSessionContext>>) {
  return {
    document_id: context.document_id,
    document_state: context.document_state,
    document_role: context.document_role,
    role_badge: context.role_badge,
    product_role: context.product_role,
    access_source: context.access_source,
    is_owner: context.is_owner,
    is_workspace_admin: context.is_workspace_admin,
    is_owner_admin: context.is_owner_admin,
    allowed_actions: context.allowed_actions,
    visible_tabs: context.visible_tabs,
  };
}

function normalizeEmailAddress(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function extractMentionEmails(body: string): string[] {
  const emails = new Set<string>();
  const bracketMention = /<@([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>/gi;
  const plainMention = /(^|[\s([{,;])@([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
  for (const match of body.matchAll(bracketMention)) {
    const email = normalizeEmailAddress(match[1]);
    if (email) emails.add(email);
  }
  for (const match of body.matchAll(plainMention)) {
    const email = normalizeEmailAddress(match[2]);
    if (email) emails.add(email);
  }
  return [...emails];
}

function commentExcerpt(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

function commentDto(row: CommentRow) {
  return {
    id: row.id,
    document_id: row.documentId,
    version_id: row.versionId,
    user_id: row.userId,
    user_email: row.userEmail ?? null,
    user_name: row.userName ?? null,
    parent_comment_id: row.parentCommentId,
    body: row.body,
    anchor_text: row.anchorText,
    anchor_start: row.anchorStart,
    anchor_end: row.anchorEnd,
    metadata: row.metadata ?? {},
    resolved: row.resolved,
    resolved_by_user_id: row.resolvedByUserId,
    resolved_at: row.resolvedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export class DocumentGovernanceService {
  constructor(readonly repository = new DocumentGovernanceRepository()) {}

  private async requireDocument(
    actor: RequestUserContext,
    documentId: string,
  ): Promise<GovernanceDocument> {
    const document = await this.repository.findDocument(documentId);
    if (!document) throw new DocumentGovernanceError(404, "Document not found");
    const access = await accessAuthority.decide({
      actor: { userId: actor.userId, email: actor.userEmail?.toLowerCase() ?? "" },
      resource: { kind: "document", id: documentId },
      action: "read_document",
    });
    if (!access.allowed) throw new DocumentGovernanceError(404, "Document not found");
    return document;
  }

  async sessionContext(actor: RequestUserContext, documentId: string) {
    return sessionDto(
      await loadDocumentSessionContext(documentId, actor.userId, actor.userEmail ?? undefined),
    );
  }

  async listMembers(actor: RequestUserContext, documentId: string) {
    await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      "assign_document_role",
    );
    return this.repository.listMembers(documentId);
  }

  async assignMember(actor: RequestUserContext, documentId: string, input: AssignMemberInput) {
    await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      "assign_document_role",
    );
    const email = input.email?.trim().toLowerCase() || null;
    const targetUserId = input.targetUserId?.trim() || null;
    if (!email && !targetUserId) {
      throw new DocumentGovernanceError(400, "email or user_id is required");
    }
    const member = await this.repository.assignMember({
      documentId,
      assignedByUserId: actor.userId,
      email,
      targetUserId,
      role: input.role,
    });
    await recordDocumentActivity(
      documentId,
      actor.userId,
      "document_role_assigned",
      { type: "member", id: member.id },
      { role: input.role, email, user_id: targetUserId },
    );
    if (email) {
      await recordAndSendDocumentEmail(
        documentId,
        email,
        "role-assignment",
        "role_assignment",
        "Document role assigned",
        `You have been assigned ${input.role} access. Open the document from your workspace.`,
      );
    }
    return member;
  }

  async revokeMember(
    actor: RequestUserContext,
    documentId: string,
    memberId: string,
  ): Promise<void> {
    await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      "assign_document_role",
    );
    const member = await this.repository.revokeMember(documentId, memberId);
    if (!member) throw new DocumentGovernanceError(404, "Document member not found");
    await recordDocumentActivity(
      documentId,
      actor.userId,
      "document_role_revoked",
      { type: "member", id: member.id },
      { role: member.role, email: member.email },
    );
  }

  async listShares(actor: RequestUserContext, documentId: string) {
    await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      "assign_document_role",
    );
    const shares = await this.repository.listShares(documentId);
    const pending = await sharingService.listPending({
      resourceType: "document",
      resourceId: documentId,
    });
    return { shares, pending_invitations: pending };
  }

  async invite(
    actor: RequestUserContext,
    documentId: string,
    input: Readonly<{ email: string; role: ShareRole }>,
  ) {
    await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      "assign_document_role",
    );
    const document = await this.repository.findDocument(documentId);
    if (!document) throw new DocumentGovernanceError(404, "Document not found");
    const ownerEmail = await this.repository.findUserEmail(document.userId);
    if (ownerEmail?.toLowerCase() === input.email) {
      throw new DocumentGovernanceError(400, "Document owner already has access");
    }
    const result = await sharingService.create({
      resourceType: "document",
      resourceId: document.id,
      resourceName: document.filename,
      email: input.email,
      role: input.role,
      invitedByUserId: actor.userId,
    });
    await recordDocumentActivity(
      document.id,
      actor.userId,
      "document_share_invited",
      { type: "email", id: result.invitation.id, name: input.email },
      {
        role: input.role,
        delivery: result.delivery.status,
        error: result.delivery.error ?? null,
      },
    );
    return {
      invitation: {
        id: result.invitation.id,
        email: result.invitation.email,
        role: result.invitation.role,
        status: result.invitation.status,
        expires_at: result.invitation.expiresAt,
        created_at: result.invitation.createdAt,
      },
      delivery: result.delivery,
    };
  }

  async updateShare(
    actor: RequestUserContext,
    documentId: string,
    shareId: string,
    role: ShareRole,
  ) {
    await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      "assign_document_role",
    );
    const share = await this.repository.updateShareRole(documentId, shareId, role);
    if (!share) throw new DocumentGovernanceError(404, "Document share not found");
    await recordDocumentActivity(
      documentId,
      actor.userId,
      "document_share_role_changed",
      { type: "user", id: share.userId ?? share.id, name: share.email },
      { role },
    );
    return share;
  }

  async removeShare(actor: RequestUserContext, documentId: string, shareId: string): Promise<void> {
    await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      "assign_document_role",
    );
    const share = await this.repository.deleteShare(documentId, shareId);
    if (!share) throw new DocumentGovernanceError(404, "Document share not found");
    await recordDocumentActivity(
      documentId,
      actor.userId,
      "document_share_removed",
      { type: "email", id: share.id, name: share.email },
      { role: share.role },
    );
  }

  async transition(
    actor: RequestUserContext,
    documentId: string,
    action: LifecycleAction,
    note: string | null,
    rejectionTarget: Parameters<typeof documentLifecycleService.transition>[5],
  ) {
    return sessionDto(
      await documentLifecycleService.transition(
        documentId,
        actor.userId,
        actor.userEmail ?? undefined,
        action,
        note,
        action === "reject_document" ? rejectionTarget : null,
      ),
    );
  }

  async listChatMessages(actor: RequestUserContext, documentId: string) {
    await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      "read_document",
    );
    return this.repository.listChatMessages(documentId);
  }

  async listComments(actor: RequestUserContext, documentId: string) {
    await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      "read_document",
    );
    return (await this.repository.listComments(documentId)).map(commentDto);
  }

  private async notifyMentionedUsers(
    document: GovernanceDocument,
    comment: { id: string; body: string },
    actor: RequestUserContext,
  ): Promise<void> {
    const mentioned = extractMentionEmails(comment.body);
    if (mentioned.length === 0) return;
    const allowed = new Set(
      (
        await this.repository.listMentionableEmails(
          document.id,
          document.userId,
          document.workspaceId,
        )
      )
        .map(normalizeEmailAddress)
        .filter((email): email is string => Boolean(email)),
    );
    const actorEmail = normalizeEmailAddress(actor.userEmail);
    if (actorEmail) allowed.delete(actorEmail);
    const recipients = mentioned.filter((email) => allowed.has(email));
    if (recipients.length === 0) return;
    const excerpt = commentExcerpt(comment.body);
    await Promise.all(
      recipients.map((email) =>
        recordAndSendDocumentEmail(
          document.id,
          email,
          "mention-notification",
          "comment_mention",
          "You were mentioned in a document comment",
          `A comment mentioned you in ${document.filename}: "${excerpt}"`,
        ),
      ),
    );
    await recordDocumentActivity(
      document.id,
      actor.userId,
      "comment_mentions_notified",
      { type: "comment", id: comment.id },
      { recipient_count: recipients.length, recipients },
    );
  }

  async createComment(actor: RequestUserContext, documentId: string, input: CreateCommentInput) {
    const context = await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      "add_comment",
    );
    const document = await this.requireDocument(actor, documentId);
    if (input.versionId && !(await this.repository.versionExists(document.id, input.versionId))) {
      throw new DocumentGovernanceError(400, "version_id does not belong to this document");
    }
    if (
      input.parentCommentId &&
      !(await this.repository.commentExists(document.id, input.parentCommentId))
    ) {
      throw new DocumentGovernanceError(400, "parent_comment_id does not belong to this document");
    }
    const comment = await this.repository.createComment({
      documentId: document.id,
      versionId: input.versionId,
      userId: actor.userId,
      parentCommentId: input.parentCommentId,
      body: requireDeferredValue(input.body),
      anchorText: input.anchorText,
      anchorStart: input.anchorStart,
      anchorEnd: input.anchorEnd,
    });
    await recordDocumentActivity(document.id, actor.userId, "comment_created", {
      type: "comment",
      id: comment.id,
    });
    if (context.document_role === "REVIEWER") {
      await notifyDocumentRole(
        document.id,
        "DRAFTER",
        "mention-notification",
        "reviewer_comment",
        "Reviewer comment added",
        "A reviewer added a comment. Open the document to review it.",
      );
    }
    await this.notifyMentionedUsers(document, comment, actor);
    return commentDto({ ...comment, userEmail: null, userName: null });
  }

  async updateComment(
    actor: RequestUserContext,
    documentId: string,
    commentId: string,
    input: UpdateCommentInput,
  ) {
    await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      "resolve_comment",
    );
    const document = await this.requireDocument(actor, documentId);
    const updates: CommentUpdate = {
      ...(input.body ? { body: requireDeferredValue(input.body) } : {}),
      ...(input.resolved !== null
        ? {
            resolved: input.resolved,
            resolvedByUserId: input.resolved ? actor.userId : null,
            resolvedAt: input.resolved ? new Date() : null,
          }
        : {}),
      updatedAt: new Date(),
    };
    if (Object.keys(updates).length === 1) {
      throw new DocumentGovernanceError(400, "No valid fields to update");
    }
    const comment = await this.repository.updateComment(document.id, commentId, updates);
    if (!comment) throw new DocumentGovernanceError(404, "Comment not found");
    await recordDocumentActivity(
      document.id,
      actor.userId,
      updates.resolved === true
        ? "comment_resolved"
        : updates.resolved === false
          ? "comment_reopened"
          : "comment_updated",
      { type: "comment", id: comment.id },
    );
    return commentDto({ ...comment, userEmail: null, userName: null });
  }

  async deleteComment(
    actor: RequestUserContext,
    documentId: string,
    commentId: string,
  ): Promise<void> {
    await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      "assign_document_role",
    );
    const document = await this.requireDocument(actor, documentId);
    const deletedId = await this.repository.deleteComment(document.id, commentId);
    if (!deletedId) throw new DocumentGovernanceError(404, "Comment not found");
    await recordDocumentActivity(document.id, actor.userId, "comment_deleted", {
      type: "comment",
      id: deletedId,
    });
  }

  async listActivity(actor: RequestUserContext, documentId: string) {
    await assertDocumentActionAllowed(
      documentId,
      actor.userId,
      actor.userEmail ?? undefined,
      "get_audit_trail",
    );
    return documentActivityService.list(actor, documentId);
  }
}
