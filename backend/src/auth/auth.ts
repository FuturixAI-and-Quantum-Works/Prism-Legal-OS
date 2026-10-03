import { createHmac } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import type { AppConfig } from "../config.js";
import {
  accounts,
  authEmailEvents,
  rateLimits,
  sessions,
  users,
  verifications,
} from "../db/index.js";
import type { Database } from "../db/index.js";
import { deliveryRecord, type SendWithRetryResult } from "../lib/email.js";
import { createOtpDeliveryCallback } from "./otpDelivery.js";

export type AuthDependencies = Readonly<{
  database: Database;
  sendOtpEmail: (email: string, otp: string) => Promise<SendWithRetryResult>;
}>;

export function createAuth(config: AppConfig, dependencies: AuthDependencies) {
  const sendVerificationOTP = createOtpDeliveryCallback(
    dependencies.sendOtpEmail,
    async (delivery, result) => {
      const { suppressed, ...record } = deliveryRecord(result);
      await dependencies.database.insert(authEmailEvents).values({
        recipient: delivery.email.toLowerCase(),
        template: "otp",
        triggerType: delivery.type,
        status: result.status,
        ...record,
        retryCount: result.attempts,
        metadata: {
          email_delivered: result.status === "sent",
          suppressed,
        },
      });
    },
  );
  const socialProviders =
    config.auth.google.kind === "google"
      ? {
          google: {
            clientId: config.auth.google.clientId,
            clientSecret: config.auth.google.clientSecret,
            scope: ["openid", "email", "profile"],
          },
        }
      : {};

  return betterAuth({
    appName: "Prism",
    baseURL: config.auth.baseUrl,
    basePath: "/auth",
    secret: config.secrets.betterAuth,
    trustedOrigins: [...config.auth.trustedOrigins],
    database: drizzleAdapter(dependencies.database, {
      provider: "pg",
      schema: {
        users,
        accounts,
        sessions,
        verifications,
        rateLimits,
      },
      transaction: true,
      usePlural: true,
    }),
    user: {
      modelName: "user",
      fields: {
        name: "fullName",
        email: "email",
        emailVerified: "emailVerified",
        image: "image",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
    },
    account: {
      modelName: "account",
      fields: {
        userId: "userId",
        providerId: "providerId",
        issuer: "issuer",
        accountId: "accountId",
        accessToken: "accessToken",
        refreshToken: "refreshToken",
        idToken: "idToken",
        accessTokenExpiresAt: "accessTokenExpiresAt",
        refreshTokenExpiresAt: "refreshTokenExpiresAt",
        scope: "scope",
        password: "password",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
      encryptOAuthTokens: true,
      storeStateStrategy: "database",
      accountLinking: {
        enabled: true,
        allowDifferentEmails: false,
        trustedProviders: ["google"],
      },
    },
    session: {
      modelName: "session",
      fields: {
        userId: "userId",
        expiresAt: "expiresAt",
        token: "token",
        ipAddress: "ipAddress",
        userAgent: "userAgent",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: false,
      },
    },
    verification: {
      modelName: "verification",
      fields: {
        identifier: "identifier",
        value: "value",
        expiresAt: "expiresAt",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimit",
      fields: {
        key: "key",
        count: "count",
        lastRequest: "lastRequest",
      },
    },
    socialProviders,
    plugins: [
      emailOTP({
        sendVerificationOTP,
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 3,
        resendStrategy: "rotate",
        storeOTP: {
          hash: async (otp) =>
            createHmac("sha256", config.secrets.authOtp).update(otp).digest("hex"),
        },
      }),
    ],
    advanced: {
      database: {
        generateId: "uuid",
      },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.runtime.kind === "production",
      },
      useSecureCookies: config.runtime.kind === "production",
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"];
