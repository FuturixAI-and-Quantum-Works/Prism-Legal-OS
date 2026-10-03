import assert from "node:assert/strict";
import test from "node:test";
import { createOtpDeliveryCallback, type OtpDelivery } from "../../src/auth/otpDelivery.js";

const delivery: OtpDelivery = {
  email: "user@example.com",
  otp: "123456",
  type: "sign-in",
};

test("OTP delivery records success without exposing provider details", async () => {
  const recorded: Array<{ delivery: OtpDelivery; status: string }> = [];
  const callback = createOtpDeliveryCallback(
    async () => ({
      status: "sent",
      messageId: "provider-message-id",
      attempts: 1,
    }),
    async (input, result) => {
      recorded.push({ delivery: input, status: result.status });
    },
  );

  assert.equal(await callback(delivery), undefined);
  assert.deepEqual(recorded, [{ delivery, status: "sent" }]);
});

test("OTP delivery records failure and rejects authentication delivery", async () => {
  let recorded = false;
  const callback = createOtpDeliveryCallback(
    async () => ({
      status: "failed",
      failure: {
        kind: "transient",
        retryMode: "provider-idempotent",
        message: "provider unavailable",
      },
      attempts: 3,
    }),
    async () => {
      recorded = true;
    },
  );

  await assert.rejects(() => callback(delivery), /OTP delivery failed/);
  assert.equal(recorded, true);
});
