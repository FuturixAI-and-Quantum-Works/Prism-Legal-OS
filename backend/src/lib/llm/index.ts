import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type { GoogleLanguageModelOptions } from "@ai-sdk/google";
import type { OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import { dynamicTool, generateText, jsonSchema, stepCountIs, streamText } from "ai";
import { assertModelSupports } from "./models.js";
import { resolveAiModel } from "./providerRegistry.js";
import type {
  AiRuntimeContext,
  NormalizedToolCall,
  OpenAIToolSchema,
  StreamChatParams,
  StreamChatResult,
} from "./types.js";

export * from "./types.js";
export * from "./models.js";

const AI_REQUEST_TIMEOUT_MS = 60_000;

function preferredConnectionId(
  modelId: string,
  task: StreamChatParams["task"],
  runtime: AiRuntimeContext | undefined,
  explicitConnectionId: string | undefined,
): string | undefined {
  if (explicitConnectionId) return explicitConnectionId;
  const preference = task ? runtime?.preferences?.[task] : undefined;
  return preference?.modelId === modelId ? preference.connectionId : undefined;
}

function recordInput(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : {};
}

function aiTools(params: StreamChatParams) {
  const started = new Set<string>();
  let pending: Array<{
    call: NormalizedToolCall;
    resolve: (content: string) => void;
    reject: (error: unknown) => void;
  }> = [];
  let scheduled = false;
  const execute = (call: NormalizedToolCall): Promise<string> =>
    new Promise((resolve, reject) => {
      pending.push({ call, resolve, reject });
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(async () => {
        const batch = pending;
        pending = [];
        scheduled = false;
        try {
          const results = params.runTools
            ? await params.runTools(batch.map(({ call }) => call))
            : [];
          for (const item of batch) {
            item.resolve(
              results.find(({ tool_use_id }) => tool_use_id === item.call.id)?.content ?? "",
            );
          }
        } catch (error) {
          for (const item of batch) item.reject(error);
        }
      });
    });
  return Object.fromEntries(
    (params.tools ?? []).map((definition: OpenAIToolSchema) => [
      definition.function.name,
      dynamicTool({
        description: definition.function.description,
        inputSchema: jsonSchema<Record<string, unknown>>(definition.function.parameters),
        onInputAvailable({ toolCallId, input }) {
          const call: NormalizedToolCall = {
            id: toolCallId,
            name: definition.function.name,
            input: recordInput(input),
          };
          started.add(toolCallId);
          params.callbacks?.onToolCallStart?.(call);
        },
        async execute(input, { toolCallId }) {
          const call: NormalizedToolCall = {
            id: toolCallId,
            name: definition.function.name,
            input: recordInput(input),
          };
          if (!started.has(toolCallId)) params.callbacks?.onToolCallStart?.(call);
          return execute(call);
        },
      }),
    ]),
  );
}

function reasoningProviderOptions(enabled: boolean | undefined) {
  if (!enabled) return undefined;
  return {
    anthropic: {
      thinking: { type: "adaptive" },
    } satisfies AnthropicLanguageModelOptions,
    google: {
      thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
    } satisfies GoogleLanguageModelOptions,
    openai: {
      reasoningEffort: "high",
      reasoningSummary: "auto",
    } satisfies OpenAILanguageModelResponsesOptions,
  };
}

export async function streamChatWithTools(params: StreamChatParams): Promise<StreamChatResult> {
  const resolved = resolveAiModel(
    params.model,
    params.runtime,
    preferredConnectionId(params.model, params.task, params.runtime, params.connectionId),
  );
  assertModelSupports(resolved.record, {
    task: params.task,
    tools: Boolean(params.tools?.length),
  });
  let fullText = "";
  let streamError: unknown;
  const result = streamText({
    model: resolved.languageModel,
    system: params.systemPrompt,
    messages: params.messages,
    tools: aiTools(params),
    stopWhen: stepCountIs(params.maxIterations ?? 10),
    timeout: AI_REQUEST_TIMEOUT_MS,
    abortSignal: params.signal,
    providerOptions: reasoningProviderOptions(params.enableThinking),
    onChunk({ chunk }) {
      if (chunk.type === "text-delta") {
        fullText += chunk.text;
        params.callbacks?.onContentDelta?.(chunk.text);
      } else if (chunk.type === "reasoning-delta" && params.enableThinking) {
        params.callbacks?.onReasoningDelta?.(chunk.text);
      } else if (chunk.type === "reasoning-end" && params.enableThinking) {
        params.callbacks?.onReasoningBlockEnd?.();
      }
    },
  });
  await result.consumeStream({
    onError(error) {
      streamError = error;
    },
  });
  if (streamError) throw streamError;
  return { fullText };
}

export async function completeText(params: {
  model: string;
  systemPrompt?: string;
  user: string;
  maxTokens?: number;
  runtime?: AiRuntimeContext;
  connectionId?: string;
  task?: "main" | "title" | "tabular";
  signal?: AbortSignal;
}): Promise<string> {
  const resolved = resolveAiModel(
    params.model,
    params.runtime,
    preferredConnectionId(params.model, params.task, params.runtime, params.connectionId),
  );
  assertModelSupports(resolved.record, { task: params.task });
  const result = await generateText({
    model: resolved.languageModel,
    system: params.systemPrompt,
    prompt: params.user,
    maxOutputTokens: params.maxTokens ?? 512,
    timeout: AI_REQUEST_TIMEOUT_MS,
    abortSignal: params.signal,
  });
  return result.text;
}

export async function completeTextWithInlineFile(params: {
  model: string;
  systemPrompt?: string;
  user: string;
  file: {
    data: ArrayBuffer | Uint8Array | Buffer;
    mimeType: string;
    filename?: string;
  };
  maxTokens?: number;
  runtime?: AiRuntimeContext;
  connectionId?: string;
  task?: "main" | "title" | "tabular";
  signal?: AbortSignal;
}): Promise<string> {
  const resolved = resolveAiModel(
    params.model,
    params.runtime,
    preferredConnectionId(params.model, params.task, params.runtime, params.connectionId),
  );
  assertModelSupports(resolved.record, {
    task: params.task,
    inlineFileMimeType: params.file.mimeType,
  });
  const bytes = new Uint8Array(params.file.data);
  const result = await generateText({
    model: resolved.languageModel,
    system: params.systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: params.user },
          {
            type: "file",
            data: bytes,
            mediaType: params.file.mimeType,
            filename: params.file.filename,
          },
        ],
      },
    ],
    maxOutputTokens: params.maxTokens ?? 2048,
    timeout: AI_REQUEST_TIMEOUT_MS,
    abortSignal: params.signal,
  });
  return result.text;
}
