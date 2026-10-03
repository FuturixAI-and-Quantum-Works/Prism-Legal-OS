import { accessAllows } from "../access/access.matrix.js";
import type { AccessAuthority } from "../access/access.authority.js";
import type { AccessGrant, AccessRole } from "../access/access.types.js";
import type { TabularActor, TabularDocument, TabularReview } from "./tabular.types.js";

export type ReviewAccessRole = AccessRole;

export type ReviewCapabilities = Readonly<{
  read: boolean;
  editReview: boolean;
  editCells: boolean;
  generateCells: boolean;
  regenerateCell: boolean;
  manageSharing: boolean;
  assignProject: boolean;
  deleteReview: boolean;
  useOwnChats: boolean;
}>;

const actor = { userId: "", email: "" };
type TabularAccessAction =
  | "read"
  | "edit-review"
  | "edit-cells"
  | "generate"
  | "regenerate"
  | "manage-sharing"
  | "assign-project"
  | "delete"
  | "use-chat";

function grant(role: AccessRole): AccessGrant {
  return {
    role,
    source: "member",
    documentRole: null,
    documentLifecycle: null,
  };
}

export function getReviewCapabilities(role: ReviewAccessRole): ReviewCapabilities {
  const allows = (action: TabularAccessAction) =>
    accessAllows(grant(role), {
      actor,
      resource: { kind: "tabular-review", id: "" },
      action,
    });
  return {
    read: allows("read"),
    editReview: allows("edit-review"),
    editCells: allows("edit-cells"),
    generateCells: allows("generate"),
    regenerateCell: allows("regenerate"),
    manageSharing: allows("manage-sharing"),
    assignProject: allows("assign-project"),
    deleteReview: allows("delete"),
    useOwnChats: allows("use-chat"),
  };
}

const capabilityAction = {
  read: "read",
  editReview: "edit-review",
  editCells: "edit-cells",
  generateCells: "generate",
  regenerateCell: "regenerate",
  manageSharing: "manage-sharing",
  assignProject: "assign-project",
  deleteReview: "delete",
  useOwnChats: "use-chat",
} as const;

export class TabularAuthorizationPolicy {
  constructor(private readonly authority: AccessAuthority) {}

  async listReviewIds(actor: TabularActor): Promise<readonly string[]> {
    return [...(await this.authority.grants.listTabularReviewGrants(actor)).keys()];
  }

  async roleFor(review: TabularReview, actor: TabularActor): Promise<ReviewAccessRole | null> {
    const access = await this.authority.grants.findGrant(actor, {
      kind: "tabular-review",
      id: review.id,
    });
    return access?.role ?? null;
  }

  async allows(
    review: TabularReview,
    actor: TabularActor,
    capability: keyof ReviewCapabilities,
  ): Promise<boolean> {
    return (
      await this.authority.decide({
        actor,
        resource: { kind: "tabular-review", id: review.id },
        action: capabilityAction[capability],
      })
    ).allowed;
  }

  async allowsReviewDocuments(
    review: TabularReview,
    documents: readonly TabularDocument[],
    actor: TabularActor,
  ): Promise<boolean> {
    const allowed = await this.authority.filterDocumentIds(
      actor,
      documents.map(({ id }) => id),
    );
    if (allowed.length !== documents.length) return false;
    const allowedSet = new Set(allowed);
    return documents.every(
      (document) =>
        allowedSet.has(document.id) &&
        (review.projectId === null || document.projectId === review.projectId),
    );
  }

  async allowsProjectAssignment(projectId: string, actor: TabularActor): Promise<boolean> {
    return (
      await this.authority.decide({
        actor,
        resource: { kind: "project", id: projectId },
        action: "manage",
      })
    ).allowed;
  }

  async projectRole(projectId: string, actor: TabularActor): Promise<AccessRole | null> {
    const access = await this.authority.grants.findGrant(actor, { kind: "project", id: projectId });
    return access?.role ?? null;
  }

  async allowsDocument(document: TabularDocument, actor: TabularActor): Promise<boolean> {
    return (
      await this.authority.decide({
        actor,
        resource: { kind: "document", id: document.id },
        action: "read_document",
      })
    ).allowed;
  }
}
