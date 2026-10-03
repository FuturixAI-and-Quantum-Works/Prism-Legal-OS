import type { AccessRole, ShareRole } from "../access/access.types.js";

export type DriveActor = Readonly<{ userId: string }>;

export type WorkspaceRole = AccessRole;
export type WorkspaceMemberRole = ShareRole;
export type DriveAccessLevel = "read" | "write" | "admin" | "owner";

export type DriveFile = Readonly<{
  id: string;
  userId: string;
  workspaceId: string | null;
  folderId: string | null;
  name: string;
  description: string | null;
  storagePath: string;
  sizeBytes: bigint;
  mimeType: string;
  extension: string | null;
  checksum: string | null;
  version: number;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
}>;

export type DriveFolder = Readonly<{
  id: string;
  userId: string;
  workspaceId: string | null;
  parentFolderId: string | null;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type DriveWorkspace = Readonly<{
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  storageAllocatedBytes: bigint;
  storageUsedBytes: bigint;
  createdAt: Date;
  updatedAt: Date;
}>;

export type WorkspaceAccess = Readonly<{
  workspace: DriveWorkspace;
  role: WorkspaceRole;
}>;

export type DriveVersion = Readonly<{
  id: string;
  fileId: string;
  versionNumber: number;
  storagePath: string;
  sizeBytes: bigint;
  checksum: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}>;

export type DriveVersionWithAuthor = DriveVersion &
  Readonly<{ userEmail: string | null; userName: string | null }>;

export type DriveMember = Readonly<{
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  email: string;
  fullName: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type DriveWorkspaceSummary = Readonly<{
  workspace: DriveWorkspace;
  role: WorkspaceRole;
  ownerName: string | null;
  fileCount: number;
  collaborators: readonly DriveMember[];
}>;

export type FileActivityRecord = Readonly<{
  id: string;
  fileId: string | null;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  action: string;
  details: unknown;
  createdAt: Date;
}>;

export type WorkspaceActivityRecord = Readonly<{
  id: string;
  workspaceId: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  details: unknown;
  createdAt: Date;
}>;

export type ActivityTarget = Readonly<{ type?: string; id?: string; name?: string }>;

export type DrivePage<T> = Readonly<{
  items: readonly T[];
  total: number;
  limit: number;
  offset: number;
}>;

export class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DriveError";
  }
}

export function toDriveError(error: unknown): DriveError {
  if (error instanceof DriveError) return error;
  return new DriveError(500, error instanceof Error ? error.message : "Unknown error", {
    cause: error,
  });
}
