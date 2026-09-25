# Deploy and operate Prism

Prism needs a frontend, an API, a worker, PostgreSQL, object storage, and Resend for email. Document search needs Qdrant and an OpenAI API key.

The checked-in [`render.yaml`](../render.yaml) is the production reference. The checked-in [`compose.yaml`](../compose.yaml) is a loopback-only local stack.

## Tutorial: run the local Compose stack

Copy the environment example and set `RESEND_API_KEY` and `OPENAI_API_KEY` in `.env`.

```sh
cp .env.example .env
```

Build and start PostgreSQL 16, Qdrant, the API, the worker, and the frontend.

```sh
docker compose up -d
```

Every Compose command stops with an error while `RESEND_API_KEY` is empty.

Open:

- Prism at `http://localhost:8080`.
- The API at `http://localhost:8003`.
- Swagger UI at `http://localhost:8003/api-docs`.
- PostgreSQL at `localhost:5432`.
- Qdrant at `http://localhost:6333`.

All published ports bind to loopback. Do not expose this stack to another network. It runs in development mode with a fixed database password.

The backend container runs migrations automatically before it starts the API. It then seeds approval policies, workflows, the AI model catalog, seven HTML templates, and 54 DOCX templates. Every seed can rerun without creating duplicates, so each restart repeats the setup safely.

On first start, the backend generates `BETTER_AUTH_SECRET`, `AUTH_OTP_SECRET`, `DOWNLOAD_SIGNING_SECRET`, and the AI credential keyring into `/app/secrets/prism.env`. The API and worker share that file through the `prism_secrets` volume. A value set in the environment overrides the generated one.

The stack uses four named volumes:

- `postgres_data` holds the database.
- `qdrant_data` holds the document search index.
- `prism_storage` holds uploaded and generated files.
- `prism_secrets` holds the generated secrets.

To import additional licensed or operator-owned DOCX files, copy them into a temporary operator directory and pass that directory explicitly:

```sh
docker compose exec backend mkdir -p operator-docx
docker compose cp /absolute/path/to/licensed-docx/. backend:/app/backend/operator-docx/
docker compose exec backend node dist/scripts/seedDocxTemplates.js operator-docx
```

DOCX seeds write source objects to the persistent `prism_storage` volume. A copied operator input directory is ephemeral.

Stop the stack without deleting data:

```sh
docker compose down
```

Use `docker compose down -v` only when you intend to delete every named volume. Deleting `prism_secrets` makes stored AI provider credentials unreadable.

## Tutorial: deploy the Render Blueprint

1. Create or fork the repository in a Git provider that Render can access.
2. Create a Render Blueprint from [`render.yaml`](../render.yaml).
3. Enter every secret marked `sync: false` before the first deploy.
4. Wait for the PostgreSQL database, backend, worker, and static frontend to deploy.
5. Confirm `GET /health` on the backend.
6. Sign in, upload a synthetic document, and test an AI connection.

The Blueprint creates:

- `futurixai-prism-backend`, a Docker web service.
- `futurixai-prism-worker`, a Docker background worker.
- `futurixai-prism-frontend`, a static site.
- `futurixai-prism-postgres`, a private PostgreSQL 16 database.

The backend pre-deploy command, `node dist/scripts/setup.js`, runs Drizzle migrations and every seed before each deploy. The frontend build embeds `VITE_API_BASE_URL`. Redeploy the static site after that URL changes.

## How-to: complete required Render configuration

The Blueprint does not provision object storage. Create an S3-compatible bucket and set:

```sh
OBJECT_STORE_ENDPOINT=https://object-store.example.com
OBJECT_STORE_REGION=us-east-1
OBJECT_STORE_BUCKET=prism
OBJECT_STORE_ACCESS_KEY_ID=replace-me
OBJECT_STORE_SECRET_ACCESS_KEY=replace-me
OBJECT_STORE_FORCE_PATH_STYLE=false
```

Setting the `OBJECT_STORE_` values selects S3-compatible storage.

Create and retain a credential-encryption keyring:

```sh
AI_CREDENTIAL_ACTIVE_KEY_ID=v1
AI_CREDENTIAL_ENCRYPTION_KEYS='{"v1":"replace-with-a-long-random-secret"}'
```

The Blueprint generates the three application secrets for the backend and references them from the worker. It does not generate the AI credential keyring because operators must retain that keyring with backups.

Set the Resend key. Set `MAIL_FROM` to an address on a domain you have verified in Resend. The default sender, `onboarding@resend.dev`, delivers only to the Resend account owner.

```sh
RESEND_API_KEY=re_replace_me
MAIL_FROM=prism@example.com
```

Set `OPENAI_API_KEY` to give every user a server OpenAI connection and to enable document search embeddings. See [Configure AI providers](providers.md).

Render does not run Qdrant from this Blueprint. To enable document search, create a [Qdrant Cloud](https://cloud.qdrant.io/) cluster and set both values:

```sh
QDRANT_URL=https://your-cluster.cloud.qdrant.io
QDRANT_API_KEY=replace-with-qdrant-api-key
```

`QDRANT_URL` must use HTTPS in production. Document search stays disabled until `QDRANT_URL` and `OPENAI_API_KEY` are both set.

## How-to: use custom domains

After attaching custom domains, update all URL settings together:

- Backend `BETTER_AUTH_URL` to the public API origin.
- Backend `FRONTEND_URL` to the public frontend origin.
- Frontend `VITE_API_BASE_URL` to the public API origin.

If Google sign-in is enabled, register the callback at:

```text
https://api.example.com/auth/callback/google
```

Redeploy the frontend after changing `VITE_API_BASE_URL`. Restart both backend processes after changing shared runtime settings.

## How-to: re-index after upgrading from MiniLM search

Earlier releases stored 384-dimension MiniLM vectors from Qdrant Cloud inference. Prism now stores OpenAI `text-embedding-3-small` vectors with Qdrant BM25, in new collections named with the `prism_v2_` prefix. Source-backed search fails for a scope until its sources are re-indexed.

After you upgrade, each user opens **Sources** and selects **Backfill existing files**. That queues every current document and drive file version for the new collections. Delete the old `prism_` collections from Qdrant once every source shows as indexed.

## How-to: release safely

1. Back up PostgreSQL, object storage, and the AI credential keyring. Follow [Back up and restore Prism](backups-and-restore.md).
2. Run the repository CI sequence against the release revision.

   ```sh
   npm run ci
   ```

3. Review generated migration SQL.
4. Deploy the backend. Render runs migrations and seeds before replacing the web process.
5. Deploy the worker from the same revision and with the same shared configuration.
6. Deploy the frontend.
7. Check health, sign-in, upload, download, conversion, mail, and one queued operation.

Code rollback does not undo a database migration. Use a forward repair when possible. Restore the coordinated backup when a migration cannot be made backward-compatible.

## Reference: runtime defaults

- Host-run API port: `3001`.
- Host-run Vite port: `5173`.
- Compose and backend container port: `8003`.
- Compose frontend port: `8080`.
- Compose PostgreSQL port: `5432`.
- Compose Qdrant port: `6333`.
- Storage: S3-compatible when the `OBJECT_STORE_` values are set. Otherwise local files in development and disabled in production.
- Mail: Resend when `RESEND_API_KEY` is set. Otherwise the console provider, which records delivery as suppressed.
- Mail sender: `onboarding@resend.dev` unless `MAIL_FROM` is set.
- Document search: enabled when `QDRANT_URL` and `OPENAI_API_KEY` are both set.
- Worker concurrency: `4`.
- API and worker graceful-shutdown timeout: 10 seconds.
- Local conversion: LibreOffice for DOC and DOCX, Chromium for HTML.

Render filesystems are ephemeral. Never use local storage for deployed documents. The backend rejects local storage in production.

## How-to: monitor and recover

Monitor the public `/health` endpoint from outside Render. Use the authenticated status page for recorded database, API, and mail checks. Review API and worker logs together when a queued operation fails.

The worker uses database leases. After a restart, it can reclaim expired jobs and outbox events. Repeated failure still needs operator action. Inspect the stored attempt and error before retrying.

For an incident:

1. Stop writes if data consistency is at risk.
2. Preserve API, worker, PostgreSQL, and object-store evidence.
3. Identify the deployed Git revision and migration level.
4. Restore into an isolated environment.
5. Validate database references and object availability.
6. Resume public traffic only after representative workflows pass.

## Explanation: deployment boundaries

The API is stateless apart from process-local rate-limit counters and active requests. Durable state belongs in PostgreSQL and object storage. This permits replacement deployments, but it means all API instances need identical secrets and external-service configuration.

The worker is not optional for a complete product deployment. The API can answer health checks without it while email, indexing, compliance, tabular generation, health history, and storage reconciliation remain queued.
