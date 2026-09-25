# Back up and restore Prism

A recoverable Prism backup has three parts:

1. A PostgreSQL dump.
2. A complete copy of the object store.
3. The deployment secrets needed to decrypt or validate retained data.

PostgreSQL and object storage are not one atomic transaction. Pause writes while you capture both parts, or accept and document a consistency window.

## Tutorial: back up the local Compose stack

Create a private backup directory.

```sh
mkdir -p backups
```

Stop the application processes and MinIO so nothing creates database rows or objects during the backup. Keep PostgreSQL running.

```sh
docker compose stop frontend backend worker minio
```

Dump PostgreSQL.

```sh
docker compose exec -T postgres pg_dump --format=custom --no-owner --no-acl --username=prism --dbname=prism > backups/prism.dump
```

Copy the MinIO data volume.

```sh
docker run --rm --volume prism-local_minio_data:/source:ro --volume "$PWD/backups:/backup" alpine:3.22 tar -C /source -czf /backup/prism-objects.tar.gz .
```

Copy the generated secrets file to a private location outside the backup directory. It holds the AI credential keyring and the application secrets.

```sh
docker run --rm --volume prism-local_prism_secrets:/source:ro alpine:3.22 cat /source/prism.env > prism-secrets.env
```

Record the Git revision. Move `prism-secrets.env` into your secret manager and delete the local copy.

Restart the application.

```sh
docker compose start minio backend worker frontend
```

The Compose project name is fixed to `prism-local`, so its volumes are named `prism-local_minio_data` and `prism-local_prism_secrets`. The Qdrant search index is not part of the backup. Prism can rebuild it from the stored files.

## How-to: back up a hosted deployment

1. Enter a maintenance window or stop the frontend, API, and worker.
2. Create a custom-format PostgreSQL dump.

   ```sh
   pg_dump --format=custom --no-owner --no-acl --file=prism.dump "$DATABASE_URL"
   ```

3. Copy every object from the configured bucket.

   ```sh
   aws s3 sync "s3://$OBJECT_STORE_BUCKET" ./prism-objects --endpoint-url "$OBJECT_STORE_ENDPOINT"
   ```

4. Record the exact application revision.
5. Store these secrets with restricted backup metadata:
   - Every key in `AI_CREDENTIAL_ENCRYPTION_KEYS`.
   - `BETTER_AUTH_SECRET`.
   - `AUTH_OTP_SECRET`.
   - `DOWNLOAD_SIGNING_SECRET`.
6. Encrypt the dump and object copy before moving them to backup storage.
7. Resume the services.

The AWS CLI command works with many S3-compatible services. Use the object-store vendor's documented snapshot or replication process when it provides stronger consistency.

## How-to: restore into an isolated environment

Do not test a restore over the only production copy.

1. Provision an empty PostgreSQL database and an empty object-store bucket.
2. Configure the restore environment with the original AI credential keyring.
3. Restore PostgreSQL.

   ```sh
   pg_restore --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" prism.dump
   ```

4. Restore the object-store copy.

   ```sh
   aws s3 sync ./prism-objects "s3://$RESTORE_OBJECT_STORE_BUCKET" --endpoint-url "$RESTORE_OBJECT_STORE_ENDPOINT"
   ```

5. Point an isolated API and worker at the restored database and bucket.
6. Apply migrations that were released after the backed-up revision. The setup command also reruns the seeds, which is safe.

   ```sh
   npm run setup --workspace @prism/backend
   ```

7. Start one API and one worker.
8. Sign in, open several documents and versions, download a file, and inspect the worker logs.
9. Run a storage health check from the authenticated status page.
10. Keep the restore isolated until the checks pass.

Use the same `BETTER_AUTH_SECRET` only if preserving existing sessions is part of the recovery goal. Otherwise, changing it invalidates old sessions. Never omit an encryption key that is still named by an `ai_provider_connections.credential_key_id` row.

## How-to: restore the local object volume

The following procedure replaces the MinIO data volume. It is destructive.

1. Stop the stack.

   ```sh
   docker compose down
   ```

2. Remove and recreate only the object volume.

   ```sh
   docker volume rm prism-local_minio_data
   docker compose create minio
   ```

3. Extract the archive.

   ```sh
   docker run --rm --volume prism-local_minio_data:/target --volume "$PWD/backups:/backup:ro" alpine:3.22 tar -C /target -xzf /backup/prism-objects.tar.gz
   ```

4. Start PostgreSQL, restore the database dump, and then start the application.

   ```sh
   docker compose up -d postgres
   docker compose exec -T postgres pg_restore --clean --if-exists --no-owner --no-acl --username=prism --dbname=prism < backups/prism.dump
   docker compose up -d
   ```

Do not add `-v` to `docker compose down` during this procedure. That option also deletes the PostgreSQL and secrets volumes. The restored database needs the same `prism_secrets` volume, or a copy of the backed-up `prism.env` in it, to decrypt stored AI credentials.

## Reference: what the backup contains

The PostgreSQL dump includes identities, sessions, workspaces, document metadata, comments, chat history, templates, approvals, jobs, outbox events, provider connection ciphertext, and RAG index metadata.

The object-store copy includes uploaded sources, document versions, and generated renditions. It does not include the Qdrant search index. After a loss of that index, open **Sources** in Prism and retry indexing.

`OPENAI_API_KEY` is not in PostgreSQL. Neither are Resend, Qdrant, object-store, OAuth, or database credentials.

## Explanation: why coordinated recovery matters

An object can be written before its database operation completes, and a database row can survive while a later object operation fails. The worker records and reconciles known storage operations, but a backup can still capture the two systems at different moments.

A quiet backup window gives the simplest recovery point. If the deployment cannot pause writes, use database point-in-time recovery and object versioning, retain timestamps for both snapshots, and test how much inconsistency your recovery process can reconcile.
