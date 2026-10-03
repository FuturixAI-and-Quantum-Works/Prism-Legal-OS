import type {
  DriveFile,
  DriveFolder,
  DriveMember,
  DrivePage,
  DriveVersion,
  DriveVersionWithAuthor,
  DriveWorkspace,
  DriveWorkspaceSummary,
  WorkspaceMemberRole,
} from "./drive.types.js";
import type { AccessGrant } from "../access/access.types.js";
import type { DriveStorageOperationLease } from "./drive.reconciliation.js";

export type FileListInput = Readonly<{
  userId: string;
  workspaceId: string | null;
  folderId: string | null;
  search: string | null;
  sortBy: string | null;
  sortOrder: string | null;
  limit: number;
  offset: number;
}>;

export type FolderListInput = Omit<FileListInput, "folderId"> &
  Readonly<{ parentFolderId: string | null }>;

export type NewFileRecord = Readonly<{
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
  isPrimary: boolean;
}>;

export type NewVersionRecord = Readonly<{
  fileId: string;
  userId: string;
  storagePath: string;
  sizeBytes: bigint;
  checksum: string;
  mimeType: string;
  extension: string | null;
}>;

export type CopyFileRecord = NewFileRecord &
  Readonly<{ sourceFileId: string; sourceChecksum: string | null }>;

export type FileUpdate = Readonly<{
  name?: string;
  description?: string | null;
  folderId?: string | null;
}>;

export type FolderUpdate = Readonly<{
  name?: string;
  description?: string | null;
  parentFolderId?: string | null;
}>;

export type StorageObjectRecord = Readonly<{
  path: string;
  contentType: string;
}>;

export type MoveFileInput = Readonly<{
  fileId: string;
  name: string;
  targetWorkspaceId: string | null;
  targetFolderId: string | null;
  targetOwnerId: string;
}>;

export type MoveFolderInput = Readonly<{
  folderId: string;
  targetWorkspaceId: string | null;
  targetFolderId: string | null;
  targetOwnerId: string;
}>;

export interface DriveWorkspaceRepository {
  findWorkspace(workspaceId: string): Promise<DriveWorkspace | null>;
  listWorkspaces(
    grants: ReadonlyMap<string, AccessGrant>,
  ): Promise<readonly DriveWorkspaceSummary[]>;
  createWorkspace(input: {
    ownerId: string;
    name: string;
    description: string | null;
  }): Promise<DriveWorkspace>;
  updateWorkspace(
    workspaceId: string,
    updates: Readonly<{ name?: string; description?: string | null }>,
  ): Promise<DriveWorkspace>;
  deleteWorkspaceWithStorageOperation(workspaceId: string, idempotencyKey: string): Promise<string>;
  listWorkspaceMembers(workspaceId: string): Promise<readonly DriveMember[]>;
  findUser(userId: string): Promise<{ id: string; email: string; fullName: string } | null>;
  findUserByEmail(email: string): Promise<{ id: string } | null>;
  upsertWorkspaceMember(input: {
    workspaceId: string;
    userId: string;
    role: WorkspaceMemberRole;
  }): Promise<{ member: DriveMember; previousRole: string | null }>;
  removeWorkspaceMember(workspaceId: string, userId: string): Promise<void>;
}

export interface DriveFolderRepository {
  findFolder(folderId: string): Promise<DriveFolder | null>;
  listFolders(input: FolderListInput): Promise<DrivePage<DriveFolder>>;
  folderNameExists(input: {
    userId: string;
    workspaceId: string | null;
    parentFolderId: string | null;
    name: string;
    excludeFolderId?: string;
  }): Promise<boolean>;
  createFolder(input: {
    userId: string;
    workspaceId: string | null;
    parentFolderId: string | null;
    name: string;
    description: string | null;
  }): Promise<DriveFolder>;
  updateFolder(folderId: string, updates: FolderUpdate): Promise<DriveFolder>;
  collectFolderTree(folderId: string): Promise<readonly string[]>;
  listFilesInFolders(folderIds: readonly string[]): Promise<readonly DriveFile[]>;
  folderMoveIsAcyclic(folderId: string, targetParentId: string | null): Promise<boolean>;
}

export interface DriveFileRepository {
  findFile(fileId: string): Promise<DriveFile | null>;
  listFiles(input: FileListInput): Promise<DrivePage<DriveFile>>;
  fileNameExists(input: {
    userId: string;
    workspaceId: string | null;
    folderId: string | null;
    name: string;
    excludeFileId?: string;
  }): Promise<boolean>;
  createFileWithInitialVersion(
    input: NewFileRecord,
    operation: DriveStorageOperationLease,
  ): Promise<{
    file: DriveFile;
    version: DriveVersion;
  }>;
  createCopies(input: {
    userId: string;
    workspaceId: string | null;
    files: readonly CopyFileRecord[];
    operation: DriveStorageOperationLease;
  }): Promise<readonly { file: DriveFile; version: DriveVersion }[]>;
  updateFile(fileId: string, updates: FileUpdate): Promise<DriveFile>;
  touchFile(fileId: string): Promise<void>;
  listVersions(fileId: string): Promise<readonly DriveVersionWithAuthor[]>;
  createVersion(
    input: NewVersionRecord,
    operation: DriveStorageOperationLease,
  ): Promise<DriveVersion>;
  moveItems(input: {
    userId: string;
    files: readonly MoveFileInput[];
    folders: readonly MoveFolderInput[];
  }): Promise<{ files: readonly DriveFile[]; folders: readonly DriveFolder[] }>;
  deleteItemsWithStorageOperation(input: {
    userId: string;
    fileIds: readonly string[];
    folderIds: readonly string[];
    idempotencyKey: string;
  }): Promise<{
    filesDeleted: number;
    foldersDeleted: number;
    storageOperationId: string;
  }>;
}

export type DriveFileReader = Pick<DriveFileRepository, "findFile">;
