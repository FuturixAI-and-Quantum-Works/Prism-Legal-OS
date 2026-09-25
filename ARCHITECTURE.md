# Prism architecture

Prism is a browser application, an HTTP API, and a background worker built around one PostgreSQL database. The product is Prism. Luna is the AI assistant identity used by the backend prompt and document-edit metadata.

## System shape

The browser never connects to PostgreSQL or object storage directly. It calls the Express API with a Better Auth session cookie.

The main runtime parts are:

- [`frontend/`](frontend/) contains the React single-page application. Vite builds and serves it.
- [`backend/src/index.ts`](backend/src/index.ts) composes and starts the Express API.
- [`backend/src/worker.ts`](backend/src/worker.ts) claims jobs and outbox events from PostgreSQL.
- [`packages/protocol/`](packages/protocol/) defines the typed server-sent event protocol shared by the API and frontend.
- [`backend/src/db/schema/`](backend/src/db/schema/) defines the PostgreSQL schema in domain files.
- An object store holds document bytes. PostgreSQL holds references and application state.
- AI providers, Qdrant, and Resend are external boundaries.

The API and worker are separate processes. Both require the same database, storage, mail, RAG, and encryption configuration. Only the API opens an HTTP port.

## Frontend

[`frontend/src/client/routeManifest.ts`](frontend/src/client/routeManifest.ts) is the route registry. It classifies routes as public, onboarding, or protected and lazy-loads each page.

[`frontend/src/client/App.tsx`](frontend/src/client/App.tsx) applies the authentication boundary. A lost session clears RTK Query data and other session-scoped browser state before returning the user to sign-in.

[`frontend/src/client/store/api/baseApi.ts`](frontend/src/client/store/api/baseApi.ts) owns API transport for feature endpoints. Requests include cookies. A `401` response emits one session-loss event for the application shell.

Feature code lives under [`frontend/src/client/features/`](frontend/src/client/features/). Shared UI and route-level components live under [`frontend/src/client/components/`](frontend/src/client/components/). The [frontend design system](frontend/DESIGN_SYSTEM.md) describes styling, accessibility, and sanitization boundaries.

## Authentication and HTTP boundary

[`backend/src/auth/auth.ts`](backend/src/auth/auth.ts) configures Better Auth with the Drizzle adapter. It supports email OTP sign-in and optional Google OAuth. Session, account, verification, and rate-limit records live in the application database.

The API mounts Better Auth at `/auth`. [`backend/src/app.ts`](backend/src/app.ts) then applies:

- Helmet headers.
- Credentialed CORS for `FRONTEND_URL`.
- An origin check for unsafe cookie-authenticated requests.
- General and endpoint-specific request limits.
- JSON request parsing with a 50 MB limit.
- Swagger UI at `/api-docs`.
- Domain routers from [`backend/src/productionDependencies.ts`](backend/src/productionDependencies.ts).

`GET /health` is the public process-health endpoint. Application routes use the authenticated context from [`backend/src/middleware/auth.ts`](backend/src/middleware/auth.ts). Authorization rules are centralized under [`backend/src/modules/access/`](backend/src/modules/access/).

## Application modules

Backend feature code is grouped under [`backend/src/modules/`](backend/src/modules/). A module normally contains route, controller, service, policy, repository, validation, and composition files when those roles are needed.

The main domains are access, AI tools, approvals, chat, compliance, content, documents, downloads, drive, projects, retrieval, sharing, tabular reviews, templates, users, and workflows. Older route files remain only for domains that have not moved to a full module directory.

Composition code connects concrete infrastructure at process startup. Domain services receive repositories or narrow capability interfaces. This keeps HTTP and database details out of most business logic.

## Database and durable work

[`backend/src/db/schema/index.ts`](backend/src/db/schema/index.ts) exports the modular Drizzle schema. The current baseline is [`backend/drizzle/0000_prism_baseline.sql`](backend/drizzle/0000_prism_baseline.sql). It creates 73 application tables and the required PostgreSQL enum types.

The baseline includes:

- Better Auth identities, sessions, accounts, verifications, and rate limits.
- Projects, workspaces, files, documents, versions, comments, and activity.
- Sharing, invitations, approvals, and change requests.
- Chats, workflows, templates, compliance reviews, and tabular reviews.
- AI provider connections, model records, and task preferences.
- RAG collection and source-index state.
- Jobs, attempts, outbox events, health history, and storage reconciliation.

The API writes asynchronous work to the `jobs` and `outbox_events` tables. The worker claims rows with PostgreSQL locks and leases. It renews active leases, retries bounded failures, and recovers expired leases. Idempotency keys prevent the same logical operation from being queued with conflicting data.

The worker handles compliance runs, tabular generation, RAG indexing, email delivery, service checks, and object-storage reconciliation.

## Documents and object storage

PostgreSQL stores document metadata and version references. The configured object store owns source bytes, generated DOCX files, and PDF renditions.

Development defaults to local storage at `backend/data` when the workspace script starts the backend. Production defaults to disabled storage. S3-compatible storage is the supported production mode.

Document writes use domain services under [`backend/src/modules/documents/`](backend/src/modules/documents/). Drive writes record storage operations so the worker can reconcile work left by a crash.

[`backend/src/modules/content/documentContent.ts`](backend/src/modules/content/documentContent.ts) is the shared decoding boundary for PDF, DOCX, text, HTML, and spreadsheet content. DOCX template filling and tracked-change handling preserve the package structure instead of converting the source to plain text.

## Conversion

[`backend/src/lib/documentConverter.ts`](backend/src/lib/documentConverter.ts) provides two local adapters:

- LibreOffice converts DOC and DOCX input to PDF.
- Puppeteer Chromium converts HTML to PDF.

Each adapter has its own bounded queue. The converter limits input size, output size, execution time, concurrency, and queued work. HTML conversion disables JavaScript and blocks external resource requests.

## AI and Luna

[`backend/src/lib/prompts/luna.ts`](backend/src/lib/prompts/luna.ts) defines Luna's identity. [`backend/src/lib/llm/providerRegistry.ts`](backend/src/lib/llm/providerRegistry.ts) creates AI SDK models for Anthropic, Google, OpenAI, and OpenAI-compatible endpoints.

An AI request follows this path:

1. A chat controller validates the request and resolves the authenticated scope.
2. [`backend/src/modules/chat/chat.coordinator.ts`](backend/src/modules/chat/chat.coordinator.ts) checks access, resolves the session, and assembles document context.
3. [`backend/src/modules/chat/chat.execution.ts`](backend/src/modules/chat/chat.execution.ts) selects an intent and prepares the prompt.
4. [`backend/src/modules/ai/tools/runtimeCoordinator.ts`](backend/src/modules/ai/tools/runtimeCoordinator.ts) streams the model response and executes allowed tools.
5. The API emits typed server-sent events and persists the completed turn.

Tools can read, compare, create, and edit documents. Other tools cover templates, search, projects, workspaces, workflows, and tabular reviews. The available tool set depends on the current scope.

The server OpenAI key comes from the process environment. Users can also store personal connections. Prism encrypts personal credentials with AES-256-GCM before writing them to PostgreSQL.

## Retrieval

RAG uses Qdrant collections. Without both `QDRANT_URL` and `OPENAI_API_KEY`, Prism skips indexing and source-backed queries return a disabled result. Compose runs a local Qdrant. `QDRANT_API_KEY` is needed only for Qdrant Cloud.

When RAG is enabled, the worker reads the stored file, extracts text, and upserts chunks into Qdrant. OpenAI `text-embedding-3-small` produces the dense vectors. Qdrant's BM25 inference produces the sparse vectors. Collection names use the `prism_v2_` prefix. PostgreSQL records collection names, source versions, status, and retry details.

## Failure boundaries

Startup configuration is parsed once in [`backend/src/config.ts`](backend/src/config.ts). Invalid secrets, origins, storage settings, or service URLs stop the process before it accepts work.

The API and worker close their database, mail, storage, conversion, and HTTP resources during shutdown. Jobs use leases so another worker can recover interrupted work.

Prism does not make PostgreSQL and object-store changes one atomic transaction. Storage reconciliation reduces inconsistency after crashes. Backups must still capture both systems as one recovery set.
