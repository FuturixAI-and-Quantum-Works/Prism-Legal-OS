# Configure AI providers

Prism can use Anthropic, Google, OpenAI, and OpenAI-compatible model endpoints. A deployment can expose a server OpenAI connection, and each signed-in user can add personal connections.

## Tutorial: add a personal connection

1. Sign in to Prism.
2. Open **Settings**.
3. Under **Provider connections**, select **Add connection**.
4. Select Anthropic, Google, or OpenAI.
5. Enter a display name and API key.
6. Keep **Enabled** selected and save the connection.
7. Select **Test** beside the connection.
8. Under **Model preferences**, choose models for chat, title generation, and tabular analysis.

Compliance review uses the tabular-analysis preference. The two controls stay synchronized.

The connection test makes a small model request with the prompt `Reply with OK.` It can incur provider usage.

## How-to: add a server connection

Set the OpenAI key in the API and worker environment:

```sh
OPENAI_API_KEY=replace-with-provider-key
```

Restart both the API and worker after you change `OPENAI_API_KEY`. The server connection appears as a read-only entry in each user's AI settings. Any authenticated user can select it, so treat the key as a deployment-wide credential.

The same key creates document search embeddings when Qdrant is configured. Anthropic, Google, and OpenAI-compatible providers are available as personal connections only.

## How-to: add an OpenAI-compatible endpoint

Open **Settings**, add an **OpenAI-compatible** connection, and provide:

- A display name.
- An API key. Prism requires a nonempty value even if the endpoint does not authenticate requests.
- The endpoint's OpenAI-compatible API base URL.
- At least one model.

For each model, enter the provider's exact model ID and a display name. Declare its input, output, and tool-call capabilities. Select at least one task.

The capability settings are operator declarations. Prism does not discover them. An incorrect declaration can send unsupported input to a model or expose a model to a task it cannot complete.

Endpoints must use HTTPS. The URL cannot contain credentials, a query, or a fragment. Prism rejects private, reserved, loopback, and cloud metadata addresses and pins each request to a validated DNS result. Redirects must stay on the configured origin.

## How-to: rotate credential encryption keys

Personal provider keys are encrypted in PostgreSQL with AES-256-GCM. The authenticated user ID and provider are bound as additional authenticated data.

To rotate the encryption key:

1. Keep the current key in `AI_CREDENTIAL_ENCRYPTION_KEYS`.
2. Add a new strong secret under a new key ID.
3. Set `AI_CREDENTIAL_ACTIVE_KEY_ID` to the new ID.
4. Deploy the API and worker with the complete keyring.
5. Let users access their AI settings or use their connections. Prism re-encrypts each credential when it is read.
6. Remove an old key only after no database row refers to its ID and every retained backup has the keyring needed to decrypt it.

For example:

```sh
AI_CREDENTIAL_ACTIVE_KEY_ID=v2
AI_CREDENTIAL_ENCRYPTION_KEYS='{"v1":"retain-the-existing-secret","v2":"replace-with-a-new-random-secret"}'
```

Do not rename a key ID or change its secret in place. Losing a referenced key makes the associated provider credentials unreadable.

## Reference: built-in model catalog

The repository currently declares these models:

- Anthropic: Claude Opus 4.7 for chat; Claude Sonnet 4.6 for chat, titles, and tabular work; Claude Haiku 4.5 for titles.
- Google: Gemini 3.1 Pro Preview for chat, titles, and tabular work; Gemini 3.1 Flash Lite Preview for titles.
- OpenAI: GPT 5.5 for chat; GPT 5.4 Mini for chat, titles, and tabular work; GPT 5.4 Nano for titles.

Provider availability and model IDs can change outside Prism. A catalog entry does not guarantee that a provider account can use that model. If a provider rejects a model ID, update the catalog in source and redeploy. The setup step reseeds the catalog each time it runs.

A user's saved chat model preference takes precedence when its connection is available. Without a usable preference, Prism prefers an available Google connection, then Anthropic, then OpenAI, then a custom model.

Model requests time out after 60 seconds.

## Explanation: connection ownership

The server connection reads `OPENAI_API_KEY` from process memory. Prism does not store that key in the database, and users cannot edit it in the UI.

A personal connection belongs to one user. Prism stores its encrypted credential, endpoint, enabled state, and custom model records in PostgreSQL. Other users cannot select it.

Prism sends prompts, relevant document content, and tool results to the selected provider. Review provider retention, training, location, and data-processing terms before using confidential material. Prism cannot enforce a provider's external policies.
