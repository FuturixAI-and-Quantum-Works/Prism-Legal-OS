import "../loadEnv.js";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { and, isNull } from "drizzle-orm";
import { db, aiProviderModels } from "../db/index.js";
import type { AiRegistryDatabase } from "../lib/aiRegistry.js";
import { AI_MODEL_CATALOG } from "../lib/llm/models.js";
import { withScriptDatabase } from "./database.js";

export { AI_MODEL_CATALOG };

export function validateAiCatalog(): void {
  const catalogIds = new Set(AI_MODEL_CATALOG.map(({ id }) => id));
  if (catalogIds.size !== AI_MODEL_CATALOG.length) {
    throw new Error("AI model catalog contains duplicate IDs");
  }
  for (const model of AI_MODEL_CATALOG) {
    if (!model.tasks.length) throw new Error(`AI model ${model.id} has no supported tasks`);
  }
}

export async function seedAiCatalog(database: AiRegistryDatabase = db): Promise<void> {
  validateAiCatalog();
  await database.transaction(async (transaction) => {
    await transaction
      .update(aiProviderModels)
      .set({ enabled: false, updatedAt: new Date() })
      .where(and(isNull(aiProviderModels.connectionId), isNull(aiProviderModels.ownerUserId)));
    for (const model of AI_MODEL_CATALOG) {
      await transaction
        .insert(aiProviderModels)
        .values({
          ...model,
          tasks: [...model.tasks],
          connectionId: null,
          ownerUserId: null,
          enabled: true,
        })
        .onConflictDoUpdate({
          target: aiProviderModels.id,
          set: {
            provider: model.provider,
            providerModelId: model.providerModelId,
            displayName: model.displayName,
            capabilities: model.capabilities,
            tasks: [...model.tasks],
            enabled: true,
            updatedAt: new Date(),
          },
        });
    }
  });
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  if (process.argv.includes("--dry-run")) {
    validateAiCatalog();
    console.info(`Validated ${AI_MODEL_CATALOG.length} AI catalog models.`);
  } else {
    withScriptDatabase(process.env, seedAiCatalog)
      .then(() => {
        console.info(`Seeded ${AI_MODEL_CATALOG.length} AI catalog models.`);
      })
      .catch((error: unknown) => {
        console.error("AI catalog seeding failed.", error);
        process.exitCode = 1;
      });
  }
}
