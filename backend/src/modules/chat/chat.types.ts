import type { assertDocumentActionAllowed } from "../documents/documents.permissions.service.js";
import type { AiRuntimeContext } from "../../lib/llm/types.js";
import type { SSEWriter } from "../../lib/sseHelpers.js";
import type { TemplateRecord } from "../../lib/templateDocuments.js";
import type { InterviewState } from "../../lib/templateInterview.js";
import type { DocIndex, DocStore, WorkflowStore } from "../ai/tools/runtimeTypes.js";
import type { RetrievalScope } from "../retrieval/retrieval.types.js";

export type ChatMessage = {
  role: string;
  content: string | null;
  files?: { filename: string; document_id?: string }[];
  workflow?: { id: string; title: string };
};

export type ChatScope =
  | { type: "personal"; projectId?: null; workspaceId?: null }
  | { type: "project"; projectId: string; workspaceId?: null }
  | { type: "workspace"; workspaceId: string; projectId?: null };

export type ChatRouteMode = "general" | "project" | "workspace";

export type ChatActor = Readonly<{
  userId: string;
  userEmail?: string | null;
}>;

export type ChatItem = Readonly<{
  filename: string;
  id: string;
}>;

export type OrchestratorRequest = ChatActor & {
  scope: ChatScope;
  routeMode: ChatRouteMode;
  messages: ChatMessage[];
  chatId?: string | null;
  sessionId?: string | null;
  projectIdProvided?: boolean;
  workspaceIdProvided?: boolean;
  model?: string;
  displayedItem?: ChatItem | null;
  attachedItems?: ChatItem[];
};

export type EphemeralRequest = Readonly<{
  userId: string;
  messages: ChatMessage[];
  model?: string;
}>;

export type ChatError = { kind: "error"; status: number; detail: string };

export type EphemeralResult =
  | ChatError
  | {
      kind: "stream";
      stream: (writer: SSEWriter, signal: AbortSignal) => Promise<void>;
    };

export type OrchestratorResult =
  | ChatError
  | {
      kind: "stream";
      chatId: string;
      stream: (writer: SSEWriter, signal: AbortSignal) => Promise<void>;
    };

export type ChatSession = Readonly<{
  chatId: string;
  chatTitle: string | null;
  projectId: string | null;
  workspaceId: string | null;
}>;

export type AccessibleChat = Readonly<{
  id: string;
  title: string | null;
  userId: string;
  projectId: string | null;
  workspaceId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}>;

export type ActiveDocumentContext = Awaited<ReturnType<typeof assertDocumentActionAllowed>>;

export type RagCollectionSummary = Readonly<{
  id: string;
  collectionName: string;
  displayName: string | null;
}>;

export type AssembledChatContext = Readonly<{
  req: OrchestratorRequest;
  session: ChatSession;
  lastUser: ChatMessage | undefined;
  activeDocumentContexts: readonly ActiveDocumentContext[];
  docIndex: DocIndex;
  docStore: DocStore;
  folderPaths: Map<string, string>;
  templates: TemplateRecord[];
  workflowStore: WorkflowStore;
  ragScope: RetrievalScope;
  ragCollection: RagCollectionSummary | null;
  ragStatus: { indexedSourceCount: number };
  interviewState: InterviewState | null;
  aiRuntime: AiRuntimeContext;
  baseSystemPromptExtra: string;
}>;

export type ChatIntent =
  | { type: "generate_document" }
  | { type: "fill_template_field" }
  | { type: "project_workspace" }
  | { type: "search_question" }
  | { type: "document_edit" }
  | { type: "general_chat" };

export type HandlerOutcome = Readonly<{
  fullText: string;
  events: unknown[];
  annotations?: unknown[];
}>;
