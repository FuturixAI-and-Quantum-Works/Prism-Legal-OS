import {
  createAccessRequestAttentionItem,
  resolveAttentionItemsBySource,
} from "../../lib/attention.js";
import {
  notifyAccessRequested,
  notifyAccessRequestApproved,
  notifyAccessRequestRejected,
  notifyMemberRemoved,
  notifyMemberRoleChanged,
} from "../../lib/notifications.js";
import { buildPreviewSummary } from "../../lib/previewSummary.js";
import { queueDriveFileVersionIndex } from "../retrieval/retrieval.indexing.js";
import { sharingService } from "../sharing/sharing.service.js";
import { sharingMessage, sharingStatus } from "../sharing/sharing.types.js";
import { db } from "../../db/index.js";
import type { ObjectStore } from "../../storage/types.js";
import { accessAuthority } from "../access/access.composition.js";
import { DrizzleDriveAccessRequestRepository } from "./drive.access-request-repository.js";
import {
  DriveAccessRequestsService,
  type DriveAccessRequestEvents,
} from "./drive.access-requests.service.js";
import { DrizzleDriveActivityRepository } from "./drive.activity.js";
import type { DriveServices } from "./drive.controller.js";
import { DrizzleDriveFileRepository } from "./drive.file-repository.js";
import { DriveFilesService } from "./drive.files.service.js";
import { DrizzleDriveFolderRepository } from "./drive.folder-repository.js";
import { DriveFoldersService } from "./drive.folders.service.js";
import {
  DriveInvitationsService,
  type DriveInvitationGateway,
} from "./drive.invitations.service.js";
import { DriveAuthorizationPolicy } from "./drive.policy.js";
import { DrizzleDriveStorageOperationRepository } from "./drive.reconciliation.js";
import { createDriveRouter } from "./drive.routes.js";
import { DriveError } from "./drive.types.js";
import { DriveVersionsService } from "./drive.versions.service.js";
import { DrizzleDriveWorkspaceRepository } from "./drive.workspace-repository.js";
import {
  DriveWorkspacesService,
  type DriveMemberNotifications,
} from "./drive.workspaces.service.js";

const invitations: DriveInvitationGateway = {
  list: (workspaceId) =>
    sharingService.listPending({ resourceType: "workspace", resourceId: workspaceId }),
  create: (input) =>
    mapSharingError(() =>
      sharingService.create({
        resourceType: "workspace",
        resourceId: input.workspaceId,
        resourceName: input.workspaceName,
        email: input.email,
        role: input.role,
        invitedByUserId: input.invitedByUserId,
      }),
    ),
};

const accessRequestEvents: DriveAccessRequestEvents = {
  async requested(input) {
    await Promise.all(
      input.adminUserIds.map((userId) =>
        createAccessRequestAttentionItem({
          userId,
          accessRequestId: input.accessRequestId,
          workspaceId: input.workspaceId,
          workspaceName: input.workspaceName,
          requesterName: input.requesterName,
          requestedRole: input.requestedRole,
          message: input.message,
        }),
      ),
    );
    await notifyAccessRequested({
      adminUserIds: [...input.adminUserIds],
      requesterUserId: input.requesterUserId,
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName,
      requestedRole: input.requestedRole,
      message: input.message,
    });
  },
  resolve(accessRequestId) {
    return resolveAttentionItemsBySource("access_request", accessRequestId);
  },
  async approved(input) {
    await notifyAccessRequestApproved(input);
  },
  async rejected(input) {
    await notifyAccessRequestRejected(input);
  },
};

const notifications: DriveMemberNotifications = {
  async roleChanged(input) {
    await notifyMemberRoleChanged(input);
  },
  async removed(input) {
    await notifyMemberRemoved(input);
  },
};

function createProductionDriveServices(objectStore: ObjectStore): DriveServices {
  const workspaces = new DrizzleDriveWorkspaceRepository();
  const folders = new DrizzleDriveFolderRepository();
  const files = new DrizzleDriveFileRepository(db, folders);
  const accessRequestRepository = new DrizzleDriveAccessRequestRepository();
  const accessRequests = new DriveAccessRequestsService(
    accessRequestRepository,
    accessAuthority,
    accessRequestEvents,
  );
  const policy = new DriveAuthorizationPolicy({ workspaces, files, folders }, accessAuthority);
  const activity = new DrizzleDriveActivityRepository();
  const storageOperations = new DrizzleDriveStorageOperationRepository(db);
  return {
    files: new DriveFilesService(files, policy, activity, objectStore, storageOperations, {
      indexVersion: queueDriveFileVersionIndex,
      preview: (input) =>
        buildPreviewSummary({
          ...input,
          sourceType: "drive",
        }),
    }),
    folders: new DriveFoldersService(
      folders,
      files,
      policy,
      activity,
      objectStore,
      storageOperations,
    ),
    versions: new DriveVersionsService(files, policy, activity, objectStore, storageOperations, {
      indexVersion: queueDriveFileVersionIndex,
    }),
    invitations: new DriveInvitationsService(
      workspaces,
      accessRequestRepository,
      policy,
      activity,
      invitations,
      accessRequests,
    ),
    workspaces: new DriveWorkspacesService(
      workspaces,
      policy,
      accessAuthority,
      activity,
      objectStore,
      storageOperations,
      notifications,
    ),
  };
}

export function createProductionDriveRouter(objectStore: ObjectStore) {
  return createDriveRouter(createProductionDriveServices(objectStore));
}

async function mapSharingError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new DriveError(sharingStatus(error), sharingMessage(error), { cause: error });
  }
}
