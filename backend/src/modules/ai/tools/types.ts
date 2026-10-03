import type { StreamEventWriter } from "@prism/protocol";
import type {
  DocCreatedResult,
  DocEditedResult,
  DocIndex,
  DocReadFailure,
  DocReplicatedResult,
  DocStore,
  WorkflowStore,
} from "./runtimeTypes.js";
import type { TabularCellStore } from "./tabularExecutors.js";
import type { TurnEditState } from "./turnState.js";
import type { DocumentCreator } from "../../documents/documents.service.js";

export type ToolScope =
  | { kind: "personal" }
  | { kind: "project"; projectId: string }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "tabular"; projectId: string | null };

export type ToolExecutionEvents = {
  toolResults: ToolMessage[];
  docsRead: { filename: string; document_id?: string }[];
  docReadFailures: DocReadFailure[];
  docsFound: { filename: string; query: string; total_matches: number }[];
  docsCreated: DocCreatedResult[];
  docsReplicated: DocReplicatedResult[];
  workflowsApplied: { workflow_id: string; title: string }[];
  docsEdited: DocEditedResult[];
};

export type ToolExecutionContext = {
  readonly callId: string;
  readonly user: { id: string; email: string | null };
  readonly scope: ToolScope;
  readonly chatId: string | null;
  readonly write: StreamEventWriter;
  readonly signal: AbortSignal;
  readonly documentCreator: DocumentCreator;
  readonly documents: { store: DocStore; index: DocIndex; turnEdits: TurnEditState };
  readonly workflows: WorkflowStore;
  readonly tabular: TabularCellStore;
  readonly events: ToolExecutionEvents;
};

export type ToolAuthorizationPolicy<Input> =
  | Readonly<{ kind: "unrestricted" }>
  | Readonly<{
      kind: "checked";
      authorize: (context: ToolExecutionContext, input: Input) => void | Promise<void>;
    }>;

export type ToolDefinition<Input, Output> = {
  name: string;
  description: string;
  inputSchema: { parse: (input: unknown) => Input };
  scopes: readonly ToolScope["kind"][];
  authorization: ToolAuthorizationPolicy<Input>;
  execute: (context: ToolExecutionContext, input: Input) => Output | Promise<Output>;
};

export type ToolExecutorResult = {
  output: unknown;
  content?: string;
  status?: "complete" | "error";
};

export type ToolMessage = {
  role: "tool";
  tool_call_id: string;
  content: string;
};

export function createToolExecutionEvents(): ToolExecutionEvents {
  return {
    toolResults: [],
    docsRead: [],
    docReadFailures: [],
    docsFound: [],
    docsCreated: [],
    docsReplicated: [],
    workflowsApplied: [],
    docsEdited: [],
  };
}
