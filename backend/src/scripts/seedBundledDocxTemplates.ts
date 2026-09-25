import "../loadEnv.js";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withScriptApplication } from "./database.js";
import {
  seedDocxTemplates,
  validateDocxTemplatePack,
  type DocxTemplateImport,
} from "./seedDocxTemplates.js";

export const BUNDLED_DOCX_DIRECTORY = fileURLToPath(
  new URL("../../data/seed-packs/docx/v1/futurixai-legal/", import.meta.url),
);

export const BUNDLED_DOCX_IMPORT = {
  key: "futurixai-legal",
  category: "FuturixAI Legal Templates",
  sourceLabel: "FuturixAI-owned",
} as const satisfies DocxTemplateImport;

export async function validateBundledDocxTemplates(): Promise<number> {
  const count = await validateDocxTemplatePack(BUNDLED_DOCX_DIRECTORY, BUNDLED_DOCX_IMPORT);
  if (count !== 54) {
    throw new Error(`Expected 54 bundled DOCX templates, found ${count}`);
  }
  return count;
}

export async function seedBundledDocxTemplates(): Promise<number> {
  await validateBundledDocxTemplates();
  return seedDocxTemplates(BUNDLED_DOCX_DIRECTORY, BUNDLED_DOCX_IMPORT);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  const dryRun = process.argv.includes("--dry-run");
  const command = dryRun
    ? validateBundledDocxTemplates()
    : withScriptApplication(process.env, seedBundledDocxTemplates);
  command
    .then((count) => {
      console.info(`${dryRun ? "Validated" : "Seeded"} ${count} bundled DOCX templates.`);
    })
    .catch((error: unknown) => {
      console.error("Bundled DOCX template seeding failed.", error);
      process.exitCode = 1;
    });
}
