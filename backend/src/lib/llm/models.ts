import type { AiModelRecord, AiRuntimeContext, AiTask, Provider } from "./types.js";

export const DEFAULT_MAIN_MODEL = "gemini-3.1-pro-preview";
export const DEFAULT_TITLE_MODEL = "gemini-3.1-pro-preview";
export const DEFAULT_TABULAR_MODEL = "gemini-3.1-pro-preview";

export const AI_MODEL_CATALOG = [
  {
    id: "claude-opus-4-7",
    provider: "anthropic",
    providerModelId: "claude-opus-4-7",
    displayName: "Claude Opus 4.7",
    capabilities: {
      input: { text: true, image: true, pdf: false },
      output: { text: true, structured: true, toolCalls: true },
    },
    tasks: ["main"],
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    providerModelId: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    capabilities: {
      input: { text: true, image: true, pdf: false },
      output: { text: true, structured: true, toolCalls: true },
    },
    tasks: ["main", "title", "tabular"],
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    providerModelId: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    capabilities: {
      input: { text: true, image: true, pdf: false },
      output: { text: true, structured: true, toolCalls: true },
    },
    tasks: ["title"],
  },
  {
    id: "gemini-3.1-pro-preview",
    provider: "google",
    providerModelId: "gemini-3.1-pro-preview",
    displayName: "Gemini 3.1 Pro Preview",
    capabilities: {
      input: { text: true, image: true, pdf: true },
      output: { text: true, structured: true, toolCalls: true },
    },
    tasks: ["main", "title", "tabular"],
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    provider: "google",
    providerModelId: "gemini-3.1-flash-lite-preview",
    displayName: "Gemini 3.1 Flash Lite Preview",
    capabilities: {
      input: { text: true, image: true, pdf: true },
      output: { text: true, structured: true, toolCalls: true },
    },
    tasks: ["title"],
  },
  {
    id: "gpt-5.5",
    provider: "openai",
    providerModelId: "gpt-5.5",
    displayName: "GPT 5.5",
    capabilities: {
      input: { text: true, image: true, pdf: false },
      output: { text: true, structured: true, toolCalls: true },
    },
    tasks: ["main"],
  },
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    providerModelId: "gpt-5.4-mini",
    displayName: "GPT 5.4 Mini",
    capabilities: {
      input: { text: true, image: true, pdf: false },
      output: { text: true, structured: true, toolCalls: true },
    },
    tasks: ["main", "title", "tabular"],
  },
  {
    id: "gpt-5.4-nano",
    provider: "openai",
    providerModelId: "gpt-5.4-nano",
    displayName: "GPT 5.4 Nano",
    capabilities: {
      input: { text: true, image: true, pdf: false },
      output: { text: true, structured: true, toolCalls: true },
    },
    tasks: ["title"],
  },
] as const satisfies readonly AiModelRecord[];

const MODEL_REGISTRY = new Map<string, AiModelRecord>(
  AI_MODEL_CATALOG.map((model) => [model.id, model]),
);

export function modelForId(modelId: string, runtime?: AiRuntimeContext): AiModelRecord {
  const model = runtime?.models.find(({ id }) => id === modelId) ?? MODEL_REGISTRY.get(modelId);
  if (!model) throw new Error(`Unknown model id: ${modelId}`);
  return model;
}

export function providerForModel(modelId: string): Provider {
  return modelForId(modelId).provider;
}

export function resolveModel(
  id: string | null | undefined,
  fallback: string,
  runtime?: AiRuntimeContext,
): string {
  if (id && (MODEL_REGISTRY.has(id) || runtime?.models.some((model) => model.id === id))) return id;
  return fallback;
}

export function assertModelSupports(
  model: AiModelRecord,
  request: Readonly<{ task?: AiTask; tools?: boolean; inlineFileMimeType?: string }>,
): void {
  if (!model.capabilities.input.text || !model.capabilities.output.text) {
    throw new Error(`Model ${model.id} does not support text generation`);
  }
  if (request.task && !model.tasks.includes(request.task)) {
    throw new Error(`Model ${model.id} does not support the ${request.task} task`);
  }
  if (request.tools && !model.capabilities.output.toolCalls) {
    throw new Error(`Model ${model.id} does not support tool calls`);
  }
  if (request.inlineFileMimeType === "application/pdf" && !model.capabilities.input.pdf) {
    throw new Error(`Model ${model.id} does not support PDF input`);
  }
  if (request.inlineFileMimeType?.startsWith("image/") && !model.capabilities.input.image) {
    throw new Error(`Model ${model.id} does not support image input`);
  }
}

export function resolveDefaultMainModel(runtime?: AiRuntimeContext): string {
  const providers = new Set(runtime?.connections.map(({ provider }) => provider));
  const preference = runtime?.preferences?.main;
  if (preference) {
    const model =
      runtime?.models.find(({ id }) => id === preference.modelId) ??
      MODEL_REGISTRY.get(preference.modelId);
    const connection = runtime?.connections.find(({ id }) => id === preference.connectionId);
    const connectionAvailable = Boolean(
      connection &&
      connection.provider === model?.provider &&
      (!model?.connectionId || model.connectionId === connection.id),
    );
    if (model?.tasks.includes("main") && connectionAvailable) return model.id;
  }
  if (providers.has("google")) return DEFAULT_MAIN_MODEL;
  if (providers.has("anthropic")) return "claude-sonnet-4-6";
  if (providers.has("openai")) return "gpt-5.4-mini";
  const custom = runtime?.models.find(
    (model) => model.tasks.includes("main") && providers.has(model.provider),
  );
  if (custom) return custom.id;
  return DEFAULT_MAIN_MODEL;
}
