import { and, eq, or } from "drizzle-orm";
import {
  chatSessions,
  chats,
  complianceReviews,
  db,
  documentMembers,
  documentShares,
  documents,
  projectMembers,
  projects,
  shareInvitations,
  tabularReviews,
  tabularReviewShares,
  templates,
  userProfiles,
  workflows,
  workflowShares,
  workspaceMembers,
  workspaces,
  type Database,
} from "../../db/index.js";
import type {
  AccessActor,
  AccessGrant,
  AccessResource,
  AccessRole,
  AccessSource,
  DocumentLifecycleStatus,
  DocumentRole,
} from "./access.types.js";

export interface AccessGrantReader {
  isGlobalAdmin(userId: string): Promise<boolean>;
  findGrant(actor: AccessActor, resource: AccessResource): Promise<AccessGrant | null>;
  listProjectGrants(actor: AccessActor): Promise<ReadonlyMap<string, AccessGrant>>;
  listWorkspaceGrants(actor: AccessActor): Promise<ReadonlyMap<string, AccessGrant>>;
  listDocumentGrants(actor: AccessActor): Promise<ReadonlyMap<string, AccessGrant>>;
  listTabularReviewGrants(actor: AccessActor): Promise<ReadonlyMap<string, AccessGrant>>;
  listWorkflowGrants(actor: AccessActor): Promise<ReadonlyMap<string, AccessGrant>>;
  listTemplateGrants(actor: AccessActor): Promise<ReadonlyMap<string, AccessGrant>>;
}

const roleRank: Readonly<Record<AccessRole, number>> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

function grant(
  role: AccessRole,
  source: AccessSource,
  documentRole: DocumentRole | null = null,
  documentLifecycle: DocumentLifecycleStatus | null = null,
): AccessGrant {
  return { role, source, documentRole, documentLifecycle };
}

function strongest(candidates: readonly AccessGrant[]): AccessGrant | null {
  return candidates.reduce<AccessGrant | null>(
    (best, candidate) =>
      !best || roleRank[candidate.role] > roleRank[best.role] ? candidate : best,
    null,
  );
}

function memberRole(role: string): AccessRole {
  if (role === "admin" || role === "editor") return role;
  return "viewer";
}

function documentMemberRole(role: DocumentRole): AccessRole {
  return role === "DRAFTER" ? "editor" : "viewer";
}

export class DrizzleAccessRepository implements AccessGrantReader {
  constructor(private readonly database: Database = db) {}

  async findGrant(actor: AccessActor, resource: AccessResource): Promise<AccessGrant | null> {
    switch (resource.kind) {
      case "project":
        return this.findProjectGrant(actor, resource.id);
      case "workspace":
        return this.findWorkspaceGrant(actor, resource.id);
      case "document":
        return this.findDocumentGrant(actor, resource.id);
      case "tabular-review":
        return this.findTabularReviewGrant(actor, resource.id);
      case "compliance-review":
        return this.findComplianceReviewGrant(actor, resource.id);
      case "chat":
        return this.findChatGrant(actor, resource.id);
      case "workflow":
        return this.findWorkflowGrant(actor, resource.id);
      case "template":
        return this.findTemplateGrant(actor, resource.id);
      case "invitation":
        return this.findInvitationGrant(actor, resource.id);
    }
  }

  async listProjectGrants(actor: AccessActor): Promise<ReadonlyMap<string, AccessGrant>> {
    if (await this.isGlobalAdmin(actor.userId)) {
      const rows = await this.database.select({ id: projects.id }).from(projects);
      return new Map(rows.map(({ id }) => [id, grant("admin", "global-admin")]));
    }
    const [owned, memberships] = await Promise.all([
      this.database
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.userId, actor.userId)),
      this.database
        .select({ id: projectMembers.projectId, role: projectMembers.role })
        .from(projectMembers)
        .where(
          or(
            eq(projectMembers.userId, actor.userId),
            eq(projectMembers.email, actor.email.toLowerCase()),
          ),
        ),
    ]);
    return new Map([
      ...memberships.map(({ id, role }) => [id, grant(role, "member")] as const),
      ...owned.map(({ id }) => [id, grant("owner", "owner")] as const),
    ]);
  }

  async listWorkspaceGrants(actor: AccessActor): Promise<ReadonlyMap<string, AccessGrant>> {
    const [owned, memberships] = await Promise.all([
      this.database
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.ownerId, actor.userId)),
      this.database
        .select({ id: workspaceMembers.workspaceId, role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, actor.userId)),
    ]);
    return new Map([
      ...memberships.map(({ id, role }) => [id, grant(memberRole(role), "member")] as const),
      ...owned.map(({ id }) => [id, grant("owner", "owner")] as const),
    ]);
  }

  async listDocumentGrants(actor: AccessActor): Promise<ReadonlyMap<string, AccessGrant>> {
    const rows = await this.database.select({ id: documents.id }).from(documents);
    const entries = await Promise.all(
      rows.map(async ({ id }) => {
        const access = await this.findDocumentGrant(actor, id);
        return access ? ([id, access] as const) : null;
      }),
    );
    return new Map(entries.filter((entry) => entry !== null));
  }

  async listTabularReviewGrants(actor: AccessActor): Promise<ReadonlyMap<string, AccessGrant>> {
    const reviews = await this.database.select({ id: tabularReviews.id }).from(tabularReviews);
    const entries = await Promise.all(
      reviews.map(async ({ id }) => {
        const access = await this.findTabularReviewGrant(actor, id);
        return access ? ([id, access] as const) : null;
      }),
    );
    return new Map(entries.filter((entry) => entry !== null));
  }

  async listWorkflowGrants(actor: AccessActor): Promise<ReadonlyMap<string, AccessGrant>> {
    const rows = await this.database.select({ id: workflows.id }).from(workflows);
    const entries = await Promise.all(
      rows.map(async ({ id }) => {
        const access = await this.findWorkflowGrant(actor, id);
        return access ? ([id, access] as const) : null;
      }),
    );
    return new Map(entries.filter((entry) => entry !== null));
  }

  async listTemplateGrants(actor: AccessActor): Promise<ReadonlyMap<string, AccessGrant>> {
    const rows = await this.database.select({ id: templates.id }).from(templates);
    const entries = await Promise.all(
      rows.map(async ({ id }) => {
        const access = await this.findTemplateGrant(actor, id);
        return access ? ([id, access] as const) : null;
      }),
    );
    return new Map(entries.filter((entry) => entry !== null));
  }

  async isGlobalAdmin(userId: string): Promise<boolean> {
    const [profile] = await this.database
      .select({ role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    return profile?.role === "admin";
  }

  private async findProjectGrant(
    actor: AccessActor,
    projectId: string,
  ): Promise<AccessGrant | null> {
    const [project] = await this.database
      .select({ userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) return null;
    if (project.userId === actor.userId) return grant("owner", "owner");
    if (await this.isGlobalAdmin(actor.userId)) return grant("admin", "global-admin");
    const members = await this.database
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          or(
            eq(projectMembers.userId, actor.userId),
            eq(projectMembers.email, actor.email.toLowerCase()),
          ),
        ),
      );
    return strongest(members.map((member) => grant(member.role, "member")));
  }

  private async findWorkspaceGrant(
    actor: AccessActor,
    workspaceId: string,
  ): Promise<AccessGrant | null> {
    const [workspace] = await this.database
      .select({ ownerId: workspaces.ownerId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!workspace) return null;
    if (workspace.ownerId === actor.userId) return grant("owner", "owner");
    const [member] = await this.database
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, actor.userId),
        ),
      )
      .limit(1);
    return member ? grant(memberRole(member.role), "member") : null;
  }

  private async findDocumentGrant(
    actor: AccessActor,
    documentId: string,
  ): Promise<AccessGrant | null> {
    const [document] = await this.database
      .select({
        userId: documents.userId,
        projectId: documents.projectId,
        workspaceId: documents.workspaceId,
        lifecycle: documents.lifecycleStatus,
      })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    if (!document) return null;
    const lifecycle: DocumentLifecycleStatus = document.lifecycle;
    if (document.userId === actor.userId) return grant("owner", "owner", null, lifecycle);
    if (await this.isGlobalAdmin(actor.userId)) {
      return grant("admin", "global-admin", null, lifecycle);
    }
    const email = actor.email.toLowerCase();
    const [directShares, memberships] = await Promise.all([
      this.database
        .select({ role: documentShares.role })
        .from(documentShares)
        .where(
          and(
            eq(documentShares.documentId, documentId),
            or(eq(documentShares.userId, actor.userId), eq(documentShares.email, email)),
          ),
        ),
      this.database
        .select({ role: documentMembers.role })
        .from(documentMembers)
        .where(
          and(
            eq(documentMembers.documentId, documentId),
            or(eq(documentMembers.userId, actor.userId), eq(documentMembers.email, email)),
          ),
        ),
    ]);
    const membership = memberships.find(({ role }) => role === "DRAFTER") ?? memberships[0];
    const documentRole = membership?.role ?? null;
    const candidates: AccessGrant[] = [];
    for (const directShare of directShares) {
      candidates.push(grant(directShare.role, "direct-share", documentRole, lifecycle));
    }
    if (documentRole) {
      candidates.push(grant(documentMemberRole(documentRole), "member", documentRole, lifecycle));
    }
    if (document.projectId) {
      const project = await this.findProjectGrant(actor, document.projectId);
      if (project) {
        candidates.push(grant(project.role, "project", documentRole, lifecycle));
      }
    }
    if (document.workspaceId) {
      const workspace = await this.findWorkspaceGrant(actor, document.workspaceId);
      if (workspace) {
        candidates.push(grant(workspace.role, "workspace", documentRole, lifecycle));
      }
    }
    return strongest(candidates);
  }

  private async findTabularReviewGrant(
    actor: AccessActor,
    reviewId: string,
  ): Promise<AccessGrant | null> {
    const [review] = await this.database
      .select({ userId: tabularReviews.userId, projectId: tabularReviews.projectId })
      .from(tabularReviews)
      .where(eq(tabularReviews.id, reviewId))
      .limit(1);
    if (!review) return null;
    if (review.userId === actor.userId) return grant("owner", "owner");
    if (await this.isGlobalAdmin(actor.userId)) return grant("admin", "global-admin");
    const shares = await this.database
      .select({ role: tabularReviewShares.role })
      .from(tabularReviewShares)
      .where(
        and(
          eq(tabularReviewShares.reviewId, reviewId),
          or(
            eq(tabularReviewShares.userId, actor.userId),
            eq(tabularReviewShares.email, actor.email.toLowerCase()),
          ),
        ),
      );
    const candidates = shares.map((share) => grant(share.role, "direct-share"));
    if (review.projectId) {
      const project = await this.findProjectGrant(actor, review.projectId);
      if (project) candidates.push(grant(project.role, "project"));
    }
    return strongest(candidates);
  }

  private async findComplianceReviewGrant(
    actor: AccessActor,
    reviewId: string,
  ): Promise<AccessGrant | null> {
    const [review] = await this.database
      .select({
        userId: complianceReviews.userId,
        projectId: complianceReviews.projectId,
        workspaceId: complianceReviews.workspaceId,
        primaryDocumentId: complianceReviews.primaryDocumentId,
      })
      .from(complianceReviews)
      .where(eq(complianceReviews.id, reviewId))
      .limit(1);
    if (!review || review.userId !== actor.userId) return null;
    if (review.workspaceId) {
      return this.findWorkspaceGrant(actor, review.workspaceId);
    }
    if (review.projectId) {
      return this.findProjectGrant(actor, review.projectId);
    }
    if (!review.primaryDocumentId) return null;
    return this.findDocumentGrant(actor, review.primaryDocumentId);
  }

  private async findChatGrant(actor: AccessActor, chatId: string): Promise<AccessGrant | null> {
    const [chat] = await this.database
      .select({
        userId: chats.userId,
        projectId: chats.projectId,
        workspaceId: chats.workspaceId,
      })
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1);
    if (!chat) return null;
    if (chat.userId === actor.userId) return grant("owner", "owner");
    if (chat.projectId) {
      const project = await this.findProjectGrant(actor, chat.projectId);
      if (project) return grant(project.role, "project");
    }
    if (chat.workspaceId) {
      const workspace = await this.findWorkspaceGrant(actor, chat.workspaceId);
      if (workspace) return grant(workspace.role, "workspace");
    }
    const [session] = await this.database
      .select({
        userId: chatSessions.userId,
        projectId: chatSessions.projectId,
        workspaceId: chatSessions.workspaceId,
      })
      .from(chatSessions)
      .where(eq(chatSessions.id, chatId))
      .limit(1);
    if (!session) return null;
    if (session.userId === actor.userId) return grant("owner", "owner");
    if (session.projectId) {
      const project = await this.findProjectGrant(actor, session.projectId);
      if (project) return grant(project.role, "project");
    }
    if (session.workspaceId) {
      const workspace = await this.findWorkspaceGrant(actor, session.workspaceId);
      if (workspace) return grant(workspace.role, "workspace");
    }
    return null;
  }

  private async findWorkflowGrant(
    actor: AccessActor,
    workflowId: string,
  ): Promise<AccessGrant | null> {
    const [workflow] = await this.database
      .select({ id: workflows.id, userId: workflows.userId, isSystem: workflows.isSystem })
      .from(workflows)
      .where(or(eq(workflows.id, workflowId), eq(workflows.stableKey, workflowId)))
      .limit(1);
    if (!workflow) return null;
    if (workflow.isSystem) return grant("viewer", "system");
    if (workflow.userId === actor.userId) return grant("owner", "owner");
    const [share] = await this.database
      .select({ allowEdit: workflowShares.allowEdit })
      .from(workflowShares)
      .where(
        and(
          eq(workflowShares.workflowId, workflow.id),
          eq(workflowShares.sharedWithEmail, actor.email.toLowerCase()),
        ),
      )
      .limit(1);
    return share ? grant(share.allowEdit ? "editor" : "viewer", "direct-share") : null;
  }

  private async findTemplateGrant(
    actor: AccessActor,
    templateId: string,
  ): Promise<AccessGrant | null> {
    const [template] = await this.database
      .select({ userId: templates.userId, isCreatedByUser: templates.isCreatedByUser })
      .from(templates)
      .where(eq(templates.id, templateId))
      .limit(1);
    if (!template) return null;
    if (!template.isCreatedByUser) return grant("viewer", "system");
    if (template.userId === actor.userId) return grant("owner", "owner");
    return null;
  }

  private async findInvitationGrant(
    actor: AccessActor,
    invitationId: string,
  ): Promise<AccessGrant | null> {
    const [invitation] = await this.database
      .select({ email: shareInvitations.email, role: shareInvitations.role })
      .from(shareInvitations)
      .where(eq(shareInvitations.id, invitationId))
      .limit(1);
    if (!invitation || invitation.email.toLowerCase() !== actor.email.toLowerCase()) return null;
    return grant(invitation.role, "invitation");
  }
}
