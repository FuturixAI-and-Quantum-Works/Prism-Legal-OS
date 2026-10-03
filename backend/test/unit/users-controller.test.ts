import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AiModelTargetDto,
  ProviderConnectionDto,
  UserProfileRow,
} from "../../src/modules/users/users.dto.js";
import type { UsersRepository } from "../../src/modules/users/users.repository.js";
import { createUsersController } from "../../src/modules/users/users.controller.js";
import { UsersService, type UserAiSettings } from "../../src/modules/users/users.service.js";

const capabilities = {
  input: { text: true, image: false, pdf: false },
  output: { text: true, structured: true, toolCalls: false },
};

const connection: ProviderConnectionDto = {
  id: "connection-1",
  provider: "openai",
  name: "Team OpenAI",
  source: "user",
  baseUrl: null,
  enabled: true,
  hasCredential: true,
  models: [
    {
      id: "model-1",
      providerModelId: "gpt-test",
      displayName: "GPT Test",
      capabilities,
      tasks: ["main"],
    },
  ],
};

const model: AiModelTargetDto = {
  id: "model-1",
  provider: "openai",
  providerModelId: "gpt-test",
  displayName: "GPT Test",
  capabilities,
  tasks: ["main"],
  connectionId: "connection-1",
  connectionName: "Team OpenAI",
  connectionSource: "user",
};

const profile: UserProfileRow = {
  displayName: "A User",
  country: "GB",
  jurisdiction: null,
  organization: "Prism",
  professionalRole: null,
  role: "viewer",
  onboardingCompleted: true,
  storageLimitBytes: 1000n,
  storageUsedBytes: 100n,
  messageCreditsUsed: 0,
  creditsResetDate: null,
  tier: "Free",
};

const validConnection = {
  provider: "openai",
  name: "Team OpenAI",
  credential: "test-credential",
};

function fakeRepository(): UsersRepository {
  return {
    ensureProfile: vi.fn(async () => undefined),
    findProfile: vi.fn(async () => profile),
    resetCredits: vi.fn(async () => profile),
    completeOnboarding: vi.fn(async () => undefined),
    updateProfile: vi.fn(async () => undefined),
    deleteAccount: vi.fn(async () => undefined),
  };
}

function fakeAiSettings(overrides: Partial<UserAiSettings>): UserAiSettings {
  return {
    listConnections: vi.fn(async () => [connection]),
    createConnection: vi.fn(async () => connection),
    updateConnection: vi.fn(async () => connection),
    deleteConnection: vi.fn(async () => true),
    testConnection: vi.fn(async () => "ok" as const),
    listModels: vi.fn(async () => [model]),
    getPreferences: vi.fn(async () => ({})),
    setPreference: vi.fn(async () => undefined),
    ...overrides,
  };
}

const servers: { close: () => void }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function serveUsers(
  aiOverrides: Partial<UserAiSettings> = {},
  repository: UsersRepository = fakeRepository(),
) {
  const ai = fakeAiSettings(aiOverrides);
  const controller = createUsersController({
    profiles: new UsersService(repository, ai),
    accounts: repository,
    ai,
  });
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    Reflect.set(res.locals, "auth", { user: { id: "user-1", email: "user@example.com" } });
    next();
  });
  app.post("/profile", controller.ensureProfile);
  app.get("/ai/connections", controller.listConnections);
  app.post("/ai/connections", controller.createConnection);
  app.put("/ai/connections/:connectionId", controller.updateConnection);
  app.delete("/ai/connections/:connectionId", controller.deleteConnection);
  app.post("/ai/connections/:connectionId/test", controller.testConnection);
  app.get("/ai/models", controller.listModels);
  app.get("/ai/preferences", controller.getPreferences);
  app.put("/ai/preferences/:task", controller.setPreference);
  app.delete("/account", controller.deleteAccount);

  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server unavailable");
  const origin = `http://127.0.0.1:${address.port}`;
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${origin}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { ai, repository, send };
}

describe("users controller", () => {
  it("creates the caller's profile row", async () => {
    const { repository, send } = await serveUsers();
    const response = await send("POST", "/profile");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(repository.ensureProfile).toHaveBeenCalledWith("user-1");
  });

  it("lists the caller's AI connections", async () => {
    const { ai, send } = await serveUsers();
    const response = await send("GET", "/ai/connections");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([connection]);
    expect(ai.listConnections).toHaveBeenCalledWith("user-1");
  });

  it("reports a failed connection listing as a 500 with the error message", async () => {
    const { send } = await serveUsers({
      listConnections: async () => {
        throw new Error("registry offline");
      },
    });
    const response = await send("GET", "/ai/connections");
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ detail: "registry offline" });
  });

  it("creates a connection and answers 201", async () => {
    const { ai, send } = await serveUsers();
    const response = await send("POST", "/ai/connections", validConnection);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(connection);
    expect(ai.createConnection).toHaveBeenCalledWith("user-1", validConnection);
  });

  it("rejects an invalid connection body before it reaches the registry", async () => {
    const { ai, send } = await serveUsers();
    const response = await send("POST", "/ai/connections", { provider: "openai" });
    expect(response.status).toBe(400);
    expect(ai.createConnection).not.toHaveBeenCalled();
  });

  it("reports a registry rejection on create as a 400", async () => {
    const { send } = await serveUsers({
      createConnection: async () => {
        throw new Error("Duplicate connection name");
      },
    });
    const response = await send("POST", "/ai/connections", validConnection);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ detail: "Duplicate connection name" });
  });

  it("updates a connection by id", async () => {
    const { ai, send } = await serveUsers();
    const response = await send("PUT", "/ai/connections/connection-1", {
      provider: "openai",
      name: "Renamed",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(connection);
    expect(ai.updateConnection).toHaveBeenCalledWith("user-1", "connection-1", {
      provider: "openai",
      name: "Renamed",
    });
  });

  it("answers 404 when the connection to update does not exist", async () => {
    const { send } = await serveUsers({ updateConnection: async () => null });
    const response = await send("PUT", "/ai/connections/missing", {
      provider: "openai",
      name: "Renamed",
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ detail: "Connection not found" });
  });

  it("reports a registry rejection on update as a 400", async () => {
    const { send } = await serveUsers({
      updateConnection: async () => {
        throw new Error("Server connections are read-only");
      },
    });
    const response = await send("PUT", "/ai/connections/connection-1", {
      provider: "openai",
      name: "Renamed",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      detail: "Server connections are read-only",
    });
  });

  it("deletes a connection and answers 204", async () => {
    const { ai, send } = await serveUsers();
    const response = await send("DELETE", "/ai/connections/connection-1");
    expect(response.status).toBe(204);
    expect(ai.deleteConnection).toHaveBeenCalledWith("user-1", "connection-1");
  });

  it("answers 404 when the connection to delete does not exist", async () => {
    const { send } = await serveUsers({ deleteConnection: async () => false });
    const response = await send("DELETE", "/ai/connections/missing");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ detail: "Connection not found" });
  });

  it.each([
    ["ok", 200, { ok: true }],
    ["not-found", 404, { detail: "Connection not found" }],
    ["no-model", 409, { detail: "Connection has no available model" }],
  ] as const)("maps a %s connection test to %i", async (result, status, body) => {
    const { send } = await serveUsers({ testConnection: async () => result });
    const response = await send("POST", "/ai/connections/connection-1/test");
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(body);
  });

  it("passes the caller and connection id to the connection test", async () => {
    const { ai, send } = await serveUsers();
    await send("POST", "/ai/connections/connection-1/test");
    expect(ai.testConnection).toHaveBeenCalledWith("user-1", "connection-1");
  });

  it("hides provider errors from a failed connection test behind a 502", async () => {
    const { send } = await serveUsers({
      testConnection: async () => {
        throw new Error("401 invalid key sk-secret");
      },
    });
    const response = await send("POST", "/ai/connections/connection-1/test");
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ detail: "Provider connection test failed" });
  });

  it("lists the models available to the caller", async () => {
    const { ai, send } = await serveUsers();
    const response = await send("GET", "/ai/models");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([model]);
    expect(ai.listModels).toHaveBeenCalledWith("user-1");
  });

  it("returns the caller's AI preferences", async () => {
    const preferences = { main: { connectionId: "connection-1", modelId: "model-1" } };
    const { ai, send } = await serveUsers({ getPreferences: vi.fn(async () => preferences) });
    const response = await send("GET", "/ai/preferences");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(preferences);
    expect(ai.getPreferences).toHaveBeenCalledWith("user-1");
  });

  it("stores a preference and returns the refreshed preferences", async () => {
    const target = { connectionId: "connection-1", modelId: "model-1" };
    const stored: Record<string, typeof target> = {};
    const { ai, send } = await serveUsers({
      setPreference: vi.fn(async (_userId, task, value) => {
        stored[task] = value;
      }),
      getPreferences: async () => ({ ...stored }),
    });
    const response = await send("PUT", "/ai/preferences/title", target);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ title: target });
    expect(ai.setPreference).toHaveBeenCalledWith("user-1", "title", target);
  });

  it("rejects an unknown preference task", async () => {
    const { ai, send } = await serveUsers();
    const response = await send("PUT", "/ai/preferences/unknown", {
      connectionId: "connection-1",
      modelId: "model-1",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ detail: "Invalid AI preference" });
    expect(ai.setPreference).not.toHaveBeenCalled();
  });

  it("reports a registry rejection on preference update as a 400", async () => {
    const { send } = await serveUsers({
      setPreference: async () => {
        throw new Error("Model does not support task");
      },
    });
    const response = await send("PUT", "/ai/preferences/main", {
      connectionId: "connection-1",
      modelId: "model-1",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ detail: "Model does not support task" });
  });

  it("deletes the caller's account and answers 204", async () => {
    const { repository, send } = await serveUsers();
    const response = await send("DELETE", "/account");
    expect(response.status).toBe(204);
    expect(repository.deleteAccount).toHaveBeenCalledWith("user-1");
  });

  it("reports a failed account deletion as a 500", async () => {
    const repository = fakeRepository();
    repository.deleteAccount = async () => {
      throw new Error("constraint violation");
    };
    const { send } = await serveUsers({}, repository);
    const response = await send("DELETE", "/account");
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ detail: "constraint violation" });
  });
});
