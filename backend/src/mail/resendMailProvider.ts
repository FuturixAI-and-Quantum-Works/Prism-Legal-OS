import { Resend } from "resend";
import { MailProviderTimeoutError, withProviderTimeout } from "./providerTimeout.js";
import type { MailHealth, MailProvider, MailSendRequest, MailSendResult } from "./types.js";

type ResendResponse =
  | { data: { id: string }; error: null }
  | {
      data: null;
      error: { message: string; name: string; statusCode: number | null };
    };

export type ResendTransport = Readonly<{
  send: (request: MailSendRequest) => Promise<ResendResponse>;
}>;

function classifyStatus(statusCode: number | null): {
  kind: "permanent" | "transient";
  retryMode: "never" | "provider-idempotent";
} {
  if (statusCode === 408 || statusCode === 429 || (statusCode ?? 0) >= 500) {
    return { kind: "transient", retryMode: "provider-idempotent" };
  }
  return { kind: "permanent", retryMode: "never" };
}

export function createResendTransport(apiKey: string): ResendTransport {
  const client = new Resend(apiKey);
  return {
    async send(request) {
      const message = request.message;
      const content =
        message.html !== undefined ? { html: message.html } : { text: message.text ?? "" };
      return client.emails.send(
        {
          from: message.from,
          to: [...message.to],
          cc: message.cc ? [...message.cc] : undefined,
          bcc: message.bcc ? [...message.bcc] : undefined,
          subject: message.subject,
          attachments: message.attachments?.map((attachment) => ({
            filename: attachment.filename,
            content:
              attachment.content instanceof Uint8Array
                ? Buffer.from(attachment.content)
                : attachment.content,
            contentType: attachment.contentType,
          })),
          ...content,
        },
        { idempotencyKey: request.idempotencyKey },
      );
    },
  };
}

export class ResendMailProvider implements MailProvider {
  constructor(
    private readonly transport: ResendTransport,
    private readonly timeoutMs: number,
  ) {}

  async send(request: MailSendRequest): Promise<MailSendResult> {
    try {
      const response = await withProviderTimeout(this.transport.send(request), this.timeoutMs);
      if (response.error) {
        const classification = classifyStatus(response.error.statusCode);
        return {
          status: "failed",
          failure: {
            ...classification,
            code: response.error.name,
            message: response.error.message,
          },
        };
      }
      return { status: "sent", messageId: response.data.id };
    } catch (error) {
      const timedOut = error instanceof MailProviderTimeoutError;
      return {
        status: "failed",
        failure: {
          kind: "transient",
          retryMode: "provider-idempotent",
          code: timedOut ? "timeout" : undefined,
          message: timedOut
            ? `Mail provider did not respond within ${this.timeoutMs}ms`
            : error instanceof Error
              ? error.message
              : "Unknown Resend error",
        },
      };
    }
  }

  async health(): Promise<MailHealth> {
    return { status: "configured", provider: "resend" };
  }
}
