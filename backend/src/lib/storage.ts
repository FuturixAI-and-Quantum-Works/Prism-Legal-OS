import type { AppConfig } from "../config.js";
import { createObjectStore } from "../storage/createObjectStore.js";
import { DisabledObjectStore } from "../storage/disabledObjectStore.js";
import {
  ObjectNotFoundError,
  parseObjectRef,
  parseSignedReadTtl,
  type ObjectRef,
  type ObjectStore,
} from "../storage/types.js";

type StorageConfig = AppConfig["storage"];
let objectStore: ObjectStore = new DisabledObjectStore();

export let storageEnabled = false;

export function configureStorage(config: StorageConfig, signingSecret: string): ObjectStore {
  objectStore.close();
  objectStore = createObjectStore(config, { signingSecret });
  storageEnabled = config.kind !== "disabled";
  return objectStore;
}

export async function uploadFile(
  key: string,
  content: ArrayBuffer,
  contentType: string,
): Promise<void> {
  await objectStore.put({ ref: parseObjectRef(key), content, contentType });
}

export async function downloadFile(key: string): Promise<ArrayBuffer | null> {
  try {
    return await objectStore.get(parseObjectRef(key));
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) throw error;
    return null;
  }
}

export async function deleteFile(key: string): Promise<void> {
  await objectStore.delete(parseObjectRef(key));
}

export async function getSignedUrl(
  key: string,
  expiresIn = 3600,
  downloadFilename?: string,
  disposition: "attachment" | "inline" = "attachment",
): Promise<string> {
  return objectStore.signRead({
    ref: parseObjectRef(key),
    ttl: parseSignedReadTtl(expiresIn),
    downloadFilename,
    disposition,
  });
}

export function closeStorage(): void {
  objectStore.close();
  storageEnabled = false;
}

export function storageKey(userId: string, docId: string, filename: string): ObjectRef {
  return parseObjectRef(`documents/${userId}/${docId}/source${storageExtension(filename, ".bin")}`);
}

export function convertedPdfKey(userId: string, docId: string): ObjectRef {
  return parseObjectRef(`converted-pdfs/${userId}/${docId}.pdf`);
}

export function generatedDocKey(userId: string, docId: string, filename: string): ObjectRef {
  return parseObjectRef(
    `generated/${userId}/${docId}/generated${storageExtension(filename, ".docx")}`,
  );
}

export function versionStorageKey(
  userId: string,
  docId: string,
  versionSlug: string,
  filename: string,
): ObjectRef {
  return parseObjectRef(
    `documents/${userId}/${docId}/versions/${versionSlug}${storageExtension(filename, ".bin")}`,
  );
}

export function driveStorageKey(
  userId: string,
  fileId: string,
  filename: string,
  workspaceId?: string | null,
): ObjectRef {
  const scope = workspaceId ? `workspaces/${workspaceId}` : `drive/${userId}`;
  return parseObjectRef(`${scope}/files/${fileId}/source${storageExtension(filename, ".bin")}`);
}

export function driveVersionStorageKey(
  userId: string,
  fileId: string,
  versionSlug: string,
  filename: string,
  workspaceId?: string | null,
): ObjectRef {
  const scope = workspaceId ? `workspaces/${workspaceId}` : `drive/${userId}`;
  return parseObjectRef(
    `${scope}/files/${fileId}/versions/${versionSlug}${storageExtension(filename, ".bin")}`,
  );
}

function storageExtension(filename: string, fallback: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0) return fallback;
  const ext = filename.slice(lastDot).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : fallback;
}
