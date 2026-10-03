import type { MailSendResult } from "../../mail/types.js";
import type { ShareRole } from "../access/access.types.js";

export type { ShareRole } from "../access/access.types.js";

export type ShareResourceType = "document" | "project" | "workspace";

export type InviteDelivery = Readonly<{
  email: string;
  status: MailSendResult["status"] | "queued" | "skipped";
  message_id?: string;
  error?: string;
  attempts?: number;
}>;

export type ShareInvitationInput = Readonly<{
  resourceType: ShareResourceType;
  resourceId: string;
  resourceName: string;
  email: string;
  role: ShareRole;
  invitedByUserId: string;
}>;

export class SharingError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "SharingError";
  }
}

export function sharingStatus(error: unknown): number {
  return error instanceof SharingError ? error.statusCode : 500;
}

export function sharingMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Sharing failed";
}

export function normalizeShareRole(value: unknown): ShareRole {
  if (value === "admin" || value === "editor" || value === "viewer") return value;
  throw new SharingError(400, "role must be admin, editor, or viewer");
}

export function normalizeInviteEmail(value: unknown): string {
  if (typeof value !== "string") throw new SharingError(400, "email is required");
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new SharingError(400, "Enter a valid email address");
  }
  return email;
}
