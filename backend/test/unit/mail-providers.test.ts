import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureEmail,
  emailEventFields,
  sendRawEmail,
  sendTemplateEmail,
  sendTemplateEmailWithRetry,
} from "../../src/lib/email.js";
import { ConsoleMailProvider } from "../../src/mail/consoleMailProvider.js";
import {
  ResendMailProvider,
  createResendTransport,
  type ResendTransport,
} from "../../src/mail/resendMailProvider.js";
import type { MailProvider, MailSendRequest } from "../../src/mail/types.js";

const resendSend = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

const request: MailSendRequest = {
  idempotencyKey: "mail-123",
  message: {
    from: "Prism Legal <sender@example.com>",
    to: ["recipient@example.com"],
    subject: "Contract test",
    text: "Test",
  },
};

afterEach(() => {
  configureEmail({
    mail: { kind: "console" },
    trustedActionOrigins: [],
  });
  vi.restoreAllMocks();
});

describe("ConsoleMailProvider", () => {
  it("reports suppression without claiming delivery", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const provider = new ConsoleMailProvider();

    await expect(provider.send(request)).resolves.toEqual({
      status: "suppressed",
      reason: "Mail delivery is suppressed",
    });
    await expect(provider.health()).resolves.toEqual({
      status: "suppressed",
      provider: "console",
    });
  });
});

describe("ResendMailProvider", () => {
  it("passes the idempotency key through its transport", async () => {
    const send = vi.fn<ResendTransport["send"]>().mockResolvedValue({
      data: { id: "resend-1" },
      error: null,
    });
    const provider = new ResendMailProvider({ send }, 100);

    await expect(provider.send(request)).resolves.toEqual({
      status: "sent",
      messageId: "resend-1",
    });
    expect(send).toHaveBeenCalledWith(request);
    await expect(provider.health()).resolves.toEqual({
      status: "configured",
      provider: "resend",
    });
  });

  it.each([
    [429, "transient", true],
    [503, "transient", true],
    [409, "permanent", false],
    [422, "permanent", false],
  ] as const)("classifies an HTTP %i failure", async (statusCode, kind, retryable) => {
    const provider = new ResendMailProvider(
      {
        send: async () => ({
          data: null,
          error: { message: "provider error", name: "provider_error", statusCode },
        }),
      },
      100,
    );

    await expect(provider.send(request)).resolves.toMatchObject({
      status: "failed",
      failure: {
        kind,
        retryMode: retryable ? "provider-idempotent" : "never",
      },
    });
  });

  it("uses provider idempotency when retrying an ambiguous timeout", async () => {
    const provider = new ResendMailProvider({ send: () => new Promise(() => undefined) }, 1);

    await expect(provider.send(request)).resolves.toMatchObject({
      status: "failed",
      failure: {
        kind: "transient",
        retryMode: "provider-idempotent",
        code: "timeout",
      },
    });
  });
});

describe("email attachments", () => {
  it("delivers byte attachments to Resend as Buffers and passes strings through", async () => {
    resendSend.mockResolvedValue({ data: { id: "resend-attachments" }, error: null });
    configureEmail(
      {
        mail: { kind: "resend", apiKey: "test", fromEmail: "sender@example.com" },
        trustedActionOrigins: [],
      },
      new ResendMailProvider(createResendTransport("test"), 100),
    );

    await expect(
      sendRawEmail({
        to: "recipient@example.com",
        subject: "Attachments",
        text: "See attached",
        idempotencyKey: "attachments-1",
        attachments: [
          {
            filename: "bytes.bin",
            content: new Uint8Array([1, 2, 3]),
            contentType: "application/octet-stream",
          },
          { filename: "note.txt", content: "plain" },
        ],
      }),
    ).resolves.toMatchObject({ status: "sent", messageId: "resend-attachments" });

    const [payload, options] = resendSend.mock.lastCall ?? [];
    expect(options).toEqual({ idempotencyKey: "attachments-1" });
    const [bytes, note] = payload.attachments;
    expect(Buffer.isBuffer(bytes.content)).toBe(true);
    expect([...bytes.content]).toEqual([1, 2, 3]);
    expect(bytes).toMatchObject({
      filename: "bytes.bin",
      contentType: "application/octet-stream",
    });
    expect(note).toEqual({ filename: "note.txt", content: "plain", contentType: undefined });
  });

  it("omits attachments from the Resend payload when none are given", async () => {
    resendSend.mockResolvedValue({ data: { id: "resend-empty" }, error: null });
    configureEmail(
      {
        mail: { kind: "resend", apiKey: "test", fromEmail: "sender@example.com" },
        trustedActionOrigins: [],
      },
      new ResendMailProvider(createResendTransport("test"), 100),
    );

    await sendRawEmail({
      to: "recipient@example.com",
      subject: "No attachments",
      text: "Body",
      attachments: [],
    });

    expect(resendSend.mock.lastCall?.[0].attachments).toBeUndefined();
  });
});

describe("email event fields", () => {
  it.each([
    [
      { status: "sent", messageId: "resend-1" },
      { resendMessageId: "resend-1", error: null, suppressed: false },
    ],
    [{ status: "sent" }, { resendMessageId: null, error: null, suppressed: false }],
    [
      { status: "suppressed", reason: "Mail delivery is suppressed" },
      { resendMessageId: null, error: "Mail delivery is suppressed", suppressed: true },
    ],
    [
      {
        status: "failed",
        failure: { kind: "transient", retryMode: "provider-idempotent", message: "busy" },
      },
      { resendMessageId: null, error: "busy", suppressed: false },
    ],
  ] as const)("records %o", (result, expected) => {
    expect(emailEventFields(result)).toEqual(expected);
  });
});

describe("email sender validation", () => {
  it("rejects an invalid sender as a permanent failure without calling the provider", async () => {
    const send = vi.fn<MailProvider["send"]>();
    configureEmail(
      {
        mail: { kind: "resend", apiKey: "test", fromEmail: "sender@example.com" },
        trustedActionOrigins: [],
      },
      { send, health: async () => ({ status: "configured", provider: "resend" }) },
    );

    await expect(
      sendRawEmail({
        to: "recipient@example.com",
        from: "not-an-address",
        subject: "Test",
        text: "Test",
      }),
    ).resolves.toEqual({
      status: "failed",
      failure: {
        kind: "permanent",
        retryMode: "never",
        message: "MAIL_FROM must be a valid email address",
      },
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("mail retry policy", () => {
  it("retries provider-idempotent transient failures", async () => {
    const send = vi
      .fn<MailProvider["send"]>()
      .mockResolvedValueOnce({
        status: "failed",
        failure: {
          kind: "transient",
          retryMode: "provider-idempotent",
          message: "busy",
        },
      })
      .mockResolvedValueOnce({ status: "sent", messageId: "sent-1" });
    configureEmail(
      {
        mail: { kind: "resend", apiKey: "test", fromEmail: "sender@example.com" },
        trustedActionOrigins: ["https://app.example.com"],
      },
      {
        send,
        health: async () => ({ status: "configured", provider: "resend" }),
      },
    );

    const result = await sendTemplateEmailWithRetry({
      to: "recipient@example.com",
      template: "generic",
      data: { subject: "Test", body: "Test" },
      idempotencyKey: "stable-key",
    });

    expect(result).toMatchObject({ status: "sent", attempts: 2 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([call]) => call.idempotencyKey)).toEqual([
      "stable-key",
      "stable-key",
    ]);
  });

  it("does not retry when the provider marks a failure as final", async () => {
    const send = vi.fn<MailProvider["send"]>().mockResolvedValue({
      status: "failed",
      failure: {
        kind: "transient",
        retryMode: "never",
        code: "timeout",
        message: "timed out",
      },
    });
    configureEmail(
      {
        mail: { kind: "resend", apiKey: "test", fromEmail: "sender@example.com" },
        trustedActionOrigins: ["https://app.example.com"],
      },
      {
        send,
        health: async () => ({ status: "configured", provider: "resend" }),
      },
    );

    const result = await sendTemplateEmailWithRetry({
      to: "recipient@example.com",
      template: "generic",
      data: { subject: "Test", body: "Test" },
    });

    expect(result).toMatchObject({ status: "failed", attempts: 1 });
    expect(send).toHaveBeenCalledOnce();
  });
});

describe("email action links", () => {
  it("suppresses console delivery before validating or rendering an action URL", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    configureEmail({
      mail: { kind: "console" },
      trustedActionOrigins: [],
    });

    await expect(
      sendTemplateEmail({
        to: "recipient@example.com",
        template: "document-invitation",
        data: { actionUrl: "http://untrusted.example/documents/123" },
      }),
    ).resolves.toEqual({
      status: "suppressed",
      reason: "Mail delivery is suppressed",
    });
    expect(info).toHaveBeenCalledWith("[mail] suppressed");
    expect(warning).toHaveBeenCalledWith("[email] delivery_suppressed");
  });

  it("renders links only for a configured trusted HTTPS origin", async () => {
    const send = vi.fn<MailProvider["send"]>().mockResolvedValue({
      status: "sent",
      messageId: "sent-1",
    });
    configureEmail(
      {
        mail: { kind: "resend", apiKey: "test", fromEmail: "sender@example.com" },
        trustedActionOrigins: ["https://app.example.com"],
      },
      {
        send,
        health: async () => ({ status: "configured", provider: "resend" }),
      },
    );

    await expect(
      sendTemplateEmail({
        to: "recipient@example.com",
        template: "document-invitation",
        data: {
          body: "Review the attached document summary.",
          actionUrl: "https://app.example.com/documents/123?view=review",
        },
      }),
    ).resolves.toMatchObject({ status: "sent" });

    const message = send.mock.calls[0][0].message;
    expect(message.from).toBe("Prism Legal <sender@example.com>");
    expect(message.html).toContain("https://app.example.com/documents/123?view=review");
    expect(message.html).not.toContain("No sensitive document content is included");
    expect(message.text).toContain("Open in Prism Legal:");
  });

  it.each([
    "https://attacker.example/documents/123",
    "https://app.example.com.attacker.example/documents/123",
    "https://app.example.com:444/documents/123",
    "https://user@app.example.com/documents/123",
    "http://app.example.com/documents/123",
    "not-a-url",
  ])("rejects an untrusted action URL before delivery: %s", async (actionUrl) => {
    const send = vi.fn<MailProvider["send"]>();
    configureEmail(
      {
        mail: { kind: "resend", apiKey: "test", fromEmail: "sender@example.com" },
        trustedActionOrigins: ["https://app.example.com"],
      },
      {
        send,
        health: async () => ({ status: "configured", provider: "resend" }),
      },
    );

    await expect(
      sendTemplateEmail({
        to: "recipient@example.com",
        template: "document-invitation",
        data: { actionUrl },
      }),
    ).resolves.toMatchObject({
      status: "failed",
      failure: { kind: "permanent", retryMode: "never" },
    });
    expect(send).not.toHaveBeenCalled();
  });
});
