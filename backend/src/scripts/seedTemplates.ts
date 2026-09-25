import "../loadEnv.js";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { db, templates } from "../db/index.js";
import { withScriptDatabase } from "./database.js";
import {
  loadTemplateSeedPacks,
  type TemplateConfig,
  type TemplateField,
} from "./templateSeedPacks.js";

export type { TemplateConfig, TemplateField };

const loadedSeedPacks = loadTemplateSeedPacks();

export const TEMPLATE_SEED_PACKS = loadedSeedPacks.packs;
export const CORE_TEMPLATES: readonly TemplateConfig[] = loadedSeedPacks.templates;

export function validateCoreTemplates(): void {
  loadTemplateSeedPacks();
}

export async function seedTemplates(): Promise<void> {
  validateCoreTemplates();

  await db.transaction(async (transaction) => {
    for (const template of CORE_TEMPLATES) {
      const values = {
        stableKey: `core-${template.id}`,
        userId: null,
        name: template.name,
        category: template.category,
        description: template.description,
        contentHtml: template.templateContent.trim(),
        fields: template.fields,
        isCreatedByUser: false,
        updatedAt: new Date(),
      } as const;

      await transaction.insert(templates).values(values).onConflictDoUpdate({
        target: templates.stableKey,
        set: values,
      });
    }
  });
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  if (process.argv.includes("--dry-run")) {
    validateCoreTemplates();
    console.info(`Validated ${CORE_TEMPLATES.length} core templates.`);
  } else {
    withScriptDatabase(process.env, seedTemplates)
      .then(() => {
        console.info(`Seeded ${CORE_TEMPLATES.length} core templates.`);
      })
      .catch((error: unknown) => {
        console.error("Template seeding failed.", error);
        process.exitCode = 1;
      });
  }
}
