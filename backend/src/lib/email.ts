import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { ConsoleMailProvider } from "../mail/consoleMailProvider.js";
import { createMailProvider } from "../mail/createMailProvider.js";
import type { MailProvider, MailSendResult } from "../mail/types.js";

export type EmailCategory = "transactional" | "collaboration" | "security";

export type EmailAttachment = {
  filename: string;
  content: Buffer | Uint8Array | string;
  contentType?: string;
};

export type SendEmailResult =
  | {
      success: true;
      status: "sent";
      messageId?: string;
      attempts?: number;
      error?: never;
      suppressed?: never;
      failureKind?: never;
      retryMode?: never;
    }
  | {
      success: false;
      status: "suppressed";
      error: string;
      suppressed: true;
      attempts?: number;
      messageId?: never;
      failureKind?: never;
      retryMode?: never;
    }
  | {
      success: false;
      status: "failed";
      error: string;
      failureKind: "permanent" | "transient";
      retryMode: "never" | "provider-idempotent";
      attempts?: number;
      messageId?: never;
      suppressed?: never;
    };

export type SendOtpEmailResult = SendEmailResult;

export type EmailTemplateKey =
  | "otp"
  | "document-review-request"
  | "document-approval-request"
  | "document-owner-approval-request"
  | "document-approved"
  | "document-rejected"
  | "document-finalized"
  | "mention-notification"
  | "role-assignment"
  | "document-invitation"
  | "approval-action-link"
  | "project-invitation"
  | "workspace-invitation"
  | "workflow-invitation"
  | "clarification-request"
  | "email-test"
  | "generic";

export type TemplateEmailInput = {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  from?: string;
  attachments?: EmailAttachment[];
  template: EmailTemplateKey | string;
  data: {
    subject?: string;
    title?: string;
    body?: string;
    otp?: string;
    actionUrl?: string;
    recipientName?: string | null;
    senderName?: string | null;
    documentName?: string | null;
    summary?: string[] | null;
    projectName?: string | null;
    workspaceName?: string | null;
    workflowName?: string | null;
    role?: string | null;
    note?: string | null;
    expiresAt?: string | Date | null;
  };
  category?: EmailCategory;
  maxAttempts?: number;
  idempotencyKey?: string;
};

export type SendRawEmailInput = {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  from?: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
  idempotencyKey?: string;
};

type EmailRuntimeConfig = Readonly<{
  mail: AppConfig["mail"];
  trustedActionOrigins: AppConfig["auth"]["trustedOrigins"];
}>;

let emailConfig: EmailRuntimeConfig = {
  mail: { kind: "console" },
  trustedActionOrigins: [],
};
let mailProvider: MailProvider = new ConsoleMailProvider();

const EMAIL_DISPLAY_NAME = "Prism Legal";
const RESEND_TEST_DOMAIN = "resend.dev";

export function configureEmail(
  config: EmailRuntimeConfig,
  provider: MailProvider = createMailProvider(config.mail),
): void {
  emailConfig = config;
  mailProvider = provider;
}

function resolvedFromEmail(): string | undefined {
  return emailConfig.mail.kind === "console" ? undefined : emailConfig.mail.fromEmail;
}

function extractEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

function extractEmailDomain(value: string): string {
  const email = extractEmailAddress(value);
  return email.includes("@") ? (email.split("@").pop() ?? "") : "";
}

function isValidEmailAddress(value: string | undefined): value is string {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extractEmailAddress(value)));
}

function normalizeRecipients(value: string | string[]): string[] {
  return (Array.isArray(value) ? value : [value])
    .map((recipient) => recipient.trim())
    .filter(Boolean);
}

function normalizeOptionalRecipients(value: string[] | undefined): string[] | undefined {
  const recipients = value?.map((recipient) => recipient.trim()).filter(Boolean);
  return recipients?.length ? recipients : undefined;
}

function normalizeAttachments(attachments: EmailAttachment[] | undefined) {
  if (!attachments?.length) return undefined;
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    content:
      attachment.content instanceof Uint8Array
        ? Buffer.from(attachment.content)
        : attachment.content,
    contentType: attachment.contentType,
  }));
}

export async function getEmailConfigHealth() {
  const fromEmail = resolvedFromEmail() ?? null;
  const senderDomain = fromEmail ? extractEmailDomain(fromEmail) : null;
  const providerHealth = await mailProvider.health();
  return {
    provider: providerHealth.provider,
    status: providerHealth.status,
    apiKeyConfigured: emailConfig.mail.kind === "resend",
    senderConfigured: fromEmail !== null,
    emailDisplayName: EMAIL_DISPLAY_NAME,
    fromEmail,
    senderDomain,
    senders: {
      transactional: fromEmail,
      collaboration: fromEmail,
      security: fromEmail,
    },
    usesResendTestDomain: senderDomain === RESEND_TEST_DOMAIN,
    suppressed: providerHealth.status === "suppressed",
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function subjectForTemplate(input: TemplateEmailInput): string {
  if (input.data.subject) return input.data.subject;
  switch (input.template) {
    case "otp":
      return "Your Prism Legal verification code";
    case "document-review-request":
      return "Document review requested";
    case "document-approval-request":
      return "Document approval requested";
    case "document-owner-approval-request":
      return "Document awaiting owner approval";
    case "document-approved":
      return "Document approved";
    case "document-rejected":
      return "Document rejected";
    case "document-finalized":
      return "Document finalized";
    case "mention-notification":
      return "You were mentioned in Prism Legal";
    case "role-assignment":
      return "Document role assigned";
    case "document-invitation":
      return "You were invited to a Prism Legal document";
    case "approval-action-link":
      return "Approval action link";
    case "project-invitation":
      return "You were invited to a Prism Legal project";
    case "workspace-invitation":
      return "You were invited to a Prism Legal workspace";
    case "workflow-invitation":
      return "You were invited to a Prism Legal workflow";
    case "clarification-request":
      return "Clarification requested";
    default:
      return input.data.title || "Prism Legal notification";
  }
}

function getTemplateIcon(template: string): string {
  switch (template) {
    case "otp":
      return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="#10B981"/>
      </svg>`;
    case "workspace-invitation":
    case "project-invitation":
      return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" fill="#6366F1"/>
      </svg>`;
    case "document-invitation":
    case "document-review-request":
    case "document-approval-request":
      return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" fill="#3B82F6"/>
      </svg>`;
    case "document-approved":
    case "document-finalized":
      return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="#10B981"/>
      </svg>`;
    case "document-rejected":
      return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="#EF4444"/>
      </svg>`;
    case "workflow-invitation":
      return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" fill="#8B5CF6"/>
      </svg>`;
    default:
      return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" fill="#6366F1"/>
      </svg>`;
  }
}

function getGradientForTemplate(template: string): string {
  switch (template) {
    case "otp":
      return "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
    case "workspace-invitation":
    case "project-invitation":
      return "linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #A855F7 100%)";
    case "document-invitation":
    case "document-review-request":
    case "document-approval-request":
      return "linear-gradient(135deg, #3B82F6 0%, #2563EB 50%, #1D4ED8 100%)";
    case "document-approved":
    case "document-finalized":
      return "linear-gradient(135deg, #10B981 0%, #059669 50%, #047857 100%)";
    case "document-rejected":
      return "linear-gradient(135deg, #F43F5E 0%, #E11D48 50%, #BE123C 100%)";
    case "workflow-invitation":
      return "linear-gradient(135deg, #8B5CF6 0%, #7C3AED 50%, #6D28D9 100%)";
    default:
      return "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
  }
}

function validatedActionUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Email action URL must be a valid URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !emailConfig.trustedActionOrigins.includes(url.origin)
  ) {
    throw new Error("Email action URL must use a configured trusted HTTPS origin");
  }
  return url.toString();
}

function renderTemplate(
  input: TemplateEmailInput,
  actionUrl: string | undefined,
): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = subjectForTemplate(input);
  const title = input.data.title || subject;
  const body = input.data.body || input.data.note || "Open Prism Legal to view the details.";
  const gradient = getGradientForTemplate(input.template);
  const icon = getTemplateIcon(input.template);

  const actionHtml = actionUrl
    ? `<div style="text-align:center;margin:28px 0 8px;">
        <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:linear-gradient(135deg, #272727 0%, #404040 100%);color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:transform 0.2s;">
          Open in Prism Legal →
        </a>
      </div>`
    : "";

  const otpHtml =
    input.template === "otp" && input.data.otp
      ? `<div style="background:linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);border-radius:12px;padding:28px;text-align:center;margin:24px 0;border:1px solid #e2e8f0;">
        <p style="margin:0 0 12px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Verification Code</p>
        <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#1e293b;font-family:'SF Mono',Monaco,monospace;">${escapeHtml(input.data.otp)}</span>
        <p style="margin:16px 0 0;font-size:13px;color:#94a3b8;">Valid for 10 minutes</p>
      </div>`
      : "";

  const meta: Array<{ label: string; value: string; icon: string }> = [
    input.data.documentName
      ? { label: "Document", value: input.data.documentName, icon: "📄" }
      : null,
    input.data.projectName ? { label: "Project", value: input.data.projectName, icon: "📁" } : null,
    input.data.workspaceName
      ? { label: "Workspace", value: input.data.workspaceName, icon: "🏢" }
      : null,
    input.data.workflowName
      ? { label: "Workflow", value: input.data.workflowName, icon: "⚙️" }
      : null,
    input.data.role ? { label: "Your Role", value: input.data.role, icon: "👤" } : null,
    input.data.expiresAt
      ? { label: "Expires", value: new Date(input.data.expiresAt).toLocaleString(), icon: "⏰" }
      : null,
  ].filter((item) => item !== null);

  const metaHtml = meta.length
    ? `<div style="background:#f8fafc;border-radius:12px;padding:20px;margin:24px 0;border:1px solid #e2e8f0;">
        ${meta
          .map(
            (item) => `
          <div style="display:flex;align-items:center;padding:8px 0;${meta.indexOf(item) < meta.length - 1 ? "border-bottom:1px solid #e2e8f0;" : ""}">
            <span style="font-size:16px;margin-right:12px;">${item.icon}</span>
            <span style="color:#64748b;font-size:13px;min-width:80px;">${escapeHtml(item.label)}</span>
            <span style="color:#1e293b;font-size:14px;font-weight:500;">${escapeHtml(item.value)}</span>
          </div>
        `,
          )
          .join("")}
      </div>`
    : "";

  const senderHtml = input.data.senderName
    ? `<p style="color:#64748b;font-size:14px;margin:0 0 20px;">
        <span style="display:inline-block;width:28px;height:28px;background:linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%);border-radius:50%;text-align:center;line-height:28px;color:white;font-weight:600;font-size:12px;margin-right:8px;vertical-align:middle;">${escapeHtml(input.data.senderName.charAt(0).toUpperCase())}</span>
        <strong style="color:#334155;">${escapeHtml(input.data.senderName)}</strong> has invited you
      </p>`
    : "";

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
      <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
        <div style="background:${gradient};border-radius:16px 16px 0 0;padding:32px;text-align:center;">
          <div style="display:inline-block;background:rgba(255,255,255,0.2);border-radius:12px;padding:12px;">
            ${icon}
          </div>
          <h1 style="color:#ffffff;margin:16px 0 0;font-size:24px;font-weight:700;text-shadow:0 2px 4px rgba(0,0,0,0.1);">
            ${escapeHtml(title)}
          </h1>
        </div>

        <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          ${senderHtml}
          <p style="color:#475569;font-size:16px;line-height:1.7;margin:0 0 20px;">
            ${escapeHtml(body)}
          </p>
          ${otpHtml}
          ${metaHtml}
          ${actionHtml}

          <div style="margin-top:32px;padding-top:24px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0;">
              This email was sent by Prism Legal.<br>
              If you didn't expect this email, you can safely ignore it.
            </p>
          </div>
        </div>

        <div style="text-align:center;margin-top:24px;">
          <div style="display:inline-block;margin-bottom:8px;">
            <svg width="28" height="28" viewBox="0 0 31 31" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M29.3403 1.65967C26.618 -1.06263 21.1634 -0.321819 15.5 3.04692C9.83656 -0.321819 4.37994 -1.06263 1.65966 1.65967C-1.06264 4.38196 -0.321804 9.83658 3.04693 15.5C-0.321804 21.1634 -1.06264 26.62 1.65966 29.3403C4.38195 32.0626 9.83656 31.3218 15.5 27.9531C21.1634 31.3218 26.6201 32.0626 29.3403 29.3403C32.0626 26.618 31.3218 21.1634 27.9531 15.5C31.3218 9.83658 32.0626 4.37995 29.3403 1.65967ZM26.7505 4.24745C29.0633 6.5602 29.1777 10.5332 27.4572 14.697C26.1302 12.6111 24.4539 10.5152 22.4704 8.52965C20.4849 6.54414 18.3889 4.8698 16.303 3.54279C20.4668 1.82228 24.4378 1.93471 26.7525 4.24946L26.7505 4.24745ZM27.1039 15.5C26.0238 17.8087 24.3936 20.1476 22.2696 22.2716C20.1476 24.3936 17.8067 26.0258 15.498 27.1059C13.1892 26.0258 10.8504 24.3956 8.72637 22.2716C6.60434 20.1496 4.9722 17.8087 3.89212 15.5C4.9722 13.1913 6.60234 10.8524 8.72637 8.7284C10.8484 6.60637 13.1892 4.9742 15.498 3.89412C17.8067 4.9742 20.1456 6.60437 22.2696 8.7284C24.3916 10.8504 26.0238 13.1913 27.1039 15.5ZM4.24747 4.24745C6.56021 1.93471 10.5332 1.82027 14.6969 3.54078C12.6111 4.8678 10.5151 6.54414 8.52963 8.52764C6.54412 10.5131 4.86982 12.6091 3.5428 14.695C1.8223 10.5312 1.93473 6.5602 4.24948 4.24544L4.24747 4.24745ZM4.24747 26.7525C1.93472 24.4378 1.82029 20.4668 3.54079 16.303C4.86781 18.3889 6.54412 20.4849 8.52762 22.4704C10.5111 24.4559 12.609 26.1302 14.6949 27.4572C10.5312 29.1777 6.56021 29.0653 4.24546 26.7505L4.24747 26.7525ZM26.7505 26.7525C24.4358 29.0653 20.4647 29.1797 16.301 27.4592C18.3869 26.1322 20.4829 24.4559 22.4684 22.4724C24.4539 20.4868 26.1282 18.3909 27.4552 16.305C29.1757 20.4688 29.0633 24.4398 26.7485 26.7546L26.7505 26.7525Z" fill="#64748b"/>
            </svg>
          </div>
          <p style="color:#94a3b8;font-size:13px;font-weight:600;letter-spacing:0.5px;margin:0;">
            PRISM LEGAL
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = [
    title,
    body,
    ...meta.map((m) => `${m.label}: ${m.value}`),
    actionUrl ? `Open in Prism Legal: ${actionUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject, html, text };
}

function senderAddress(): string | undefined {
  const fromEmail = resolvedFromEmail();
  return fromEmail ? `${EMAIL_DISPLAY_NAME} <${fromEmail}>` : undefined;
}

function facadeResult(result: MailSendResult): SendEmailResult {
  switch (result.status) {
    case "sent":
      return { success: true, status: "sent", messageId: result.messageId };
    case "suppressed":
      return {
        success: false,
        status: "suppressed",
        suppressed: true,
        error: result.reason,
      };
    case "failed":
      return {
        success: false,
        status: "failed",
        error: result.failure.message,
        failureKind: result.failure.kind,
        retryMode: result.failure.retryMode,
      };
  }
}

export async function sendRawEmail(input: SendRawEmailInput): Promise<SendEmailResult> {
  const from = input.from?.trim() || senderAddress();
  if (emailConfig.mail.kind !== "console" && !isValidEmailAddress(from)) {
    return {
      success: false,
      status: "failed",
      error: "MAIL_FROM must be a valid email address",
      failureKind: "permanent",
      retryMode: "never",
    };
  }

  const result = await mailProvider.send({
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    message: {
      from: from ?? "Prism Legal <mail-suppressed@localhost>",
      to: normalizeRecipients(input.to),
      cc: normalizeOptionalRecipients(input.cc),
      bcc: normalizeOptionalRecipients(input.bcc),
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: normalizeAttachments(input.attachments),
    },
  });
  if (result.status === "suppressed") console.warn("[email] delivery_suppressed");
  if (result.status === "failed") console.error("[email] send_failed");
  return facadeResult(result);
}

export async function sendTemplateEmail(input: TemplateEmailInput): Promise<SendEmailResult> {
  if (emailConfig.mail.kind === "console") {
    return sendRawEmail({
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      from: input.from,
      subject: subjectForTemplate(input),
      attachments: input.attachments,
      idempotencyKey: input.idempotencyKey,
    });
  }

  let actionUrl: string | undefined;
  try {
    actionUrl = validatedActionUrl(input.data.actionUrl);
  } catch (error) {
    return {
      success: false,
      status: "failed",
      error: error instanceof Error ? error.message : "Invalid email action URL",
      failureKind: "permanent",
      retryMode: "never",
    };
  }
  const rendered = renderTemplate(input, actionUrl);
  return sendRawEmail({
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    from: input.from,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments: input.attachments,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function sendTemplateEmailWithRetry(
  input: TemplateEmailInput,
): Promise<SendEmailResult & { attempts: number }> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await sendTemplateEmail({ ...input, idempotencyKey });
    if (
      result.status !== "failed" ||
      result.failureKind === "permanent" ||
      result.retryMode === "never" ||
      attempt === maxAttempts
    ) {
      return { ...result, attempts: attempt };
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }
  }
  throw new Error("Mail retry loop exited unexpectedly");
}

export async function sendOtpEmail(email: string, otp: string): Promise<SendOtpEmailResult> {
  return sendTemplateEmailWithRetry({
    to: email,
    template: "otp",
    data: {
      otp,
      title: "Verify your email",
      body: "Your verification code is below. It expires in 10 minutes.",
    },
    category: "transactional",
  });
}
