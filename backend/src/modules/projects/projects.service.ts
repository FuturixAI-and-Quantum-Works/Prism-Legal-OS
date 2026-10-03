import { createHash, randomBytes } from "node:crypto";
import type { AccessAuthority } from "../access/access.authority.js";
import {
  projectChatDto,
  projectDto,
  projectFolderDto,
  projectInvitationDto,
  projectListItemDto,
  projectMemberDto,
  projectMemberUpdateDto,
} from "./projects.dto.js";
import { ProjectsAuthorizationPolicy } from "./projects.policy.js";
import type { ProjectsRepository } from "./projects.repository.js";
import {
  ProjectError,
  type ProjectActor,
  type ProjectFolderMutationInput,
  type ProjectMutationInput,
  type ProjectShareRole,
} from "./projects.types.js";

type InvitationSettings = Readonly<{
  frontendUrl: string;
  expiryDays: number;
  createToken?: () => string;
  now?: () => Date;
}>;

export class ProjectsService {
  private readonly createToken: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly repository: ProjectsRepository,
    private readonly policy: ProjectsAuthorizationPolicy,
    private readonly authority: AccessAuthority,
    private readonly invitationSettings: InvitationSettings,
  ) {
    this.createToken =
      invitationSettings.createToken ?? (() => randomBytes(32).toString("base64url"));
    this.now = invitationSettings.now ?? (() => new Date());
  }

  async list(actor: ProjectActor) {
    const grants = await this.authority.grants.listProjectGrants(actor);
    return (await this.repository.listProjects(actor, grants)).map(projectListItemDto);
  }

  async create(actor: ProjectActor, input: ProjectMutationInput) {
    if (!input.name) throw new ProjectError(400, "name is required");
    return projectDto(await this.repository.createProject(actor, input));
  }

  async get(actor: ProjectActor, projectId: string) {
    const access = await this.policy.require(projectId, actor, "read");
    return {
      ...projectDto(access.project),
      is_owner: access.role === "owner",
      role: access.role,
      folders: (await this.repository.listFolders(projectId)).map(projectFolderDto),
    };
  }

  async update(actor: ProjectActor, projectId: string, input: ProjectMutationInput) {
    const { project } = await this.policy.requireOwner(projectId, actor);
    const updated = await this.repository.updateProject(project, input);
    return {
      ...projectDto(updated),
      folders: (await this.repository.listFolders(projectId)).map(projectFolderDto),
    };
  }

  async remove(actor: ProjectActor, projectId: string): Promise<void> {
    await this.policy.requireOwner(projectId, actor);
    await this.repository.deleteOwnedProject(projectId, actor.userId);
  }

  async listPeople(actor: ProjectActor, projectId: string) {
    const { project } = await this.policy.require(projectId, actor, "read");
    return this.repository.listPeople(project);
  }

  async listMembers(actor: ProjectActor, projectId: string) {
    const { project } = await this.policy.require(projectId, actor, "manage");
    const [owner, members, pending] = await Promise.all([
      this.repository.getProjectOwner(project),
      this.repository.listMembers(projectId),
      this.repository.listPendingInvitations(projectId),
    ]);
    return {
      owner: {
        user_id: owner.id,
        email: owner.email,
        full_name: owner.fullName,
        role: "owner" as const,
      },
      members: members.map(projectMemberDto),
      pending_invitations: pending,
    };
  }

  async invite(actor: ProjectActor, projectId: string, email: string, role: ProjectShareRole) {
    const { project } = await this.policy.require(projectId, actor, "manage");
    const ownerEmail = await this.repository.getUserEmail(project.userId);
    if (ownerEmail?.toLowerCase() === email) {
      throw new ProjectError(400, "Project owner already has access");
    }
    const senderName = await this.repository.getInviterName(actor.userId);
    const token = this.createToken();
    const input = {
      email,
      role,
      invitedByUserId: actor.userId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      actionUrl: `${this.invitationSettings.frontendUrl}/share/accept/${token}`,
      expiresAt: new Date(this.now().getTime() + this.safeExpiryDays() * 24 * 60 * 60 * 1000),
      senderName,
    };
    return projectInvitationDto(await this.repository.createInvitation(project, input));
  }

  async updateMember(
    actor: ProjectActor,
    projectId: string,
    memberId: string,
    role: ProjectShareRole,
  ) {
    await this.policy.require(projectId, actor, "manage");
    const member = await this.repository.updateMember(projectId, memberId, role);
    if (!member) throw new ProjectError(404, "Project member not found");
    return projectMemberUpdateDto(member);
  }

  async removeMember(actor: ProjectActor, projectId: string, memberId: string): Promise<void> {
    await this.policy.require(projectId, actor, "manage");
    if (!(await this.repository.removeMember(projectId, memberId))) {
      throw new ProjectError(404, "Project member not found");
    }
  }

  async listChats(actor: ProjectActor, projectId: string) {
    await this.policy.require(projectId, actor, "read");
    return (await this.repository.listChats(projectId)).map(projectChatDto);
  }

  async createFolder(
    actor: ProjectActor,
    projectId: string,
    input: Required<Pick<ProjectFolderMutationInput, "name">> &
      Pick<ProjectFolderMutationInput, "parentFolderId">,
  ) {
    await this.policy.require(projectId, actor, "write");
    if (input.parentFolderId) {
      const folders = await this.repository.listFolders(projectId);
      if (!folders.some(({ id }) => id === input.parentFolderId)) {
        throw new ProjectError(404, "Parent folder not found");
      }
    }
    return projectFolderDto(await this.repository.createFolder(projectId, actor.userId, input));
  }

  async updateFolder(
    actor: ProjectActor,
    projectId: string,
    folderId: string,
    input: ProjectFolderMutationInput,
  ) {
    await this.policy.require(projectId, actor, "write");
    const folders = await this.repository.listFolders(projectId);
    if (input.parentFolderId) {
      const byId = new Map(folders.map((folder) => [folder.id, folder]));
      if (!byId.has(input.parentFolderId)) {
        throw new ProjectError(404, "Parent folder not found");
      }
      let currentId: string | null = input.parentFolderId;
      while (currentId) {
        if (currentId === folderId) {
          throw new ProjectError(400, "Cannot move a folder into itself or a descendant");
        }
        const current = byId.get(currentId);
        if (!current) throw new ProjectError(404, "Parent folder not found");
        currentId = current.parentFolderId;
      }
    }
    if (!folders.some(({ id }) => id === folderId)) {
      throw new ProjectError(404, "Folder not found");
    }
    const folder = await this.repository.updateFolder(projectId, folderId, input);
    if (!folder) throw new ProjectError(404, "Folder not found");
    return projectFolderDto(folder);
  }

  async deleteFolder(actor: ProjectActor, projectId: string, folderId: string): Promise<void> {
    await this.policy.require(projectId, actor, "write");
    if (!(await this.repository.deleteFolder(projectId, folderId))) {
      throw new ProjectError(404, "Folder not found");
    }
  }

  private safeExpiryDays(): number {
    const days = this.invitationSettings.expiryDays;
    return Number.isFinite(days) && days > 0 ? days : 7;
  }
}
