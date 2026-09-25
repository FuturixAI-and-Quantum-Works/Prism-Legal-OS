import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { MissingLlmApiKeyError } from "./errors.js";
import { createSafeProviderFetch } from "./safeProviderFetch.js";
import type { AiModelRecord, AiProviderConnection, AiRuntimeContext } from "./types.js";

export type ResolvedAiModel = Readonly<{
  connection: AiProviderConnection;
  record: AiModelRecord;
  languageModel: LanguageModel;
}>;

function connectionForModel(
  record: AiModelRecord,
  runtime: AiRuntimeContext,
  connectionId?: string,
): AiProviderConnection {
  const connection = connectionId
    ? runtime.connections.find(({ id }) => id === connectionId)
    : record.connectionId
      ? runtime.connections.find(({ id }) => id === record.connectionId)
      : (runtime.connections.find(
          ({ provider, source }) => provider === record.provider && source === "user",
        ) ?? runtime.connections.find(({ provider }) => provider === record.provider));
  if (!connection) {
    throw new MissingLlmApiKeyError();
  }
  if (
    connection.provider !== record.provider ||
    (record.connectionId && record.connectionId !== connection.id)
  ) {
    throw new Error(`Connection ${connection.id} cannot serve model ${record.id}`);
  }
  return connection;
}

function createLanguageModel(
  connection: AiProviderConnection,
  record: AiModelRecord,
): LanguageModel {
  switch (connection.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: connection.credential })(record.providerModelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey: connection.credential })(record.providerModelId);
    case "openai":
      return createOpenAI({ apiKey: connection.credential })(record.providerModelId);
    case "openai-compatible": {
      if (!connection.baseUrl) {
        throw new Error("OpenAI-compatible connection is missing its base URL");
      }
      const provider = createOpenAICompatible({
        name: `custom-${connection.id}`,
        apiKey: connection.credential,
        baseURL: connection.baseUrl,
        fetch: createSafeProviderFetch(),
      });
      return provider(record.providerModelId);
    }
  }
}

export function resolveAiModel(
  modelId: string,
  runtime: AiRuntimeContext | undefined,
  connectionId?: string,
): ResolvedAiModel {
  if (!runtime) throw new MissingLlmApiKeyError();
  const record = runtime.models.find(({ id }) => id === modelId);
  if (!record) throw new Error(`Unknown model id: ${modelId}`);
  const connection = connectionForModel(record, runtime, connectionId);
  return {
    connection,
    record,
    languageModel: createLanguageModel(connection, record),
  };
}
