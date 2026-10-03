import type { CitationBlockResult, StreamEventWriter } from "@prism/protocol";
import {
  resolveDefaultMainModel,
  resolveModel,
  streamChatWithTools,
  type AiRuntimeContext,
  type AiTask,
  type LlmMessage,
} from "../../../lib/llm/index.js";
import { CITATIONS_OPEN_TAG, parseDocumentCitationAnnotations } from "../citations/citations.js";
import { getAiToolSchemas, toolRegistry } from "./registry.js";
import { createEmptyTabularCellStore, type TabularCellStore } from "./tabularExecutors.js";
import { createToolExecutionEvents, type ToolExecutionContext, type ToolScope } from "./types.js";
import type { TurnEditState } from "./turnState.js";
import type {
  AssistantEvent,
  ChatMessage,
  DocIndex,
  DocStore,
  WorkflowStore,
} from "./runtimeTypes.js";
import type { DocumentCreator } from "../../documents/documents.service.js";

export type RuntimeCitationParser = (text: string) => CitationBlockResult<unknown>;

export async function runLLMStream(params: {
  apiMessages: readonly Pick<ChatMessage, "role" | "content">[];
  docStore: DocStore;
  docIndex: DocIndex;
  userId: string;
  userEmail?: string | null;
  write: StreamEventWriter;
  signal: AbortSignal;
  documentCreator: DocumentCreator;
  scope?: ToolScope;
  workflowStore?: WorkflowStore;
  tabularStore?: TabularCellStore;
  citationParser?: RuntimeCitationParser;
  model?: string;
  runtime?: AiRuntimeContext;
  task?: AiTask;
  chatId?: string | null;
}): Promise<{ fullText: string; events: AssistantEvent[] }> {
  const {
    apiMessages,
    docStore,
    docIndex,
    userId,
    userEmail,
    write,
    scope = { kind: "personal" },
    workflowStore,
    tabularStore,
    citationParser,
    model,
    runtime,
    task = "main",
    chatId,
    signal,
    documentCreator,
  } = params;
  const activeTools = getAiToolSchemas(scope.kind);
  const systemPrompt = apiMessages[0]?.role === "system" ? (apiMessages[0].content ?? "") : "";
  const messages: LlmMessage[] = apiMessages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content ?? "",
    }));
  const events: AssistantEvent[] = [];
  const turnEditState: TurnEditState = new Map();
  const parseCitationsForTurn =
    citationParser ?? ((text: string) => parseDocumentCitationAnnotations(text, docIndex));
  let fullText = "";
  let iterationText = "";
  let visibleText = "";
  let reasoning = "";
  let visibleTail = "";
  let citationsOpenSeen = false;

  const streamVisibleContent = (delta: string) => {
    if (!delta || citationsOpenSeen) return;
    const combined = visibleTail + delta;
    const markerIndex = combined.indexOf(CITATIONS_OPEN_TAG);
    if (markerIndex >= 0) {
      const visible = combined.slice(0, markerIndex);
      if (visible) {
        visibleText += visible;
        write({ type: "content_delta", text: visible });
      }
      visibleTail = "";
      citationsOpenSeen = true;
      return;
    }
    const keep = Math.min(CITATIONS_OPEN_TAG.length - 1, combined.length);
    const visible = combined.slice(0, combined.length - keep);
    visibleTail = combined.slice(combined.length - keep);
    if (visible) {
      visibleText += visible;
      write({ type: "content_delta", text: visible });
    }
  };
  const flushText = (finalize = false) => {
    if (!iterationText) return;
    const citationResult = parseCitationsForTurn(iterationText);
    if (!finalize && citationResult.status === "incomplete") {
      fullText += iterationText.slice(0, citationResult.blockStart);
      if (visibleText) events.push({ type: "content", text: visibleText });
      iterationText = iterationText.slice(citationResult.blockStart);
      visibleText = "";
      visibleTail = "";
      citationsOpenSeen = true;
      return;
    }
    fullText += iterationText;
    const remainingVisible = citationResult.visibleText.slice(visibleText.length);
    if (remainingVisible) {
      visibleText += remainingVisible;
      write({ type: "content_delta", text: remainingVisible });
    }
    if (visibleText) events.push({ type: "content", text: visibleText });
    iterationText = "";
    visibleText = "";
    visibleTail = "";
    citationsOpenSeen = false;
  };

  await streamChatWithTools({
    model: resolveModel(model, resolveDefaultMainModel(runtime), runtime),
    systemPrompt,
    messages,
    tools: activeTools,
    maxIterations: 10,
    runtime,
    task,
    enableThinking: true,
    signal,
    callbacks: {
      onContentDelta: (delta) => {
        iterationText += delta;
        streamVisibleContent(delta);
      },
      onReasoningDelta: (delta) => {
        reasoning += delta;
        write({ type: "reasoning_delta", text: delta });
      },
      onReasoningBlockEnd: () => {
        if (!reasoning) return;
        events.push({ type: "reasoning", text: reasoning });
        write({ type: "reasoning_block_end" });
        reasoning = "";
      },
    },
    runTools: async (calls) => {
      flushText();
      const toolEvents = createToolExecutionEvents();
      const baseContext: Omit<ToolExecutionContext, "callId"> = {
        user: { id: userId, email: userEmail ?? null },
        scope,
        chatId: chatId ?? null,
        write,
        signal,
        documentCreator,
        documents: { store: docStore, index: docIndex, turnEdits: turnEditState },
        workflows: workflowStore ?? new Map(),
        tabular: tabularStore ?? createEmptyTabularCellStore(),
        events: toolEvents,
      };
      const results = [];
      for (const call of calls) {
        results.push(
          await toolRegistry.execute(
            { ...baseContext, callId: call.id },
            { id: call.id, name: call.name, input: call.input },
          ),
        );
      }
      for (const result of toolEvents.docsRead) {
        events.push({
          type: "doc_read",
          filename: result.filename,
          document_id: result.document_id,
        });
      }
      for (const result of toolEvents.docReadFailures) {
        events.push({ type: "doc_read_failed", ...result });
      }
      for (const result of toolEvents.docsFound) {
        events.push({
          type: "doc_find",
          filename: result.filename,
          query: result.query,
          total_matches: result.total_matches,
        });
      }
      for (const result of toolEvents.docsCreated) {
        events.push({
          type: "doc_created",
          filename: result.filename,
          download_url: result.download_url,
          document_id: result.document_id,
          version_id: result.version_id,
          version_number: result.version_number ?? null,
        });
      }
      for (const result of toolEvents.docsReplicated) {
        events.push({
          type: "doc_replicated",
          filename: result.filename,
          count: result.count,
          copies: result.copies,
        });
      }
      for (const result of toolEvents.workflowsApplied) {
        events.push({
          type: "workflow_applied",
          workflow_id: result.workflow_id,
          title: result.title,
        });
      }
      for (const result of toolEvents.docsEdited) {
        events.push({
          type: "doc_edited",
          filename: result.filename,
          document_id: result.document_id,
          version_id: result.version_id,
          version_number: result.version_number,
          download_url: result.download_url,
          annotations: result.annotations,
        });
      }
      return results.map((result) => ({
        tool_use_id: result.tool_call_id,
        content: result.content,
      }));
    },
  });
  flushText(true);

  const citationResult = parseCitationsForTurn(fullText);
  const citations = citationResult.status === "valid" ? [...citationResult.citations] : [];
  write({ type: "citations", citations });
  return { fullText, events };
}
