import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeRetrievalError } from "../../src/modules/retrieval/retrieval.config.js";
import {
  RetrievalProviderClient,
  type EmbedTexts,
  type RetrievalVectorStore,
} from "../../src/modules/retrieval/retrieval.provider.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const configuredProvider = {
  kind: "qdrant",
  url: "https://qdrant.example.com",
  apiKey: "test-api-key",
  openaiApiKey: "test-openai-key",
} as const;
const embed: EmbedTexts = async (texts) => texts.map((_text, index) => [index, 1]);

function vectorStore(overrides: Partial<RetrievalVectorStore> = {}): RetrievalVectorStore {
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected vector-store call");
  };
  return {
    getCollections: unexpected,
    collectionExists: unexpected,
    createCollection: unexpected,
    createPayloadIndex: unexpected,
    upsert: unexpected,
    query: unexpected,
    delete: unexpected,
    getCollection: unexpected,
    ...overrides,
  };
}

describe("RAG configuration fail-safe", () => {
  it("disables RAG without configuration and performs zero provider calls", async () => {
    let embedCount = 0;
    const service = new RetrievalProviderClient(undefined, {
      embed: async (texts) => {
        embedCount += 1;
        return embed(texts, new AbortController().signal);
      },
    });

    assert.equal(service.isConfigured, false);
    assert.deepEqual(await service.health(), {
      ok: false,
      status: "disabled",
      error: "RAG is disabled because QDRANT_URL and OPENAI_API_KEY are not both configured.",
    });

    const operations = [
      service.createCollection({
        type: "personal",
        id: "user-1",
        name: "Personal",
      }),
      service.ingestDocument("collection", "document", {
        bytes: Buffer.from("text"),
        filename: "notes.txt",
      }),
      service.queryCollection("collection", "query"),
      service.deleteDocument("collection", "document"),
      service.collectionStats("collection"),
    ];

    for (const operation of operations) {
      await assert.rejects(operation, (error: unknown) => {
        assert.equal(
          error instanceof Error ? error.message : "",
          "RAG is disabled because QDRANT_URL and OPENAI_API_KEY are not both configured.",
        );
        return true;
      });
    }

    assert.equal(embedCount, 0);
  });

  it("indexes OpenAI dense vectors with Qdrant BM25 inference in prism_v2 collections", async () => {
    const created: unknown[] = [];
    const upserts: unknown[] = [];
    const service = new RetrievalProviderClient(configuredProvider, {
      embed,
      client: vectorStore({
        collectionExists: async () => ({ exists: false }),
        createCollection: async (name, body) => {
          created.push({ name, body });
          return true;
        },
        createPayloadIndex: async () => ({ operation_id: 1, status: "completed" }),
        delete: async () => ({ operation_id: 2, status: "completed" }),
        upsert: async (name, body) => {
          upserts.push({ name, body });
          return { operation_id: 3, status: "completed" };
        },
      }),
    });

    const collection = await service.createCollection({
      type: "personal",
      id: "User-1",
      name: "Personal",
    });
    await service.ingestDocument(collection, "version-1", {
      bytes: Buffer.from("Indemnity clause text"),
      filename: "notes.txt",
      mimeType: "text/plain",
    });

    assert.equal(collection, "prism_v2_personal_user_1");
    assert.deepEqual(created, [
      {
        name: "prism_v2_personal_user_1",
        body: {
          vectors: { dense: { size: 1536, distance: "Cosine" } },
          sparse_vectors: { bm25: { modifier: "idf" } },
        },
      },
    ]);
    assert.deepEqual(upserts, [
      {
        name: "prism_v2_personal_user_1",
        body: {
          wait: true,
          points: [
            {
              id: "79df38da-2697-5fb4-9f6d-aef89d1cf4ee",
              vector: {
                dense: [0, 1],
                bm25: { text: "Indemnity clause text", model: "qdrant/bm25" },
              },
              payload: {
                document_id: "version-1",
                document_name: "notes.txt",
                text: "Indemnity clause text",
                page_number: undefined,
                mime_type: "text/plain",
              },
            },
          ],
        },
      },
    ]);
  });

  it("omits the private endpoint from source health contracts", async () => {
    const [routeSource, frontendSource] = await Promise.all([
      readFile(resolve(testDirectory, "../../src/routes/sources.ts"), "utf8"),
      readFile(
        resolve(testDirectory, "../../../frontend/src/client/store/api/sourcesApi.ts"),
        "utf8",
      ),
    ]);

    assert.doesNotMatch(routeSource, /rag_api_url|configuredUrl/);
    assert.doesNotMatch(frontendSource, /rag_api_url|configuredUrl/);
  });

  it("contains no private fallback endpoint", async () => {
    const source = await readFile(
      resolve(testDirectory, "../../src/modules/retrieval/retrieval.provider.ts"),
      "utf8",
    );

    assert.doesNotMatch(source, /workspaces_rag\.futurixai\.com/i);
    assert.doesNotMatch(source, /futurixai\.com/i);
  });

  it("combines caller cancellation with the request timeout", async () => {
    let queryCount = 0;
    let queryStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      queryStarted = resolve;
    });
    const service = new RetrievalProviderClient(configuredProvider, {
      embed,
      client: vectorStore({
        query: () => {
          queryCount += 1;
          queryStarted();
          return new Promise<never>(() => undefined);
        },
      }),
    });
    const controller = new AbortController();

    const operation = service.queryCollection("collection", "query", 8, controller.signal);
    await started;
    controller.abort();
    await assert.rejects(operation, (error: unknown) => {
      assert.equal(error instanceof Error ? error.message : "", "RAG query was cancelled.");
      return true;
    });
    assert.equal(queryCount, 1);
  });

  it("rejects malformed provider result entries", async () => {
    const service = new RetrievalProviderClient(configuredProvider, {
      embed,
      client: vectorStore({
        query: async () =>
          ({
            points: [{ score: 0.9, payload: { document_id: 42 } }],
          }) as never,
      }),
    });

    assert.deepEqual(await service.queryCollection("collection", "query"), []);
  });

  it("classifies cancellation and timeout failures as retryable", () => {
    assert.deepEqual(normalizeRetrievalError(new DOMException("", "AbortError")), {
      summary: "RAG operation was cancelled.",
      code: "request_cancelled",
      category: "network",
      retryable: true,
      retryAfterSeconds: null,
      details: { error_name: "AbortError" },
    });
    assert.equal(
      normalizeRetrievalError(new DOMException("", "TimeoutError")).code,
      "request_timeout",
    );
  });
});
