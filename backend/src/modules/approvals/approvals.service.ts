import crypto from "node:crypto";
import { getAppConfig } from "../../config.js";
import { enqueueTemplateEmail } from "../../jobs/enqueue.js";
import {
  notifyApprovalRequested,
  notifyDocumentApproved,
  notifyDocumentRejected,
} from "../../lib/notifications.js";
import { accessAuthority } from "../access/access.composition.js";
import { recordDocumentActivity } from "../documents/documents.activity.service.js";
import { createProductionDriveCore } from "../drive/drive.composition.js";
import type { DriveActivityWriter } from "../drive/drive.activity.js";
import type { DriveFileAuthorizationPolicy } from "../drive/drive.policy.js";
import type { DriveFileReader } from "../drive/drive.repository.js";
import {
  compileApprovalPolicy,
  getApprovalReason,
  getApproverRoleLabel,
  getApproversForChange,
  getChangesByApprover,
  getRequiredApprovers,
  parseApproverRole,
  roleOptions,
} from "./approvals.policy.js";
import { type ApprovalRequestRow, ApprovalsRepository } from "./approvals.repository.js";
import {
  type ApprovalActor,
  type ApprovalChange,
  ApprovalError,
  type ApprovalPolicy,
  type ApprovalRoleDefinition,
  type ApprovalSubject,
  type ApprovalSubjectType,
  type ApproverRole,
} from "./approvals.types.js";

type ApproverInput = Readonly<{
  role: ApproverRole;
  approverName: string;
  approverEmail: string;
}>;

export function hashApprovalToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") throw new ApprovalError(400, "approver_email is required");
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApprovalError(400, "Invalid approver email");
  }
  return email;
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApprovalError(400, "approver_name is required");
  }
  return value.trim().slice(0, 255);
}

function sameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseApprovalSubjectType(value: string): ApprovalSubjectType {
  if (value === "document" || value === "drive_file" || value === "workspace") return value;
  throw new ApprovalError(500, "Approval request has an invalid subject type");
}

function normalizeApprover(
  value: unknown,
  enabledRoles: ReadonlyMap<ApproverRole, ApprovalRoleDefinition>,
): ApproverInput {
  if (!isRecord(value)) throw new ApprovalError(400, "Invalid approver");
  const input = value;
  let role: ApproverRole;
  try {
    role = parseApproverRole(input.role ?? input.approver_role);
  } catch {
    throw new ApprovalError(400, "Invalid approver role");
  }
  if (!enabledRoles.has(role)) throw new ApprovalError(400, "Invalid approver role");
  return {
    role,
    approverName: normalizeName(input.approver_name ?? input.approverName),
    approverEmail: normalizeEmail(input.approver_email ?? input.approverEmail),
  };
}

function inferSectionName(row: {
  contextBefore: string | null;
  contextAfter: string | null;
  deletedText: string | null;
  insertedText: string | null;
  changeId: string;
}): string {
  const text = [row.contextBefore, row.deletedText, row.insertedText, row.contextAfter]
    .filter(Boolean)
    .join(" ");
  return (
    text.match(
      /\b((?:Clause|Section|Article)\s+\d+(?:\.\d+)?|Recital\s+[A-Z]|Parties|Preamble)\b/i,
    )?.[1] ?? `Change ${row.changeId}`
  );
}

function changeDto(change: ApprovalChange, policy: ApprovalPolicy, role?: ApproverRole) {
  return {
    id: change.id,
    decision: change.decision,
    section_name: change.sectionName,
    original_text: change.originalText,
    new_text: change.newText,
    ai_summary: change.aiSummary,
    required_roles: getApproversForChange(policy, change),
    reason: role ? getApprovalReason(policy, role, [change]) : null,
  };
}

function requestDto(
  row: ApprovalRequestRow,
  roles: ReadonlyMap<ApproverRole, ApprovalRoleDefinition>,
  itemCount = 0,
) {
  return {
    id: row.id,
    subject_type: row.subjectType,
    subject_id: row.subjectId,
    approver_id: row.approverId,
    role: row.role,
    role_label: getApproverRoleLabel(row.role, roles),
    approver_name: row.approverName,
    approver_email: row.approverEmail,
    status: row.status,
    decision_note: row.decisionNote,
    requested_by_user_id: row.requestedByUserId,
    decided_at: row.decidedAt,
    expires_at: row.expiresAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    item_count: itemCount,
  };
}

export function publicApprovalRequestDto(
  row: Pick<ApprovalRequestRow, "role" | "approverName" | "status">,
  roleLabel: string,
) {
  return { role_label: roleLabel, approver_name: row.approverName, status: row.status };
}

export function publicApprovalItemDto(item: { id: string; title: string; reason: string | null }) {
  return { id: item.id, title: item.title, reason: item.reason };
}

export class ApprovalsService {
  constructor(
    private readonly repository: ApprovalsRepository,
    private readonly drivePolicy: DriveFileAuthorizationPolicy,
    private readonly driveFiles: DriveFileReader,
    private readonly driveActivity: DriveActivityWriter,
  ) {}

  private async loadPolicy(subjectType: ApprovalSubjectType): Promise<ApprovalPolicy> {
    const [roles, rules] = await Promise.all([
      this.repository.listRoles(),
      this.repository.listRules(subjectType),
    ]);
    return compileApprovalPolicy(roles, rules);
  }

  private async roleMap(): Promise<Map<ApproverRole, ApprovalRoleDefinition>> {
    return new Map((await this.repository.listRoles()).map((role) => [role.key, role]));
  }

  private async requireSubject(
    actor: ApprovalActor,
    subjectType: ApprovalSubjectType,
    subjectId: string,
    write = false,
  ): Promise<ApprovalSubject> {
    if (subjectType === "document") {
      const document = await this.repository.findDocument(subjectId);
      if (!document) throw new ApprovalError(404, "Document not found");
      const decision = await accessAuthority.decide({
        actor,
        resource: { kind: "document", id: subjectId },
        action: write ? "edit_document" : "read_document",
      });
      if (!decision.allowed) throw new ApprovalError(404, "Document not found");
      return {
        subjectType,
        subjectId,
        label: document.filename,
        ownerId: document.userId,
      };
    }
    if (subjectType === "drive_file") {
      const file = await this.drivePolicy.file(
        { userId: actor.userId },
        subjectId,
        write ? "write" : "read",
      );
      return { subjectType, subjectId, label: file.name, ownerId: file.userId };
    }
    const decision = await accessAuthority.decide({
      actor,
      resource: { kind: "workspace", id: subjectId },
      action: write ? "write" : "read",
    });
    if (!decision.allowed) throw new ApprovalError(404, "Workspace not found");
    const workspace = await this.repository.findWorkspace(subjectId);
    if (!workspace) throw new ApprovalError(404, "Workspace not found");
    return {
      subjectType,
      subjectId,
      label: workspace.name,
      ownerId: workspace.ownerId,
    };
  }

  private async subjectChanges(subject: ApprovalSubject): Promise<ApprovalChange[]> {
    if (subject.subjectType === "document") {
      const edits = await this.repository.listDocumentEdits(subject.subjectId);
      if (edits.length > 0) {
        return edits
          .filter((edit) => edit.status !== "rejected")
          .map((edit) => ({
            id: edit.id,
            decision: edit.status === "accepted" ? "accepted" : "pending",
            sectionName: inferSectionName(edit),
            originalText: edit.deletedText,
            newText: edit.insertedText,
            aiSummary: [edit.contextBefore, edit.contextAfter].filter(Boolean).join(" "),
          }));
      }
      return [
        {
          id: subject.subjectId,
          decision: "pending",
          sectionName: subject.label,
          originalText: null,
          newText: subject.label,
          aiSummary: "Document-level approval",
        },
      ];
    }
    if (subject.subjectType === "drive_file") {
      const file = await this.driveFiles.findFile(subject.subjectId);
      if (!file) return [];
      return [
        {
          id: file.id,
          decision: "pending",
          sectionName: file.name,
          originalText: file.description,
          newText: file.name,
          aiSummary: `Workspace file ${file.name} (${file.mimeType}) version ${file.version}`,
        },
      ];
    }
    const workspace = await this.repository.findWorkspace(subject.subjectId);
    if (!workspace) return [];
    return [
      {
        id: workspace.id,
        decision: "pending",
        sectionName: workspace.name,
        originalText: workspace.description,
        newText: workspace.name,
        aiSummary: "Workspace-level signoff",
      },
    ];
  }

  async roleOptions() {
    return roleOptions(await this.repository.listRoles());
  }

  async listApprovers(actor: ApprovalActor, subjectType: ApprovalSubjectType, subjectId: string) {
    await this.requireSubject(actor, subjectType, subjectId);
    const [rows, roles] = await Promise.all([
      this.repository.listApprovers(subjectType, subjectId),
      this.roleMap(),
    ]);
    return rows.map((row) => ({
      id: row.id,
      subject_type: row.subjectType,
      subject_id: row.subjectId,
      role: row.role,
      role_label: getApproverRoleLabel(row.role, roles),
      approver_name: row.approverName,
      approver_email: row.approverEmail,
      is_required: row.isRequired,
      created_by_user_id: row.createdByUserId,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }));
  }

  async upsertApprovers(
    actor: ApprovalActor,
    subjectType: ApprovalSubjectType,
    subjectId: string,
    values: unknown,
  ) {
    await this.requireSubject(actor, subjectType, subjectId, true);
    if (!Array.isArray(values)) throw new ApprovalError(400, "approvers must be an array");
    const roles = await this.roleMap();
    const enabledRoles = new Map([...roles].filter(([, role]) => role.enabled));
    const inputs = values.map((value) => normalizeApprover(value, enabledRoles));
    for (const input of inputs) {
      await this.repository.upsertApprover({
        subjectType,
        subjectId,
        ...input,
        createdByUserId: actor.userId,
      });
    }
    await this.logActivity(actor.userId, subjectType, subjectId, "approval_approvers_updated", {
      approver_count: inputs.length,
    });
    return this.listApprovers(actor, subjectType, subjectId);
  }

  async analyze(actor: ApprovalActor, subjectType: ApprovalSubjectType, subjectId: string) {
    const subject = await this.requireSubject(actor, subjectType, subjectId);
    const [changes, policy, configuredApprovers] = await Promise.all([
      this.subjectChanges(subject),
      this.loadPolicy(subjectType),
      this.listApprovers(actor, subjectType, subjectId),
    ]);
    const requiredRoles = getRequiredApprovers(policy, changes);
    const configuredRoles = new Set(configuredApprovers.map((approver) => approver.role));
    const changesByApprover = getChangesByApprover(policy, changes);
    return {
      subject_type: subjectType,
      subject_id: subjectId,
      subject_label: subject.label,
      required: requiredRoles.length > 0,
      required_roles: requiredRoles,
      role_options: policy.roles.map((role) => ({ role: role.key, label: role.label })),
      missing_roles: requiredRoles.filter((role) => !configuredRoles.has(role)),
      configured_approvers: configuredApprovers,
      changes_by_approver: Object.fromEntries(
        policy.roles.map((role) => [role.key, changesByApprover[role.key].length]),
      ),
      changes: changes.map((change) => changeDto(change, policy)),
    };
  }

  async status(actor: ApprovalActor, subjectType: ApprovalSubjectType, subjectId: string) {
    await this.requireSubject(actor, subjectType, subjectId);
    const [approvers, requests, analysis, roles] = await Promise.all([
      this.listApprovers(actor, subjectType, subjectId),
      this.repository.listRequests(subjectType, subjectId),
      this.analyze(actor, subjectType, subjectId),
      this.roleMap(),
    ]);
    const items = await this.repository.listRequestItemIds(requests.map((request) => request.id));
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.requestId, (counts.get(item.requestId) ?? 0) + 1);
    return {
      subject_type: subjectType,
      subject_id: subjectId,
      required_roles: analysis.required_roles,
      missing_roles: analysis.missing_roles,
      approvers,
      requests: requests.map((request) => requestDto(request, roles, counts.get(request.id) ?? 0)),
      pending_count: requests.filter((request) => request.status === "pending").length,
      approved_count: requests.filter((request) => request.status === "approved").length,
      rejected_count: requests.filter((request) => request.status === "rejected").length,
    };
  }

  async request(
    actor: ApprovalActor,
    subjectType: ApprovalSubjectType,
    subjectId: string,
    body: Record<string, unknown>,
  ) {
    const subject = await this.requireSubject(actor, subjectType, subjectId, true);
    const policy = await this.loadPolicy(subjectType);
    const supplied = Array.isArray(body.approvers)
      ? body.approvers.map((value) => normalizeApprover(value, policy.roleByKey))
      : [];
    if (supplied.length > 0) {
      await this.upsertApprovers(actor, subjectType, subjectId, supplied);
    }
    const [changes, configured] = await Promise.all([
      this.subjectChanges(subject),
      this.repository.listApprovers(subjectType, subjectId),
    ]);
    const required = getRequiredApprovers(policy, changes);
    const enabledConfiguredRoles = configured
      .map((approver) => approver.role)
      .filter((role) => policy.roleByKey.has(role));
    const requested = supplied.length
      ? supplied.map((approver) => approver.role)
      : required.length
        ? required
        : enabledConfiguredRoles;
    const uniqueRoles = [...new Set(requested)];
    if (uniqueRoles.length === 0) {
      throw new ApprovalError(400, "Configure at least one approver before requesting approvals");
    }
    const byRole = new Map(configured.map((approver) => [approver.role, approver]));
    const missing = uniqueRoles.filter((role) => !byRole.has(role));
    if (missing.length > 0) {
      throw new ApprovalError(
        400,
        `Missing approvers for: ${missing
          .map((role) => getApproverRoleLabel(role, policy.roleByKey))
          .join(", ")}`,
      );
    }
    const ttlDays =
      typeof body.expires_in_days === "number" && Number.isFinite(body.expires_in_days)
        ? Math.max(1, Math.min(Math.floor(body.expires_in_days), 60))
        : 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);
    const changesByApprover = getChangesByApprover(policy, changes);
    const created: ApprovalRequestRow[] = [];
    for (const role of uniqueRoles) {
      const approver = byRole.get(role);
      if (!approver) continue;
      const rawToken = crypto.randomBytes(32).toString("base64url");
      const request = await this.repository.createRequest({
        subjectType,
        subjectId,
        approverId: approver.id,
        role,
        approverName: approver.approverName,
        approverEmail: approver.approverEmail,
        token: hashApprovalToken(rawToken),
        requestedByUserId: actor.userId,
        expiresAt,
      });
      await this.repository.markApproverRequired(approver.id);
      const roleChanges = changesByApprover[role].length ? changesByApprover[role] : changes;
      await this.repository.insertRequestItems(
        roleChanges.map((change) => ({
          requestId: request.id,
          subjectType,
          subjectId,
          role,
          itemType: subjectType === "document" ? "document_change" : subjectType,
          itemId: change.id && /^[0-9a-f-]{36}$/i.test(change.id) ? change.id : null,
          title: change.sectionName ?? subject.label,
          originalText: change.originalText ?? null,
          newText: change.newText ?? null,
          reason: getApprovalReason(policy, role, [change]),
          metadata: changeDto(change, policy, role),
        })),
      );
      await this.sendRequestEmail(
        subject,
        request,
        rawToken,
        getApproverRoleLabel(role, policy.roleByKey),
      );
      const approverUser = await this.repository.findUserByEmail(approver.approverEmail);
      if (approverUser && subjectType === "document") {
        await notifyApprovalRequested({
          approverUserId: approverUser.id,
          requesterUserId: actor.userId,
          documentId: subjectId,
          documentName: subject.label,
        }).catch((error) => {
          console.error("[approvals] failed to create approval notification:", error);
        });
      }
      created.push(request);
    }
    await this.logActivity(actor.userId, subjectType, subjectId, "approval_requested", {
      request_count: created.length,
      roles: uniqueRoles,
    });
    return {
      success: true,
      requests: created.map((request) => requestDto(request, policy.roleByKey)),
    };
  }

  async decide(input: {
    userId: string | null;
    requestIdOrToken: string;
    status: unknown;
    note: unknown;
    byToken?: boolean;
  }) {
    if (input.status !== "approved" && input.status !== "rejected") {
      throw new ApprovalError(400, "status must be approved or rejected");
    }
    const request = input.byToken
      ? await this.repository.findRequestByTokenHash(hashApprovalToken(input.requestIdOrToken))
      : await this.repository.findRequestById(input.requestIdOrToken);
    if (!request) throw new ApprovalError(404, "Approval request not found");
    if (!input.byToken) {
      const user = input.userId ? await this.repository.findVerifiedUserById(input.userId) : null;
      if (!user || !sameEmail(user.email, request.approverEmail)) {
        throw new ApprovalError(403, "Only the designated approver can decide this request");
      }
    }
    const roles = await this.roleMap();
    if (request.status !== "pending") {
      return input.byToken
        ? publicApprovalRequestDto(request, getApproverRoleLabel(request.role, roles))
        : requestDto(request, roles);
    }
    if (request.expiresAt.getTime() < Date.now()) {
      throw new ApprovalError(410, "Approval request has expired");
    }
    const decidedAt = new Date();
    const updated = await this.repository.decideRequest({
      requestId: request.id,
      status: input.status,
      decisionNote: typeof input.note === "string" ? input.note.trim().slice(0, 4000) : null,
      decidedAt,
    });
    if (!updated) {
      const current = await this.repository.findRequestById(request.id);
      if (!current) throw new ApprovalError(404, "Approval request not found");
      if (current.expiresAt.getTime() < Date.now()) {
        throw new ApprovalError(410, "Approval request has expired");
      }
      if (current.status !== "pending") {
        return input.byToken
          ? publicApprovalRequestDto(current, getApproverRoleLabel(current.role, roles))
          : requestDto(current, roles);
      }
      throw new ApprovalError(409, "Approval request decision conflicted");
    }
    await this.logActivity(
      input.userId,
      parseApprovalSubjectType(request.subjectType),
      request.subjectId,
      input.status === "approved" ? "approval_approved" : "approval_rejected",
      {
        request_id: request.id,
        role: request.role,
        approver_email: request.approverEmail,
      },
    );
    if (request.requestedByUserId && request.subjectType === "document" && input.userId) {
      const documentName =
        (await this.repository.findDocument(request.subjectId))?.filename ?? "Document";
      if (input.status === "approved") {
        await notifyDocumentApproved({
          ownerUserId: request.requestedByUserId,
          approverUserId: input.userId,
          documentId: request.subjectId,
          documentName,
        }).catch((error) => {
          console.error("[approvals] failed to create approval notification:", error);
        });
      } else {
        await notifyDocumentRejected({
          ownerUserId: request.requestedByUserId,
          rejectorUserId: input.userId,
          documentId: request.subjectId,
          documentName,
          reason: typeof input.note === "string" ? input.note.trim() : undefined,
        }).catch((error) => {
          console.error("[approvals] failed to create rejection notification:", error);
        });
      }
    }
    return input.byToken
      ? publicApprovalRequestDto(updated, getApproverRoleLabel(updated.role, roles))
      : requestDto(updated, roles);
  }

  async publicRequest(token: string) {
    const [request, roles] = await Promise.all([
      this.repository.findRequestByTokenHash(hashApprovalToken(token)),
      this.roleMap(),
    ]);
    if (!request) throw new ApprovalError(404, "Approval request not found");
    const items = await this.repository.listRequestItems(request.id);
    return {
      request: publicApprovalRequestDto(request, getApproverRoleLabel(request.role, roles)),
      items: items.map(publicApprovalItemDto),
    };
  }

  private async sendRequestEmail(
    subject: ApprovalSubject,
    request: ApprovalRequestRow,
    rawToken: string,
    roleLabel: string,
  ) {
    const approvalUrl = `${getAppConfig().auth.frontendUrl.replace(/\/$/, "")}/approval/${rawToken}`;
    const eventId =
      subject.subjectType === "document"
        ? await this.repository.createDocumentEmailEvent({
            documentId: subject.subjectId,
            recipient: request.approverEmail,
            requestId: request.id,
            role: request.role,
          })
        : null;
    await enqueueTemplateEmail({
      idempotencyKey: eventId ? `document-email:${eventId}` : `approval-request:${request.id}`,
      aggregateType: eventId ? "document_email" : "approval_request",
      aggregateId: eventId ?? request.id,
      email: {
        to: request.approverEmail,
        template: "approval-action-link",
        category: "collaboration",
        data: {
          subject: `Approval requested: ${subject.label}`,
          title: "Approval requested",
          body: `${request.approverName}, you have been asked to approve ${subject.label} as ${roleLabel}.`,
          actionUrl: approvalUrl,
          role: roleLabel,
          expiresAt: request.expiresAt,
        },
      },
      tracking: eventId
        ? {
            documentEmailEventId: eventId,
            documentId: subject.subjectId,
            triggerType: "approval_action_link",
            metadata: { approval_request_id: request.id, role: request.role },
          }
        : undefined,
    });
    if (eventId) {
      await recordDocumentActivity(
        subject.subjectId,
        null,
        "email_queued",
        { type: "email", id: eventId },
        {
          recipient: request.approverEmail,
          template: "approval-action-link",
          trigger_type: "approval_action_link",
        },
      );
    }
  }

  private async logActivity(
    userId: string | null,
    subjectType: ApprovalSubjectType,
    subjectId: string,
    action: string,
    details?: Record<string, unknown>,
  ) {
    if (subjectType === "document") {
      await recordDocumentActivity(subjectId, userId, action, { type: "approval" }, details);
      return;
    }
    if (subjectType === "drive_file" && userId) {
      const file = await this.driveFiles.findFile(subjectId);
      if (!file) return;
      await this.driveActivity.recordFile(file.id, userId, action, details);
      await this.driveActivity.recordWorkspace(
        file.workspaceId,
        userId,
        action,
        { type: "file", id: file.id, name: file.name },
        details,
      );
      return;
    }
    if (subjectType === "workspace" && userId) {
      await this.driveActivity.recordWorkspace(
        subjectId,
        userId,
        action,
        { type: "workspace", id: subjectId },
        details,
      );
    }
  }
}

const drive = createProductionDriveCore();
export const approvalsService = new ApprovalsService(
  new ApprovalsRepository(),
  drive.filePolicy,
  drive.files,
  drive.activity,
);
