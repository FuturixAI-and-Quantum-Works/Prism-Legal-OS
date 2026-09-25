import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../../src/config.js";
import * as schema from "../../src/db/schema/index.js";
import {
  createProviderConnection,
  listAvailableModels,
  listProviderConnections,
  updateProviderConnection,
  type AiRegistryDatabase,
  type ConnectionModelInput,
} from "../../src/lib/aiRegistry.js";
import { AI_MODEL_CATALOG, seedAiCatalog } from "../../src/scripts/seedAiCatalog.js";

const databaseSchema = `
  CREATE TABLE users (
    id uuid PRIMARY KEY,
    email varchar(255) NOT NULL,
    full_name varchar(255) NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE ai_provider_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider varchar(50) NOT NULL,
    name varchar(120) NOT NULL,
    credential_version integer NOT NULL,
    credential_key_id varchar(80) NOT NULL,
    encrypted_credential text NOT NULL,
    iv text NOT NULL,
    auth_tag text NOT NULL,
    base_url text,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL,
    UNIQUE(user_id, name)
  );
  CREATE TABLE ai_provider_models (
    id varchar(150) PRIMARY KEY,
    provider varchar(50) NOT NULL,
    provider_model_id varchar(150) NOT NULL,
    connection_id uuid REFERENCES ai_provider_connections(id) ON DELETE CASCADE,
    owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    display_name varchar(150) NOT NULL,
    capabilities jsonb NOT NULL,
    tasks jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE user_ai_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task text NOT NULL,
    connection_id varchar(150) NOT NULL,
    model_id varchar(150) NOT NULL REFERENCES ai_provider_models(id) ON DELETE CASCADE,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL,
    UNIQUE(user_id, task)
  );
`;

const userId = "00000000-0000-4000-8000-000000000001";
const capabilities = {
  input: { text: true, image: false, pdf: false },
  output: { text: true, structured: false, toolCalls: false },
};
const aiConfig = {
  credentialEncryption: {
    activeKeyId: "v1",
    keys: { v1: "0123456789abcdef".repeat(4) },
  },
  openai: { kind: "disabled" },
} satisfies AppConfig["ai"];

function model(overrides: Partial<ConnectionModelInput> = {}): ConnectionModelInput {
  return {
    providerModelId: "custom-model",
    displayName: "Custom model",
    capabilities,
    tasks: ["main"],
    ...overrides,
  };
}

describe("AI connection lifecycle", () => {
  let client: PGlite;
  let database: AiRegistryDatabase;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec(databaseSchema);
    await client.query("INSERT INTO users (id, email, full_name) VALUES ($1, $2, $3)", [
      userId,
      "user@example.com",
      "Prism User",
    ]);
    database = drizzle(client, { schema });
  });

  afterEach(async () => {
    await client.close();
  });

  it("rolls back the connection when model synchronization fails", async () => {
    await expect(
      createProviderConnection(
        userId,
        {
          provider: "openai-compatible",
          name: "Gateway",
          credential: "secret",
          baseUrl: "https://8.8.8.8/v1",
          models: [model(), model({ displayName: "Duplicate" })],
        },
        database,
        aiConfig,
      ),
    ).rejects.toThrow(/duplicate provider model IDs/);

    const result = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM ai_provider_connections",
    );
    expect(result.rows).toEqual([{ count: "0" }]);
  });

  it("preserves model identity, preferences, and ciphertext through edits and re-enabling", async () => {
    const connection = await createProviderConnection(
      userId,
      {
        provider: "openai-compatible",
        name: "Gateway",
        credential: "original-secret",
        baseUrl: "https://8.8.8.8/v1",
        models: [model()],
      },
      database,
      aiConfig,
    );
    const initialModels = await client.query<{ id: string }>(
      "SELECT id FROM ai_provider_models WHERE connection_id = $1",
      [connection.id],
    );
    const modelId = initialModels.rows[0]?.id;
    if (!modelId) throw new Error("Expected the custom model");
    const initialCredential = await client.query<{
      encrypted_credential: string;
      iv: string;
      auth_tag: string;
    }>("SELECT encrypted_credential, iv, auth_tag FROM ai_provider_connections WHERE id = $1", [
      connection.id,
    ]);
    await client.query(
      "INSERT INTO user_ai_preferences (user_id, task, connection_id, model_id) VALUES ($1, 'main', $2, $3)",
      [userId, connection.id, modelId],
    );

    await updateProviderConnection(
      userId,
      connection.id,
      {
        provider: "openai-compatible",
        name: "Renamed gateway",
        baseUrl: "https://8.8.8.8/v2",
        enabled: false,
        models: [
          model({
            id: modelId,
            providerModelId: "renamed-model",
            displayName: "Renamed model",
          }),
        ],
      },
      database,
      aiConfig,
    );

    const editConnections = await listProviderConnections(userId, database, aiConfig);
    expect(editConnections).toMatchObject([
      {
        id: connection.id,
        enabled: false,
        models: [{ id: modelId, providerModelId: "renamed-model" }],
      },
    ]);
    await expect(listAvailableModels(userId, database, aiConfig)).resolves.toEqual([]);

    await updateProviderConnection(
      userId,
      connection.id,
      {
        provider: "openai-compatible",
        name: "Renamed gateway",
        baseUrl: "https://8.8.8.8/v2",
        enabled: true,
        models: [model({ id: modelId, providerModelId: "renamed-model" })],
      },
      database,
      aiConfig,
    );

    const finalModel = await client.query<{ id: string; provider_model_id: string }>(
      "SELECT id, provider_model_id FROM ai_provider_models WHERE connection_id = $1",
      [connection.id],
    );
    const finalCredential = await client.query<{
      encrypted_credential: string;
      iv: string;
      auth_tag: string;
    }>("SELECT encrypted_credential, iv, auth_tag FROM ai_provider_connections WHERE id = $1", [
      connection.id,
    ]);
    const preference = await client.query<{ model_id: string }>(
      "SELECT model_id FROM user_ai_preferences WHERE user_id = $1",
      [userId],
    );

    expect(finalModel.rows).toEqual([{ id: modelId, provider_model_id: "renamed-model" }]);
    expect(finalCredential.rows).toEqual(initialCredential.rows);
    expect(preference.rows).toEqual([{ model_id: modelId }]);
    await expect(listAvailableModels(userId, database, aiConfig)).resolves.toMatchObject([
      { id: modelId, connectionId: connection.id },
    ]);
  });

  it("disables stale catalog models without changing user-defined models", async () => {
    const connection = await createProviderConnection(
      userId,
      {
        provider: "openai-compatible",
        name: "User gateway",
        credential: "user-secret",
        baseUrl: "https://8.8.8.8/v1",
        models: [model()],
      },
      database,
      aiConfig,
    );
    await client.query(
      `INSERT INTO ai_provider_models
        (id, provider, provider_model_id, display_name, capabilities, tasks, enabled)
       VALUES ($1, 'openai', $1, 'Stale managed model', $2, $3, true)`,
      ["stale-managed-model", capabilities, ["main"]],
    );

    await seedAiCatalog(database);

    const stale = await client.query<{ enabled: boolean }>(
      "SELECT enabled FROM ai_provider_models WHERE id = 'stale-managed-model'",
    );
    const custom = await client.query<{ enabled: boolean }>(
      "SELECT enabled FROM ai_provider_models WHERE connection_id = $1",
      [connection.id],
    );
    const activeCatalog = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM ai_provider_models
       WHERE owner_user_id IS NULL AND connection_id IS NULL AND enabled`,
    );

    expect(stale.rows).toEqual([{ enabled: false }]);
    expect(custom.rows).toEqual([{ enabled: true }]);
    expect(activeCatalog.rows).toEqual([{ count: String(AI_MODEL_CATALOG.length) }]);
  });

  it("lists the server OpenAI key as the only server connection", async () => {
    const connections = await listProviderConnections(userId, database, {
      ...aiConfig,
      openai: { kind: "configured", apiKey: "server-openai-key" },
    });

    expect(connections.map(({ id, provider, source }) => ({ id, provider, source }))).toEqual([
      { id: "server:openai", provider: "openai", source: "server" },
    ]);
  });
});
