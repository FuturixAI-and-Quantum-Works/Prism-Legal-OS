export type MailAttachment = Readonly<{
  filename: string;
  content: Buffer | Uint8Array | string;
  contentType?: string;
}>;

export type MailMessage = Readonly<{
  from: string;
  to: readonly string[];
  cc?: readonly string[];
  bcc?: readonly string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: readonly MailAttachment[];
}>;

export type MailSendRequest = Readonly<{
  message: MailMessage;
  idempotencyKey: string;
}>;

export type MailFailure = Readonly<{
  kind: "permanent" | "transient";
  retryMode: "never" | "provider-idempotent";
  message: string;
  code?: string;
}>;

export type MailSendResult =
  | Readonly<{ status: "sent"; messageId?: string }>
  | Readonly<{ status: "suppressed"; reason: string }>
  | Readonly<{ status: "failed"; failure: MailFailure }>;

export type MailHealth =
  | Readonly<{ status: "configured"; provider: "resend" }>
  | Readonly<{ status: "suppressed"; provider: "console" }>;

export interface MailProvider {
  send(request: MailSendRequest): Promise<MailSendResult>;
  health(): Promise<MailHealth>;
}
