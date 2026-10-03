import { documentAccessAllows, documentRequiredRole } from "../access/access.matrix.js";
import { accessAuthority } from "../access/access.composition.js";
import {
  DOCUMENT_ACCESS_ACTIONS,
  type AccessRole,
  type AccessSource,
  type DocumentAccessAction,
  type DocumentLifecycleStatus,
  type DocumentRole,
} from "../access/access.types.js";
import { DocumentGovernanceRepository } from "./documents.governance.repository.js";

export type {
  DocumentAccessAction as DocumentAction,
  DocumentLifecycleStatus,
  DocumentRole,
} from "../access/access.types.js";

const MISSING_ROLE_MESSAGE =
  "I can't verify your role on this document. Please contact the document owner or workspace admin.";
const FINALIZED_MESSAGE = "This document is finalized and permanently immutable.";
const PENDING_APPROVAL_MESSAGE = "This document is pending approval and locked for editing.";

export class DocumentPermissionError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly requiredRole?: string,
    readonly currentRole?: string | null,
  ) {
    super(message);
    this.name = "DocumentPermissionError";
  }
}

export function documentPermissionStatus(error: unknown): number {
  if (error instanceof DocumentPermissionError) return error.statusCode;
  return 500;
}

export function documentPermissionMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Permission check failed";
}

export type DocumentSessionContext = Readonly<{
  document_id: string;
  document_state: DocumentLifecycleStatus;
  document_role: DocumentRole | null;
  role_badge: DocumentRole | "OWNER_ADMIN" | "PROJECT_MEMBER" | null;
  product_role: AccessRole | null;
  access_source: AccessSource | null;
  is_owner: boolean;
  is_workspace_admin: boolean;
  is_owner_admin: boolean;
  allowed_actions: DocumentAccessAction[];
  visible_tabs: string[];
}>;

export type LoadedDocumentContext = DocumentSessionContext &
  Readonly<{
    user_id: string;
    user_email: string | null;
    user_name: string | null;
    document_owner_id: string;
    filename: string;
    project_id: string | null;
    has_project_access: boolean;
  }>;

function visibleTabsFor(
  role: DocumentRole | null,
  isOwnerAdmin: boolean,
  productRole: AccessRole | null,
) {
  const tabs = ["prism", "comments"];
  if (isOwnerAdmin || role === "REVIEWER" || role === "APPROVER" || (productRole && !role)) {
    tabs.unshift("insights");
  }
  if (isOwnerAdmin) tabs.push("audit");
  return [...new Set(tabs)];
}

function permissionDeniedMessage(requiredRole: string, currentRole?: string | null) {
  return `Access Restricted This action requires ${requiredRole} access. Your current role on this document is ${currentRole || "Unverified"}.`;
}

export class DocumentPermissionsService {
  constructor(private readonly repository = new DocumentGovernanceRepository()) {}

  ensureDrafter(documentId: string, userId: string, email?: string | null): Promise<void> {
    return this.repository.ensureDrafter(documentId, userId, email?.toLowerCase() ?? null);
  }

  async loadContext(
    documentId: string,
    userId: string,
    userEmail?: string | null,
  ): Promise<LoadedDocumentContext> {
    const document = await this.repository.findSessionDocument(documentId);
    if (!document) throw new DocumentPermissionError(404, "Document not found");
    const user = await this.repository.findSessionUser(userId);
    const email = (userEmail || user?.email || "").toLowerCase();
    const access = await accessAuthority.grants.findGrant(
      { userId, email },
      { kind: "document", id: documentId },
    );
    if (!access) throw new DocumentPermissionError(404, "Document not found");
    const isOwnerAdmin = access.role === "owner" || access.role === "admin";
    const allowedActions = DOCUMENT_ACCESS_ACTIONS.filter((action) =>
      documentAccessAllows(access, action),
    );
    return {
      document_id: documentId,
      document_state: document.lifecycleStatus,
      document_role: access.documentRole,
      role_badge: isOwnerAdmin
        ? "OWNER_ADMIN"
        : (access.source === "project" || access.source === "workspace") && !access.documentRole
          ? "PROJECT_MEMBER"
          : access.documentRole,
      product_role: access.role,
      access_source: access.source,
      is_owner: document.userId === userId,
      is_workspace_admin: access.source === "global-admin",
      is_owner_admin: isOwnerAdmin,
      allowed_actions: allowedActions,
      visible_tabs: visibleTabsFor(access.documentRole, isOwnerAdmin, access.role),
      user_id: userId,
      user_email: email || null,
      user_name: user?.fullName ?? null,
      document_owner_id: document.userId,
      filename: document.filename,
      project_id: document.projectId,
      has_project_access: access.source === "project",
    };
  }

  async assertAllowed(
    documentId: string,
    userId: string,
    userEmail: string | null | undefined,
    action: DocumentAccessAction,
  ): Promise<LoadedDocumentContext> {
    const context = await this.loadContext(documentId, userId, userEmail);
    const decision = await accessAuthority.decide({
      actor: { userId, email: userEmail?.toLowerCase() ?? context.user_email ?? "" },
      resource: { kind: "document", id: documentId },
      action,
    });
    if (decision.allowed) return context;
    if (decision.reason === "not-found") {
      throw new DocumentPermissionError(404, "Document not found");
    }
    if (context.document_state === "FINALIZED" || context.document_state === "PENDING_APPROVAL") {
      throw new DocumentPermissionError(
        403,
        context.document_state === "FINALIZED" ? FINALIZED_MESSAGE : PENDING_APPROVAL_MESSAGE,
        "editable document",
        context.document_role,
      );
    }
    if (!context.product_role && !context.document_role) {
      throw new DocumentPermissionError(403, MISSING_ROLE_MESSAGE);
    }
    const requiredRole = documentRequiredRole(action);
    throw new DocumentPermissionError(
      403,
      permissionDeniedMessage(requiredRole, context.document_role),
      requiredRole,
      context.document_role,
    );
  }
}

export const documentPermissionsService = new DocumentPermissionsService();
export const ensureDrafterMembership = documentPermissionsService.ensureDrafter.bind(
  documentPermissionsService,
);
export const loadDocumentSessionContext = documentPermissionsService.loadContext.bind(
  documentPermissionsService,
);
export const assertDocumentActionAllowed = documentPermissionsService.assertAllowed.bind(
  documentPermissionsService,
);
