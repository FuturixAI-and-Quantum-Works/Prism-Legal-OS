import type { SendWithRetryResult } from "../lib/email.js";

export type OtpDelivery = Readonly<{
  email: string;
  otp: string;
  type: "sign-in" | "email-verification" | "forget-password" | "change-email";
}>;

type OtpSender = (email: string, otp: string) => Promise<SendWithRetryResult>;
type OtpEventRecorder = (delivery: OtpDelivery, result: SendWithRetryResult) => Promise<void>;

export function createOtpDeliveryCallback(
  send: OtpSender,
  record: OtpEventRecorder,
): (delivery: OtpDelivery) => Promise<void> {
  return async (delivery) => {
    const result = await send(delivery.email, delivery.otp);
    await record(delivery, result);
    if (result.status === "failed") {
      throw new Error("OTP delivery failed");
    }
  };
}
