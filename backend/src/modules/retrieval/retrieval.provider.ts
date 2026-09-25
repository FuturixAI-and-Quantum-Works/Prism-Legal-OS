import { createHash } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { embedMany } from "ai";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { decodeDocumentContent, DocumentContentError } from "../content/documentContent.js";
import {
  OPENAI_EMBEDDING_MODEL,
  QDRANT_BM25_MODEL,
  QDRANT_BM25_VECTOR_NAME,
  QDRANT_CHUNK_CHARS,
  QDRANT_CHUNK_OVERLAP,
  QDRANT_DENSE_VECTOR_NAME,
  QDRANT_DENSE_VECTOR_SIZE,
  QDRANT_UPSERT_BATCH_SIZE,
  RETRIEVAL_DISABLED_MESSAGE,
  RETRIEVAL_REQUEST_TIMEOUT_MS,
  RetrievalProviderError,
  normalizeRetrievalError,
} from "./retrieval.config.js";
import type { RetrievalScope, RetrievalSearchResult } from "./retrieval.types.js";

export type RetrievalVectorStore = Pick<
  QdrantClient,
  | "getCollections"
  | "collectionExists"
  | "createCollection"
  | "createPayloadIndex"
  | "upsert"
  | "query"
  | "delete"
  | "getCollection"
>;

export type EmbedTexts = (
  texts: readonly string[],
  signal: AbortSignal,
) => Promise<readonly (readonly number[])[]>;

type RetrievalProviderOptions = Readonly<{
  client?: RetrievalVectorStore;
  embed?: EmbedTexts;
}>;

type QdrantRetrievalConfig = Extract<AppConfig["rag"], { kind: "qdrant" }>;

type IngestSource = Readonly<{
  bytes: Buffer;
  filename: string;
  mimeType?: string;
}>;

type TextChunk = Readonly<{
  text: string;
  page_number?: number;
}>;

const optionalString = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);
const optionalNumber = z
  .number()
  .nullish()
  .transform((value) => value ?? undefined);
const queryPointSchema = z.object({
  score: optionalNumber,
  payload: z.object({
    document_id: z.string(),
    document_name: optionalString,
    text: optionalString,
    page_number: optionalNumber,
    document_context: optionalString,
    document_url: optionalString,
    metadata: z
      .record(z.string(), z.unknown())
      .nullish()
      .transform((value) => value ?? undefined),
  }),
});

function sanitizeCollectionPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50) || "sources"
  );
}

function collectionNameFor(scope: RetrievalScope): string {
  const name = [
    "prism_v2",
    sanitizeCollectionPart(scope.type),
    sanitizeCollectionPart(scope.id),
  ].join("_");
  return name.slice(0, 255);
}

function openAiEmbedder(apiKey: string): EmbedTexts {
  const model = createOpenAI({ apiKey }).embedding(OPENAI_EMBEDDING_MODEL);
  return async (texts, abortSignal) =>
    (await embedMany({ model, values: [...texts], abortSignal })).embeddings;
}

function pointId(documentId: string, chunkIndex: number): string {
  const bytes = Buffer.from(
    createHash("sha1").update(`prism-rag:${documentId}:${chunkIndex}`).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function splitPages(text: string): TextChunk[] {
  const matches = [...text.matchAll(/\[Page (\d+)\]\s*/g)];
  if (matches.length === 0) {
    const trimmed = text.trim();
    return trimmed ? [{ text: trimmed }] : [];
  }
  return matches
    .map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[index + 1]?.index ?? text.length;
      return {
        text: text.slice(start, end).trim(),
        page_number: Number.parseInt(match[1]!, 10),
      };
    })
    .filter((page) => page.text);
}

function windowText(page: TextChunk): TextChunk[] {
  if (page.text.length <= QDRANT_CHUNK_CHARS) return [page];
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < page.text.length) {
    const end = Math.min(start + QDRANT_CHUNK_CHARS, page.text.length);
    chunks.push({ text: page.text.slice(start, end).trim(), page_number: page.page_number });
    if (end >= page.text.length) break;
    start = Math.max(end - QDRANT_CHUNK_OVERLAP, start + 1);
  }
  return chunks.filter((chunk) => chunk.text);
}

function chunkDocumentText(text: string): TextChunk[] {
  return splitPages(text).flatMap(windowText);
}

function abortError(signal: AbortSignal): DOMException {
  const timedOut = signal.reason instanceof DOMException && signal.reason.name === "TimeoutError";
  return new DOMException(
    timedOut ? "The operation timed out." : "The operation was aborted.",
    timedOut ? "TimeoutError" : "AbortError",
  );
}

async function withAbort<T>(signal: AbortSignal, operation: Promise<T>): Promise<T> {
  if (signal.aborted) throw abortError(signal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function collectionExistsFlag(result: boolean | { exists: boolean }): boolean {
  return typeof result === "boolean" ? result : result.exists;
}

export class RetrievalProviderClient {
  private store: RetrievalVectorStore | null;
  private embedder: EmbedTexts | null;

  constructor(
    private readonly config: AppConfig["rag"] = { kind: "disabled" },
    options: RetrievalProviderOptions = {},
  ) {
    this.store = options.client ?? null;
    this.embedder = options.embed ?? null;
  }

  get isConfigured(): boolean {
    return this.config.kind === "qdrant";
  }

  async health(signal?: AbortSignal): Promise<{ ok: boolean; status?: string; error?: string }> {
    if (this.config.kind === "disabled") {
      return { ok: false, status: "disabled", error: RETRIEVAL_DISABLED_MESSAGE };
    }

    try {
      await this.run("RAG health check", signal, (client) => client.getCollections());
      return { ok: true, status: "ok" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async createCollection(scope: RetrievalScope, signal?: AbortSignal): Promise<string> {
    const name = collectionNameFor(scope);
    const exists = await this.run("RAG collection lookup", signal, (client) =>
      client.collectionExists(name),
    );
    if (collectionExistsFlag(exists)) return name;

    await this.run("RAG collection create", signal, (client) =>
      client.createCollection(name, {
        vectors: {
          [QDRANT_DENSE_VECTOR_NAME]: {
            size: QDRANT_DENSE_VECTOR_SIZE,
            distance: "Cosine",
          },
        },
        sparse_vectors: {
          [QDRANT_BM25_VECTOR_NAME]: {
            modifier: "idf",
          },
        },
      }),
    );
    await this.run("RAG payload index create", signal, (client) =>
      client.createPayloadIndex(name, {
        wait: true,
        field_name: "document_id",
        field_schema: "keyword",
      }),
    );
    return name;
  }

  async ingestDocument(
    collectionName: string,
    documentId: string,
    { bytes, filename, mimeType }: IngestSource,
    signal?: AbortSignal,
  ): Promise<void> {
    this.requireConfiguration();
    let extracted;
    try {
      extracted = await decodeDocumentContent({
        output: "text",
        bytes,
        filename,
        mimeType,
        signal,
      });
    } catch (error) {
      if (error instanceof DocumentContentError && error.code === "unsupported-format") {
        const extension = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
        throw new RetrievalProviderError(
          normalizeRetrievalError(
            `Unsupported file format: ${extension ? `.${extension}` : filename}`,
            "RAG ingest",
          ),
        );
      }
      throw new RetrievalProviderError(normalizeRetrievalError(error, "RAG ingest"));
    }

    const chunks = chunkDocumentText(extracted.text);
    if (chunks.length === 0) {
      throw new RetrievalProviderError(
        normalizeRetrievalError("RAG ingest failed: no extractable text", "RAG ingest"),
      );
    }

    await this.run("RAG document delete", signal, (client) =>
      client.delete(collectionName, {
        wait: true,
        filter: {
          must: [{ key: "document_id", match: { value: documentId } }],
        },
      }),
    );

    for (let offset = 0; offset < chunks.length; offset += QDRANT_UPSERT_BATCH_SIZE) {
      const batch = chunks.slice(offset, offset + QDRANT_UPSERT_BATCH_SIZE);
      const embeddings = await this.embed(
        "RAG embedding",
        batch.map((chunk) => chunk.text),
        signal,
      );
      await this.run("RAG ingest", signal, (client) =>
        client.upsert(collectionName, {
          wait: true,
          points: batch.map((chunk, index) => ({
            id: pointId(documentId, offset + index),
            vector: {
              [QDRANT_DENSE_VECTOR_NAME]: [...embeddings[index]!],
              [QDRANT_BM25_VECTOR_NAME]: { text: chunk.text, model: QDRANT_BM25_MODEL },
            },
            payload: {
              document_id: documentId,
              document_name: filename,
              text: chunk.text,
              page_number: chunk.page_number,
              mime_type: mimeType,
            },
          })),
        }),
      );
    }
  }

  async queryCollection(
    collectionName: string,
    query: string,
    topK = 8,
    signal?: AbortSignal,
  ): Promise<RetrievalSearchResult[]> {
    const prefetchLimit = Math.max(topK * 4, topK);
    const [embedding] = await this.embed("RAG query embedding", [query], signal);
    const result = await this.run("RAG query", signal, (client) =>
      client.query(collectionName, {
        prefetch: [
          {
            query: [...embedding!],
            using: QDRANT_DENSE_VECTOR_NAME,
            limit: prefetchLimit,
          },
          {
            query: { text: query, model: QDRANT_BM25_MODEL },
            using: QDRANT_BM25_VECTOR_NAME,
            limit: prefetchLimit,
          },
        ],
        query: { fusion: "rrf" },
        limit: topK,
        with_payload: true,
      }),
    );

    return result.points.flatMap((point, index) => {
      const parsed = queryPointSchema.safeParse(point);
      if (!parsed.success) return [];
      return [
        {
          rank: index + 1,
          document_name: parsed.data.payload.document_name,
          document_id: parsed.data.payload.document_id,
          page_number: parsed.data.payload.page_number,
          text: parsed.data.payload.text,
          document_context: parsed.data.payload.document_context,
          vector_score: parsed.data.score,
          combined_score: parsed.data.score,
          metadata: parsed.data.payload.metadata,
          document_url: parsed.data.payload.document_url,
        } satisfies RetrievalSearchResult,
      ];
    });
  }

  async deleteDocument(
    collectionName: string,
    documentId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.run("RAG document delete", signal, (client) =>
      client.delete(collectionName, {
        wait: true,
        filter: {
          must: [{ key: "document_id", match: { value: documentId } }],
        },
      }),
    );
  }

  async collectionStats(collectionName: string, signal?: AbortSignal): Promise<unknown> {
    return this.run("RAG collection stats", signal, (client) =>
      client.getCollection(collectionName),
    );
  }

  private requireConfiguration(): QdrantRetrievalConfig {
    if (this.config.kind === "qdrant") return this.config;
    throw new RetrievalProviderError({
      summary: RETRIEVAL_DISABLED_MESSAGE,
      code: "rag_disabled",
      category: "config",
      retryable: false,
      retryAfterSeconds: null,
      details: {},
    });
  }

  private client(): RetrievalVectorStore {
    const configuration = this.requireConfiguration();
    if (this.store) return this.store;
    this.store = new QdrantClient({
      url: configuration.url,
      apiKey: configuration.apiKey,
      timeout: RETRIEVAL_REQUEST_TIMEOUT_MS,
      checkCompatibility: false,
    });
    return this.store;
  }

  private async embed(
    operation: string,
    texts: readonly string[],
    signal: AbortSignal | undefined,
  ): Promise<readonly (readonly number[])[]> {
    const configuration = this.requireConfiguration();
    this.embedder ??= openAiEmbedder(configuration.openaiApiKey);
    const embed = this.embedder;
    return this.withRequestSignal(operation, signal, (requestSignal) =>
      embed(texts, requestSignal),
    );
  }

  private async run<T>(
    operation: string,
    signal: AbortSignal | undefined,
    work: (client: RetrievalVectorStore) => Promise<T>,
  ): Promise<T> {
    const client = this.client();
    return this.withRequestSignal(operation, signal, () => work(client));
  }

  private async withRequestSignal<T>(
    operation: string,
    signal: AbortSignal | undefined,
    work: (requestSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(RETRIEVAL_REQUEST_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      if (requestSignal.aborted) throw abortError(requestSignal);
      return await withAbort(requestSignal, work(requestSignal));
    } catch (error) {
      throw new RetrievalProviderError(normalizeRetrievalError(error, operation));
    }
  }
}
