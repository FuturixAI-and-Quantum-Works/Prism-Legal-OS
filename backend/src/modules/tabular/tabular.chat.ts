import { z } from "zod";
import {
  parseCitationBlock,
  type CitationBlockResult,
  type StreamDataEvent,
} from "@prism/protocol";
import { runLLMStream } from "../ai/tools/runtimeCoordinator.js";
import type { ChatMessage } from "../ai/tools/runtimeTypes.js";
import type { TabularCellStore } from "../ai/tools/tabularExecutors.js";
import { completeText, type AiRuntimeContext } from "../../lib/llm/index.js";
import { getUserAiRuntime } from "../../lib/aiRegistry.js";
import { getUserModelSettings } from "../../lib/userSettings.js";
import { lunaPrompt } from "../../lib/prompts/luna.js";
import { parseCellContent, type TabularCellRepository } from "./tabular.cell.repository.js";
import type { TabularChatRepository } from "./tabular.chat.repository.js";
import type { TabularReviewRepository } from "./tabular.review.repository.js";
import type { TabularActor, TabularReview } from "./tabular.types.js";
import type { DocumentCreator } from "../documents/documents.service.js";

const citationSchema = z.strictObject({
  ref: z.number().int().positive(),
  col_index: z.number().int().nonnegative(),
  row_index: z.number().int().nonnegative(),
  quote: z.string().refine((quote) => quote.trim().length > 0),
});

type TabularCitation = z.infer<typeof citationSchema>;
type TabularCitationAnnotation = TabularCitation &
  (
    | {
        type: "tabular_citation";
        resolution: "resolved";
        col_name: string;
        doc_name: string;
      }
    | {
        type: "tabular_citation";
        resolution: "unresolved";
        missing: readonly ("column" | "row")[];
        col_name: string | null;
        doc_name: string | null;
      }
  );

type TabularChatRepositories = Readonly<{
  cells: Pick<TabularCellRepository, "listCells">;
  chats: TabularChatRepository;
  reviews: Pick<TabularReviewRepository, "listReviewDocuments">;
}>;

export function createTabularChat(
  repositories: TabularChatRepositories,
  documentCreator: DocumentCreator,
) {
  return async (input: {
    actor: TabularActor;
    review: TabularReview;
    messages: readonly Readonly<{
      role: "user" | "assistant";
      content?: string | null;
    }>[];
    chatId?: string;
    reviewTitle?: string;
    projectName?: string;
    signal: AbortSignal;
    write: (event: StreamDataEvent) => void;
  }): Promise<void> => {
    const lastUser = [...input.messages]
      .reverse()
      .find((message) => message.role === "user" && message.content?.trim());
    if (!lastUser?.content) throw new Error("messages must include a user message");
    const chat = input.chatId
      ? await repositories.chats.findOwnedChat(input.review.id, input.chatId, input.actor.userId)
      : await repositories.chats.createChat(input.review.id, input.actor.userId);
    if (!chat) throw new Error("Chat not found");
    const chatId = input.chatId ?? chat.id;
    const chatTitle = chat.title;
    input.write({ type: "chat_id", chatId });
    await repositories.chats.addChatMessage({
      chatId,
      role: "user",
      content: lastUser.content,
    });
    const [cells, documents] = await Promise.all([
      repositories.cells.listCells(input.review.id),
      repositories.reviews.listReviewDocuments(input.review.id),
    ]);
    const columns = parseChatColumns(input.review.columnsConfig);
    const store: TabularCellStore = {
      columns,
      documents: documents.map(({ id, filename }) => ({ id, filename })),
      cells: new Map(
        cells.map((cell) => [
          `${cell.columnIndex}:${cell.documentId}`,
          parseCellContent(cell.content),
        ]),
      ),
    };
    const runtime = await getUserAiRuntime(input.actor.userId);
    const citationParser = (text: string) => parseTabularCitationAnnotations(text, store);
    const { fullText, events } = await runLLMStream({
      apiMessages: buildMessages(input.messages, store, input.review.title ?? "Untitled Review"),
      docStore: new Map(),
      docIndex: {},
      userId: input.actor.userId,
      write: input.write,
      scope: { kind: "tabular", projectId: input.review.projectId },
      tabularStore: store,
      citationParser,
      runtime,
      task: "tabular",
      userEmail: input.actor.email,
      signal: input.signal,
      documentCreator,
    });
    const citationResult = citationParser(fullText);
    const extracted = citationResult.status === "valid" ? [...citationResult.citations] : [];
    await repositories.chats.addChatMessage({
      chatId,
      role: "assistant",
      content: events.length ? JSON.stringify(events) : null,
      annotations: extracted.length ? extracted : null,
    });
    await repositories.chats.updateChat({
      reviewId: input.review.id,
      chatId,
      userId: input.actor.userId,
    });
    const firstExchange = input.messages.filter((message) => message.role === "user").length === 1;
    if (firstExchange && !chatTitle) {
      const title = await generateTitle(
        input.actor.userId,
        lastUser.content,
        {
          reviewTitle: input.reviewTitle ?? input.review.title,
          projectName: input.projectName,
        },
        runtime,
      );
      if (title) {
        await repositories.chats.updateChat({
          reviewId: input.review.id,
          chatId,
          userId: input.actor.userId,
          title,
        });
        input.write({ type: "chat_title", chatId, title });
      }
    }
  };
}

function parseChatColumns(value: unknown): { index: number; name: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const index = Reflect.get(entry, "index");
      const name = Reflect.get(entry, "name");
      return typeof index === "number" && typeof name === "string" ? [{ index, name }] : [];
    })
    .sort((left, right) => left.index - right.index);
}

function buildMessages(
  messages: readonly Readonly<{ role: string; content?: string | null }>[],
  store: TabularCellStore,
  reviewTitle: string,
): ChatMessage[] {
  const documents = store.documents
    .map((document, index) => `- ROW:${index} "${document.filename}"`)
    .join("\n");
  const columns = store.columns
    .map((column, index) => `- COL:${index} "${column.name}"`)
    .join("\n");
  const system = lunaPrompt(`You are helping with the tabular review titled "${reviewTitle}".

The review extracts specific fields from multiple legal documents into a structured table.
You do NOT have the cell content yet. Call read_table_cells to fetch the cells you need before answering.

DOCUMENTS (rows):
${documents || "- (none)"}

COLUMNS (fields):
${columns || "- (none)"}

TABULAR CITATION INSTRUCTIONS:
When you reference specific cell content, place a numbered marker [1], [2], etc. inline in your prose at the point of reference.

After your complete response, append a <CITATIONS> block containing a JSON array with one entry per marker:

<CITATIONS>
[
  {"ref": 1, "col_index": 0, "row_index": 2, "quote": "verbatim text from the cell"},
  {"ref": 2, "col_index": 1, "row_index": 0, "quote": "another excerpt"}
]
</CITATIONS>

Rules:
- col_index and row_index are 0-based (matching the COL/ROW numbers listed above)
- Only cite cells you have read via read_table_cells
- quote should be verbatim text from the cell's summary
- Omit <CITATIONS> if you make no citations
- Do not fabricate cell content
- Answer in clear, concise prose. You may use markdown formatting.`);
  return [
    { role: "system", content: system },
    ...messages.map((message) => ({
      role: message.role,
      content: message.content ?? "",
    })),
  ];
}

function resolveTabularCitation(
  citation: TabularCitation,
  store: Pick<TabularCellStore, "columns" | "documents">,
): TabularCitationAnnotation {
  const column = store.columns[citation.col_index];
  const document = store.documents[citation.row_index];
  if (column && document) {
    return {
      ...citation,
      type: "tabular_citation",
      resolution: "resolved",
      col_name: column.name,
      doc_name: document.filename,
    };
  }

  const missing: ("column" | "row")[] = [];
  if (!column) missing.push("column");
  if (!document) missing.push("row");
  return {
    ...citation,
    type: "tabular_citation",
    resolution: "unresolved",
    missing,
    col_name: column?.name ?? null,
    doc_name: document?.filename ?? null,
  };
}

export function parseTabularCitationAnnotations(
  text: string,
  store: Pick<TabularCellStore, "columns" | "documents">,
): CitationBlockResult<TabularCitationAnnotation> {
  const parsed = parseCitationBlock(text, (value) => {
    const result = z.array(citationSchema).safeParse(value);
    return result.success ? result.data : null;
  });
  if (parsed.status !== "valid") return parsed;
  return {
    ...parsed,
    citations: parsed.citations.map((citation) => resolveTabularCitation(citation, store)),
  };
}

async function generateTitle(
  userId: string,
  firstUserMessage: string,
  context: { reviewTitle?: string | null; projectName?: string },
  runtime: AiRuntimeContext,
): Promise<string | null> {
  try {
    const { titleModel } = await getUserModelSettings(userId);
    const contextLines: string[] = [];
    if (context.projectName) contextLines.push(`Project: ${context.projectName}`);
    if (context.reviewTitle) contextLines.push(`Tabular review: ${context.reviewTitle}`);
    const contextBlock = contextLines.length
      ? `This chat is in the context of a tabular review.\n${contextLines.join("\n")}\n\n`
      : "";
    const raw = await completeText({
      model: titleModel,
      task: "title",
      user: `${contextBlock}Generate a short title (4-6 words) for a chat that starts with the message below. The title should reflect the user's specific question, not the review or project name. Return only the title, no punctuation, no quotes:\n\n${firstUserMessage}`,
      maxTokens: 64,
      runtime,
    });
    return raw.trim().slice(0, 80) || null;
  } catch {
    return null;
  }
}
