import type {
  chats,
  projectMembers,
  projects,
  projectSubfolders,
  shareInvitations,
} from "../../db/index.js";
import type { AccessRole, ShareRole } from "../access/access.types.js";

export type ProjectActor = Readonly<{
  userId: string;
  email: string;
}>;

export type ProjectRole = AccessRole;
export type ProjectShareRole = ShareRole;
export type ProjectPermission = "read" | "write" | "manage";

export type Project = typeof projects.$inferSelect;
export type ProjectFolder = typeof projectSubfolders.$inferSelect;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type ProjectChat = typeof chats.$inferSelect;
export type ProjectInvitation = typeof shareInvitations.$inferSelect;

export type ProjectMutationInput = Readonly<{
  name?: string;
  cmNumber?: string | null;
}>;

export type ProjectFolderMutationInput = Readonly<{
  name?: string;
  parentFolderId?: string | null;
}>;

export type ProjectAccess = Readonly<{
  project: Project;
  role: ProjectRole;
}>;

export type ProjectCollaborator = Readonly<{
  id: string;
  userId: string | null;
  email: string;
  role: ProjectShareRole;
}>;

export type ProjectListItem = Project &
  Readonly<{
    is_owner: boolean;
    role: ProjectRole;
    document_count: number;
    chat_count: number;
    review_count: number;
    collaborators: readonly ProjectCollaborator[];
  }>;

export type ProjectMemberDto = Readonly<{
  id: string;
  project_id: string;
  user_id: string | null;
  email: string;
  role: ProjectShareRole;
  created_at: Date;
  updated_at: Date;
}>;

export type PendingProjectInvitationDto = Readonly<{
  id: string;
  email: string;
  role: ProjectShareRole;
  status: string;
  expires_at: Date;
  created_at: Date;
}>;

export type ProjectPeopleDto = Readonly<{
  owner: Readonly<{
    user_id: string;
    email: string | null;
    display_name: string | null;
  }>;
  members: readonly Readonly<{
    email: string;
    display_name: string | null;
  }>[];
}>;

export type InvitationDelivery = Readonly<{
  email: string;
  status: "queued";
  attempts: 0;
}>;

export type ProjectInvitationResult = Readonly<{
  invitation: ProjectInvitation;
  delivery: InvitationDelivery;
}>;

export type CreateProjectInvitationInput = Readonly<{
  email: string;
  role: ProjectShareRole;
  invitedByUserId: string;
  tokenHash: string;
  actionUrl: string;
  expiresAt: Date;
  senderName: string | null;
}>;

export class ProjectError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProjectError";
  }
}
