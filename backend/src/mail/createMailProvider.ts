import type { AppConfig } from "../config.js";
import { ConsoleMailProvider } from "./consoleMailProvider.js";
import { ResendMailProvider, createResendTransport } from "./resendMailProvider.js";
import type { MailProvider } from "./types.js";

const MAIL_SEND_TIMEOUT_MS = 10_000;

export function createMailProvider(config: AppConfig["mail"]): MailProvider {
  switch (config.kind) {
    case "console":
      return new ConsoleMailProvider();
    case "resend":
      return new ResendMailProvider(createResendTransport(config.apiKey), MAIL_SEND_TIMEOUT_MS);
    default: {
      const unsupported: never = config;
      throw new Error(`Unsupported mail provider: ${JSON.stringify(unsupported)}`);
    }
  }
}
