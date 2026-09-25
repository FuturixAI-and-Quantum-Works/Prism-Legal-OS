# Contribute to Prism

This guide describes how to prepare a change for review. Follow [Develop Prism on the host](README.md#develop-prism-on-the-host) before you begin.

## Choose the right place

- Put browser code in [`frontend/src/client/`](frontend/src/client/).
- Put HTTP routes and business logic in the matching module under [`backend/src/modules/`](backend/src/modules/).
- Put shared streaming contracts in [`packages/protocol/`](packages/protocol/).
- Put database tables in the domain files under [`backend/src/db/schema/`](backend/src/db/schema/).
- Put operational and user documentation in [`docs/`](docs/).

Read [Prism architecture](ARCHITECTURE.md) before a change crosses more than one of these boundaries.

## Prepare the repository

Install the exact dependency graph from the lockfile.

```sh
npm ci
```

Start PostgreSQL and Qdrant, copy the backend environment, and apply migrations and seeds.

```sh
docker compose up -d postgres qdrant
cp backend/.env.example backend/.env
npm run setup --workspace @prism/backend
```

Rerun `setup` after you pull or generate a migration. The full Compose backend runs the same setup before it starts.

## Make a focused change

Keep unrelated cleanup out of the same change. Add tests at the boundary where behavior changes.

For a database change:

1. Edit the relevant schema file under [`backend/src/db/schema/`](backend/src/db/schema/).
2. Generate a Drizzle migration.

   ```sh
   npm run db:generate --workspace @prism/backend
   ```

3. Review the generated SQL.
4. Run the database verifier.

   ```sh
   npm run db:verify
   ```

Do not use `db:push` against a shared or production database. Do not rewrite a migration that has already been deployed.

For a protocol change, update [`packages/protocol/`](packages/protocol/) before its backend and frontend consumers. Keep the event parser and producer in sync.

For a documentation change, use repository-relative links and commands that exist in the package manifests. Run the documentation check before the full CI sequence.

```sh
node scripts/check-docs.mjs
npm run check:publication
```

## Run focused checks

Use the narrowest check while you work:

```sh
npm run typecheck
npm run test:unit
npm run test:security
npm run test:document-formats
npm run db:verify
npm run seed:validate
```

Run the full sequence before you request review.

```sh
npm run ci
```

The mocked browser suite builds the frontend and starts a strict local preview server. Install Chromium first if the Playwright browser is not present.

```sh
npx playwright install chromium
npm run test:e2e:mocked
```

## Submit the change

Describe the user-visible result, the design choice, and the commands you ran. Include screenshots for visual changes. State any check that you could not run and why.

Do not include secrets, production data, customer documents, generated test artifacts, or local environment files.

## Contribute licensed material

Code contributions are submitted for distribution under the repository's [AGPL-3.0-only license](LICENSE). Only contribute code, templates, images, text, and other material that you have the right to submit under compatible terms.

For a template contribution, record the author, source, jurisdiction, license, and any required attribution in the template pack documentation. A public webpage or an unmarked document is not proof of permission to redistribute.

Read the [template catalog](docs/template-catalog.md) before adding or republishing a template.

## Report a security issue

Do not open a public issue for an unpatched vulnerability. Follow the private process in [SECURITY.md](SECURITY.md).
