import { randomUUID } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import {
  db,
  aiProviderConnections,
  aiProviderModels,
  userAiPreferences,
  type Database,
} from "../db/index.js";
import { getAppConfig, type AppConfig } from "../config.js";
import {
  decryptCredential,
  encryptCredential,
  type EncryptedCredential,
} from "./llm/credentials.js";
import { validateCustomProviderEndpoint } from "./llm/safeProviderFetch.js";
import type {
  AiModelRecord,
  AiProviderConnection,
  AiRuntimeContext,
  AiTarget,
  AiTask,
  ModelCapabilities,
  Provider,
} from "./llm/types.js";

const providers = ["anthropic", "google", "openai", "openai-compatible"] as const;

export type ProviderConnectionDto = Readonly<{
  id: string;
  provider: Provider;
  name: string;
  source: "server" | "user";
  baseUrl: string | null;
  enabled: boolean;
  hasCredential: true;
  models: readonly ConnectionModelDto[];
}>;

export type ConnectionModelDto = Readonly<{
  id: string;
  providerModelId: string;
  displayName: string;
  capabilities: ModelCapabilities;
  tasks: readonly AiTask[];
}>;

export type ConnectionModelInput = Readonly<{
  id?: string;
  providerModelId: string;
  displayName: string;
  capabilities: ModelCapabilities;
  tasks: readonly AiTask[];
}>;

type ProviderConnectionFields = Readonly<{
  provider: Provider;
  name: string;
  baseUrl?: string;
  enabled?: boolean;
  models?: readonly ConnectionModelInput[];
}>;

export type CreateProviderConnectionInput = ProviderConnectionFields &
  Readonly<{ credential: string }>;

export type UpdateProviderConnectionInput = ProviderConnectionFields &
  Readonly<{ credential?: string }>;

export type AiModelTargetDto = AiModelRecord &
  Readonly<{
    connectionId: string;
    connectionName: string;
    connectionSource: "server" | "user";
  }>;

export type AiRegistryTransaction = Pick<Database, "insert" | "select" | "update">;
export type AiRegistryDatabase = AiRegistryTransaction & Pick<Database, "transaction">;

function parseProvider(value: string): Provider {
  const provider = providers.find((candidate) => candidate === value);
  if (!provider) throw new Error(`Unsupported AI provider: ${value}`);
  return provider;
}

function serverConnections(config: AppConfig["ai"] = getAppConfig().ai): AiProviderConnection[] {
  if (config.openai.kind === "disabled") return [];
  return [
    {
      id: "server:openai",
      provider: "openai",
      source: "server",
      name: "openai server connection",
      credential: config.openai.apiKey,
    },
  ];
}

export function providerConnectionDto(
  connection: AiProviderConnection,
  enabled = true,
  models: readonly ConnectionModelDto[] = [],
): ProviderConnectionDto {
  return {
    id: connection.id,
    provider: connection.provider,
    name: connection.name,
    source: connection.source,
    baseUrl: connection.baseUrl ?? null,
    enabled,
    hasCredential: true,
    models,
  };
}

export async function listProviderConnections(
  userId: string,
  database: AiRegistryTransaction = db,
  aiConfig: AppConfig["ai"] = getAppConfig().ai,
): Promise<ProviderConnectionDto[]> {
  const [rows, modelRows] = await Promise.all([
    database
      .select({
        id: aiProviderConnections.id,
        provider: aiProviderConnections.provider,
        name: aiProviderConnections.name,
        baseUrl: aiProviderConnections.baseUrl,
        enabled: aiProviderConnections.enabled,
      })
      .from(aiProviderConnections)
      .where(eq(aiProviderConnections.userId, userId)),
    database
      .select({
        id: aiProviderModels.id,
        connectionId: aiProviderModels.connectionId,
        providerModelId: aiProviderModels.providerModelId,
        displayName: aiProviderModels.displayName,
        capabilities: aiProviderModels.capabilities,
        tasks: aiProviderModels.tasks,
      })
      .from(aiProviderModels)
      .where(and(eq(aiProviderModels.ownerUserId, userId), eq(aiProviderModels.enabled, true))),
  ]);
  const modelsByConnection = new Map<string, ConnectionModelDto[]>();
  for (const model of modelRows) {
    if (!model.connectionId) continue;
    const models = modelsByConnection.get(model.connectionId) ?? [];
    models.push({
      id: model.id,
      providerModelId: model.providerModelId,
      displayName: model.displayName,
      capabilities: model.capabilities,
      tasks: model.tasks,
    });
    modelsByConnection.set(model.connectionId, models);
  }
  return [
    ...rows.map((row) => ({
      id: row.id,
      provider: parseProvider(row.provider),
      name: row.name,
      source: "user" as const,
      baseUrl: row.baseUrl,
      enabled: row.enabled,
      hasCredential: true as const,
      models: modelsByConnection.get(row.id) ?? [],
    })),
    ...serverConnections(aiConfig).map((connection) => providerConnectionDto(connection)),
  ];
}

async function normalizeConnectionInput(
  input: UpdateProviderConnectionInput,
  requireCredential: boolean,
): Promise<UpdateProviderConnectionInput> {
  const credential = input.credential?.trim();
  if (requireCredential && !credential) throw new Error("AI provider credential is required");
  const name = input.name.trim();
  if (!name) throw new Error("AI provider connection name is required");
  if (input.provider === "openai-compatible") {
    if (!input.baseUrl) throw new Error("OpenAI-compatible connections require a base URL");
    if (!input.models?.length) {
      throw new Error("OpenAI-compatible connections require at least one model");
    }
    return {
      ...input,
      name,
      credential,
      baseUrl: await validateCustomProviderEndpoint(input.baseUrl),
    };
  }
  if (input.baseUrl) throw new Error("First-party AI connections cannot override their endpoint");
  if (input.models?.length)
    throw new Error("First-party AI connections use the server model catalog");
  return { ...input, name, credential, baseUrl: undefined, models: undefined };
}

async function synchronizeConnectionModels(
  database: AiRegistryTransaction,
  connectionId: string,
  userId: string,
  provider: Provider,
  models: readonly ConnectionModelInput[],
): Promise<void> {
  const modelIds = models.flatMap(({ id }) => (id ? [id] : []));
  if (new Set(modelIds).size !== modelIds.length) {
    throw new Error("AI connection contains duplicate model IDs");
  }
  const providerModelIds = models.map(({ providerModelId }) => providerModelId);
  if (new Set(providerModelIds).size !== providerModelIds.length) {
    throw new Error("AI connection contains duplicate provider model IDs");
  }

  const existing = await database
    .select()
    .from(aiProviderModels)
    .where(
      and(
        eq(aiProviderModels.connectionId, connectionId),
        eq(aiProviderModels.ownerUserId, userId),
      ),
    );
  const existingById = new Map(existing.map((model) => [model.id, model]));
  const existingByProviderModelId = new Map(
    existing.map((model) => [model.providerModelId, model]),
  );
  const retainedIds = new Set<string>();

  for (const model of models) {
    const matched = model.id
      ? existingById.get(model.id)
      : existingByProviderModelId.get(model.providerModelId);
    if (model.id && !matched) {
      throw new Error(`AI model ${model.id} does not belong to this connection`);
    }
    const id = matched?.id ?? randomUUID();
    if (retainedIds.has(id)) {
      throw new Error(`AI model ${id} is listed more than once`);
    }
    retainedIds.add(id);
    const values = {
      provider,
      providerModelId: model.providerModelId,
      connectionId,
      ownerUserId: userId,
      displayName: model.displayName,
      capabilities: model.capabilities,
      tasks: [...model.tasks],
      enabled: true,
      updatedAt: new Date(),
    };
    if (matched) {
      await database.update(aiProviderModels).set(values).where(eq(aiProviderModels.id, id));
    } else {
      await database.insert(aiProviderModels).values({ id, ...values });
    }
  }

  for (const model of existing) {
    if (retainedIds.has(model.id) || !model.enabled) continue;
    await database
      .update(aiProviderModels)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(aiProviderModels.id, model.id));
  }
}

export async function createProviderConnection(
  userId: string,
  rawInput: CreateProviderConnectionInput,
  database: AiRegistryDatabase = db,
  aiConfig: AppConfig["ai"] = getAppConfig().ai,
): Promise<ProviderConnectionDto> {
  const input = await normalizeConnectionInput(rawInput, true);
  if (!input.credential) throw new Error("AI provider credential is required");
  const encrypted = encryptCredential(
    input.credential,
    { userId, provider: input.provider },
    aiConfig.credentialEncryption,
  );
  return database.transaction(async (transaction) => {
    const [row] = await transaction
      .insert(aiProviderConnections)
      .values({
        userId,
        provider: input.provider,
        name: input.name,
        baseUrl: input.baseUrl,
        enabled: input.enabled ?? true,
        ...encrypted,
      })
      .returning({
        id: aiProviderConnections.id,
        provider: aiProviderConnections.provider,
        name: aiProviderConnections.name,
        baseUrl: aiProviderConnections.baseUrl,
        enabled: aiProviderConnections.enabled,
      });
    if (!row) throw new Error("Failed to create AI provider connection");
    await synchronizeConnectionModels(
      transaction,
      row.id,
      userId,
      input.provider,
      input.models ?? [],
    );
    return {
      id: row.id,
      provider: parseProvider(row.provider),
      name: row.name,
      source: "user",
      baseUrl: row.baseUrl,
      enabled: row.enabled,
      hasCredential: true,
      models: [],
    };
  });
}

export async function updateProviderConnection(
  userId: string,
  connectionId: string,
  rawInput: UpdateProviderConnectionInput,
  database: AiRegistryDatabase = db,
  aiConfig: AppConfig["ai"] = getAppConfig().ai,
): Promise<ProviderConnectionDto | null> {
  const input = await normalizeConnectionInput(rawInput, false);
  return database.transaction(async (transaction) => {
    const [existing] = await transaction
      .select()
      .from(aiProviderConnections)
      .where(
        and(eq(aiProviderConnections.id, connectionId), eq(aiProviderConnections.userId, userId)),
      )
      .limit(1);
    if (!existing) return null;
    if (!input.credential && input.provider !== parseProvider(existing.provider)) {
      throw new Error("Changing providers requires a new credential");
    }
    const encrypted = input.credential
      ? encryptCredential(
          input.credential,
          { userId, provider: input.provider },
          aiConfig.credentialEncryption,
        )
      : {};
    const [row] = await transaction
      .update(aiProviderConnections)
      .set({
        provider: input.provider,
        name: input.name,
        baseUrl: input.baseUrl,
        enabled: input.enabled ?? true,
        ...encrypted,
        updatedAt: new Date(),
      })
      .where(
        and(eq(aiProviderConnections.id, connectionId), eq(aiProviderConnections.userId, userId)),
      )
      .returning({
        id: aiProviderConnections.id,
        provider: aiProviderConnections.provider,
        name: aiProviderConnections.name,
        baseUrl: aiProviderConnections.baseUrl,
        enabled: aiProviderConnections.enabled,
      });
    if (!row) return null;
    await synchronizeConnectionModels(
      transaction,
      row.id,
      userId,
      input.provider,
      input.models ?? [],
    );
    return {
      id: row.id,
      provider: parseProvider(row.provider),
      name: row.name,
      source: "user",
      baseUrl: row.baseUrl,
      enabled: row.enabled,
      hasCredential: true,
      models: [],
    };
  });
}

export async function deleteProviderConnection(
  userId: string,
  connectionId: string,
): Promise<boolean> {
  await db
    .delete(userAiPreferences)
    .where(
      and(eq(userAiPreferences.userId, userId), eq(userAiPreferences.connectionId, connectionId)),
    );
  const rows = await db
    .delete(aiProviderConnections)
    .where(
      and(eq(aiProviderConnections.id, connectionId), eq(aiProviderConnections.userId, userId)),
    )
    .returning({ id: aiProviderConnections.id });
  return rows.length > 0;
}

export async function getUserAiRuntime(
  userId: string,
  database: AiRegistryTransaction = db,
  aiConfig: AppConfig["ai"] = getAppConfig().ai,
): Promise<AiRuntimeContext> {
  const rows = await database
    .select()
    .from(aiProviderConnections)
    .where(and(eq(aiProviderConnections.userId, userId), eq(aiProviderConnections.enabled, true)));
  const encryption = aiConfig.credentialEncryption;
  const connections: AiProviderConnection[] = [];
  for (const row of rows) {
    const provider = parseProvider(row.provider);
    const encrypted: EncryptedCredential = {
      credentialVersion: row.credentialVersion,
      credentialKeyId: row.credentialKeyId,
      encryptedCredential: row.encryptedCredential,
      iv: row.iv,
      authTag: row.authTag,
    };
    const decrypted = decryptCredential(encrypted, { userId, provider }, encryption);
    connections.push({
      id: row.id,
      provider,
      source: "user",
      name: row.name,
      credential: decrypted.plaintext,
      baseUrl: row.baseUrl ?? undefined,
    });
    if (decrypted.needsRotation) {
      await database
        .update(aiProviderConnections)
        .set({
          ...encryptCredential(decrypted.plaintext, { userId, provider }, encryption),
          updatedAt: new Date(),
        })
        .where(eq(aiProviderConnections.id, row.id));
    }
  }

  const modelRows = await database
    .select()
    .from(aiProviderModels)
    .where(
      and(
        eq(aiProviderModels.enabled, true),
        or(isNull(aiProviderModels.ownerUserId), eq(aiProviderModels.ownerUserId, userId)),
      ),
    );
  const preferences = await getAiPreferences(userId, database);
  return {
    connections: [...connections, ...serverConnections(aiConfig)],
    models: modelRows.map((model): AiModelRecord => ({
      id: model.id,
      provider: parseProvider(model.provider),
      providerModelId: model.providerModelId,
      displayName: model.displayName,
      capabilities: model.capabilities,
      tasks: model.tasks,
      connectionId: model.connectionId ?? undefined,
    })),
    preferences,
  };
}

export async function listAvailableModels(
  userId: string,
  database: AiRegistryTransaction = db,
  aiConfig: AppConfig["ai"] = getAppConfig().ai,
): Promise<AiModelTargetDto[]> {
  const runtime = await getUserAiRuntime(userId, database, aiConfig);
  return runtime.models.flatMap((model) =>
    runtime.connections
      .filter(
        (connection) =>
          connection.provider === model.provider &&
          (!model.connectionId || model.connectionId === connection.id),
      )
      .map((connection): AiModelTargetDto => ({
        ...model,
        connectionId: connection.id,
        connectionName: connection.name,
        connectionSource: connection.source,
      })),
  );
}

export async function getAiPreferences(
  userId: string,
  database: Pick<Database, "select"> = db,
): Promise<Partial<Record<AiTask, AiTarget>>> {
  const rows = await database
    .select({
      task: userAiPreferences.task,
      connectionId: userAiPreferences.connectionId,
      modelId: userAiPreferences.modelId,
    })
    .from(userAiPreferences)
    .where(eq(userAiPreferences.userId, userId));
  return Object.fromEntries(
    rows.map(({ task, connectionId, modelId }) => [task, { connectionId, modelId }]),
  );
}

export async function setAiPreference(
  userId: string,
  task: AiTask,
  target: AiTarget,
): Promise<void> {
  const models = await listAvailableModels(userId);
  const model = models.find(
    ({ id, connectionId }) => id === target.modelId && connectionId === target.connectionId,
  );
  if (!model || !model.tasks.includes(task)) {
    throw new Error(`Model ${target.modelId} is not available for the ${task} task`);
  }
  await db
    .insert(userAiPreferences)
    .values({ userId, task, connectionId: target.connectionId, modelId: target.modelId })
    .onConflictDoUpdate({
      target: [userAiPreferences.userId, userAiPreferences.task],
      set: {
        connectionId: target.connectionId,
        modelId: target.modelId,
        updatedAt: new Date(),
      },
    });
}
