import { describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential } from "../../src/lib/llm/credentials.js";
import {
  createSafeProviderFetch,
  isProhibitedProviderAddress,
  validateCustomProviderEndpoint,
} from "../../src/lib/llm/safeProviderFetch.js";
import {
  AI_MODEL_CATALOG,
  assertModelSupports,
  modelForId,
  providerForModel,
} from "../../src/lib/llm/models.js";
import { providerConnectionDto } from "../../src/lib/aiRegistry.js";
import { resolveAiModel } from "../../src/lib/llm/providerRegistry.js";
import type { AiRuntimeContext } from "../../src/lib/llm/types.js";

const oldEncryption = {
  activeKeyId: "old",
  keys: { old: "old-encryption-secret-0123456789" },
};
const rotatedEncryption = {
  activeKeyId: "new",
  keys: {
    old: "old-encryption-secret-0123456789",
    new: "new-encryption-secret-0123456789",
  },
};

describe("AI credentials", () => {
  it("binds ciphertext to its user and provider", () => {
    const encrypted = encryptCredential(
      "sk-secret",
      { userId: "user-1", provider: "anthropic" },
      oldEncryption,
    );

    expect(
      decryptCredential(encrypted, { userId: "user-1", provider: "anthropic" }, oldEncryption)
        .plaintext,
    ).toBe("sk-secret");
    expect(() =>
      decryptCredential(encrypted, { userId: "user-2", provider: "anthropic" }, oldEncryption),
    ).toThrow();
    expect(() =>
      decryptCredential(encrypted, { userId: "user-1", provider: "openai" }, oldEncryption),
    ).toThrow();
  });

  it("marks credentials encrypted with an inactive key for rotation", () => {
    const oldEnvelope = encryptCredential(
      "sk-secret",
      { userId: "user-1", provider: "google" },
      oldEncryption,
    );
    expect(
      decryptCredential(oldEnvelope, { userId: "user-1", provider: "google" }, rotatedEncryption),
    ).toEqual({ plaintext: "sk-secret", needsRotation: true });
  });
});

describe("custom provider network policy", () => {
  it.each([
    "0.0.0.0",
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "192.31.196.1",
    "192.52.193.1",
    "169.254.169.254",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fd00::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "100::1",
    "::ffff:127.0.0.1",
    "::ffff:0:127.0.0.1",
    "64:ff9b::808:808",
    "64:ff9b:1::808:808",
    "2001:db8::1",
    "2001::1",
    "2001:2::1",
    "2001:3::1",
    "2001:4:112::1",
    "2001:10::1",
    "2001:20::1",
    "2001:30::1",
    "2002::1",
    "3fff::1",
    "5f00::1",
  ])("rejects prohibited address %s", (address) => {
    expect(isProhibitedProviderAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "::ffff:8.8.8.8", "2001:4860:4860::8888", "2606:4700:4700::1111"])(
    "accepts global-unicast address %s",
    (address) => {
      expect(isProhibitedProviderAddress(address)).toBe(false);
    },
  );

  it("resolves again when the request starts and blocks DNS rebinding", async () => {
    let resolution = 0;
    const resolveHostname = async () => {
      resolution += 1;
      return resolution === 1 ? ["8.8.8.8"] : ["127.0.0.1"];
    };

    await expect(
      validateCustomProviderEndpoint("https://models.example.com/v1", { resolveHostname }),
    ).resolves.toBe("https://models.example.com/v1");

    const safeFetch = createSafeProviderFetch({ resolveHostname });
    await expect(safeFetch("https://models.example.com/v1")).rejects.toThrow(
      /prohibited network address/,
    );
    expect(resolution).toBe(2);
  });

  it("rejects loopback endpoints over HTTP and HTTPS", async () => {
    const resolveHostname = async () => ["127.0.0.1"];
    await expect(
      validateCustomProviderEndpoint("http://localhost:11434/v1", { resolveHostname }),
    ).rejects.toThrow("Custom AI provider endpoints must use HTTPS");
    await expect(
      validateCustomProviderEndpoint("https://localhost:11434/v1", { resolveHostname }),
    ).rejects.toThrow("Custom AI provider endpoint resolves to a prohibited network address");
  });
});

describe("model registry", () => {
  it("uses exact catalog records instead of model-name prefixes", () => {
    expect(providerForModel("gpt-5.4-mini")).toBe("openai");
    expect(() => providerForModel("gpt-unregistered")).toThrow(/Unknown model id/);
    expect(new Set(AI_MODEL_CATALOG.map(({ id }) => id)).size).toBe(AI_MODEL_CATALOG.length);
  });

  it("rejects unsupported capabilities before provider resolution", () => {
    expect(() =>
      assertModelSupports(modelForId("gpt-5.4-mini"), {
        inlineFileMimeType: "application/pdf",
      }),
    ).toThrow(/does not support PDF input/);
  });

  it("prefers a user's explicit first-party connection over server credentials", () => {
    const record = modelForId("gpt-5.4-mini");
    const resolved = resolveAiModel(record.id, {
      models: [record],
      connections: [
        {
          id: "user-openai",
          provider: "openai",
          source: "user",
          name: "Personal OpenAI",
          credential: "user-secret",
        },
        {
          id: "server:openai",
          provider: "openai",
          source: "server",
          name: "Server OpenAI",
          credential: "server-secret",
        },
      ],
    });

    expect(resolved.connection.id).toBe("user-openai");
  });

  it("honors an explicit connection and rejects mismatched model bindings", () => {
    const record = modelForId("gpt-5.4-mini");
    const context: AiRuntimeContext = {
      models: [record],
      connections: [
        {
          id: "user-openai",
          provider: "openai",
          source: "user",
          name: "Personal OpenAI",
          credential: "user-secret",
        },
        {
          id: "server:openai",
          provider: "openai",
          source: "server",
          name: "Server OpenAI",
          credential: "server-secret",
        },
      ],
    };

    expect(resolveAiModel(record.id, context, "server:openai").connection.id).toBe("server:openai");
    expect(() =>
      resolveAiModel(
        record.id,
        {
          ...context,
          connections: [
            {
              id: "wrong-provider",
              provider: "anthropic",
              source: "user",
              name: "Wrong provider",
              credential: "secret",
            },
          ],
        },
        "wrong-provider",
      ),
    ).toThrow(/cannot serve model/);
  });

  it("serializes connections without credential material", () => {
    const dto = providerConnectionDto({
      id: "connection-1",
      provider: "openai",
      source: "user",
      name: "My OpenAI",
      credential: "sk-secret",
    });

    expect(dto).toEqual({
      id: "connection-1",
      provider: "openai",
      source: "user",
      name: "My OpenAI",
      baseUrl: null,
      enabled: true,
      hasCredential: true,
      models: [],
    });
    expect(JSON.stringify(dto)).not.toContain("sk-secret");
  });
});
