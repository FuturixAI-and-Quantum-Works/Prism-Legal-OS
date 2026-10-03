import type { AccessAuthority } from "../access/access.authority.js";
import type { AccessGrant, AccessRequest } from "../access/access.types.js";
import type { WorkflowsRepository } from "./workflows.repository.js";
import type {
  CreateWorkflowInput,
  UpdateWorkflowInput,
  Workflow,
  WorkflowActor,
  WorkflowType,
} from "./workflows.types.js";
import { WorkflowError } from "./workflows.types.js";

type WorkflowAccessRequest = Extract<AccessRequest, Readonly<{ resource: { kind: "workflow" } }>>;
type WorkflowAction = WorkflowAccessRequest["action"];

function workflowDto(
  workflow: Workflow,
  access: { allowEdit: boolean; isOwner: boolean; sharedByName?: string | null },
) {
  return {
    ...workflow,
    id: workflow.isSystem && workflow.stableKey ? workflow.stableKey : workflow.id,
    allow_edit: access.allowEdit,
    is_owner: access.isOwner,
    shared_by_name: access.sharedByName ?? null,
  };
}

export class WorkflowsService {
  constructor(
    private readonly repository: WorkflowsRepository,
    private readonly authority: AccessAuthority,
  ) {}

  async list(actor: WorkflowActor, type?: WorkflowType) {
    const grants = await this.authority.grants.listWorkflowGrants(actor);
    const workflows = await this.repository.listAccessible([...grants.keys()], actor.email, type);
    return workflows.map(({ workflow, sharedByName }) => {
      const grant = grants.get(workflow.id);
      return workflowDto(workflow, {
        ...this.accessFlags(actor, workflow.id, grant),
        sharedByName,
      });
    });
  }

  create(actor: WorkflowActor, input: CreateWorkflowInput): Promise<Workflow> {
    return this.repository.create(actor.userId, input);
  }

  async get(actor: WorkflowActor, identifier: string) {
    const { workflow, grant } = await this.authorize(
      actor,
      identifier,
      "read",
      "Workflow not found",
    );
    return workflowDto(workflow, this.accessFlags(actor, workflow.id, grant));
  }

  async update(actor: WorkflowActor, identifier: string, input: UpdateWorkflowInput) {
    const { workflow, grant } = await this.authorize(
      actor,
      identifier,
      "edit",
      "Workflow not found or not editable",
    );
    const updated = await this.repository.update(workflow.id, input);
    if (!updated) throw new WorkflowError(404, "Workflow not found or not editable");
    return workflowDto(updated, this.accessFlags(actor, updated.id, grant));
  }

  async remove(actor: WorkflowActor, identifier: string): Promise<void> {
    const { workflow } = await this.authorize(
      actor,
      identifier,
      "delete",
      "Workflow not found or not editable",
    );
    await this.repository.delete(workflow.id);
  }

  async listHidden(actor: WorkflowActor): Promise<readonly string[]> {
    return (await this.repository.listHidden(actor.userId)).map((workflow) =>
      workflow.isSystem && workflow.stableKey ? workflow.stableKey : workflow.id,
    );
  }

  async hide(actor: WorkflowActor, identifier: string): Promise<void> {
    const { workflow } = await this.authorize(actor, identifier, "read", "Workflow not found");
    await this.repository.hide(actor.userId, workflow.id);
  }

  async unhide(actor: WorkflowActor, identifier: string): Promise<void> {
    const workflow = await this.repository.findByIdentifier(identifier);
    if (workflow) await this.repository.unhide(actor.userId, workflow.id);
  }

  async listShares(actor: WorkflowActor, identifier: string) {
    const { workflow } = await this.authorize(
      actor,
      identifier,
      "manage-sharing",
      "Workflow not found or not editable",
    );
    return (await this.repository.listShares(workflow.id)).map((share) => ({
      id: share.id,
      shared_with_email: share.sharedWithEmail,
      allow_edit: share.allowEdit,
      created_at: share.createdAt,
    }));
  }

  async share(
    actor: WorkflowActor,
    identifier: string,
    emails: readonly string[],
    allowEdit: boolean,
  ): Promise<void> {
    const { workflow } = await this.authorize(
      actor,
      identifier,
      "manage-sharing",
      "Workflow not found or not editable",
    );
    const normalized = emails.map((email) => email.trim().toLowerCase());
    await this.repository.upsertShares(workflow.id, actor, normalized, allowEdit);
  }

  async removeShare(actor: WorkflowActor, identifier: string, shareId: string): Promise<void> {
    const { workflow } = await this.authorize(
      actor,
      identifier,
      "manage-sharing",
      "Workflow not found",
    );
    await this.repository.deleteShare(workflow.id, shareId);
  }

  private accessFlags(actor: WorkflowActor, workflowId: string, grant?: AccessGrant) {
    if (!grant) return { allowEdit: false, isOwner: false };
    const request = (action: WorkflowAction): WorkflowAccessRequest => ({
      actor,
      resource: { kind: "workflow", id: workflowId },
      action,
    });
    return {
      allowEdit: this.authority.decideKnownGrant(request("edit"), grant).allowed,
      isOwner: this.authority.decideKnownGrant(request("manage-sharing"), grant).allowed,
    };
  }

  private async authorize(
    actor: WorkflowActor,
    identifier: string,
    action: WorkflowAction,
    detail: string,
  ): Promise<Readonly<{ workflow: Workflow; grant: AccessGrant }>> {
    const workflow = await this.repository.findByIdentifier(identifier);
    if (!workflow) throw new WorkflowError(404, detail);
    const decision = await this.authority.decide({
      actor,
      resource: { kind: "workflow", id: workflow.id },
      action,
    });
    if (!decision.allowed) throw new WorkflowError(404, detail);
    return { workflow, grant: decision.grant };
  }
}
