import "../loadEnv.js";
import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "node:url";
import { db, templates } from "../db/index.js";
import {
  analyzeDocxTemplate,
  DOCX_TEMPLATE_MIME,
  type DocxTemplateAnalysis,
} from "../lib/docxTemplateAnalyzer.js";
import { storageEnabled, uploadFile } from "../lib/storage.js";
import { withScriptApplication } from "./database.js";

export interface DocxTemplateImport {
  key: string;
  category: string;
  sourceLabel: string;
}

export const DOCX_TEMPLATE_IMPORT = {
  key: "operator",
  category: "Operator DOCX Templates",
  sourceLabel: "Operator-supplied",
} as const;

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function displayNameFromFilename(filename: string): string {
  return path
    .basename(filename, path.extname(filename))
    .replace(/^\d+[_\s-]+/, "")
    .replace(/[_\s-]*Template$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function descriptionFor(
  filename: string,
  analysis: DocxTemplateAnalysis,
  templateImport: DocxTemplateImport,
): string {
  return [
    `${templateImport.sourceLabel} DOCX template imported from ${filename}.`,
    `${analysis.metadata.placeholders.unique} placeholders, ${analysis.metadata.document.tables} tables.`,
    "Final document generation preserves the original Word formatting.",
  ].join(" ");
}

async function maybeUploadSource(
  buffer: Buffer,
  filename: string,
  checksum: string,
  localPath: string,
) {
  if (!storageEnabled) return toPosixPath(localPath);

  const safeName = filename.replace(/[^\w.-]+/g, "_");
  const storagePath = `templates/system/${checksum.slice(0, 16)}/${safeName}`;
  await uploadFile(storagePath, Uint8Array.from(buffer).buffer, DOCX_TEMPLATE_MIME);
  return storagePath;
}

async function prepareFile(
  fullPath: string,
  rootDir: string,
  uploadSource: boolean,
  templateImport: DocxTemplateImport,
) {
  const filename = path.basename(fullPath);
  const relativePath = toPosixPath(path.relative(process.cwd(), fullPath));
  const buffer = await fs.readFile(fullPath);
  const analysis = await analyzeDocxTemplate(buffer, filename);
  const name = displayNameFromFilename(filename);
  const sourceStoragePath = uploadSource
    ? await maybeUploadSource(buffer, filename, analysis.metadata.source.checksum, relativePath)
    : relativePath;
  const sourceMetadata = {
    ...analysis.metadata,
    seed: {
      directory: toPosixPath(path.relative(process.cwd(), rootDir)),
      localPath: relativePath,
    },
  };

  return {
    stableKey: `docx-${templateImport.key}-${filename
      .toLowerCase()
      .replace(/\.docx$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`,
    userId: null,
    name,
    category: templateImport.category,
    description: descriptionFor(filename, analysis, templateImport),
    contentHtml: analysis.previewHtml,
    fields: analysis.fields,
    sourceFilename: filename,
    sourceStoragePath,
    sourceMimeType: DOCX_TEMPLATE_MIME,
    sourceChecksum: analysis.metadata.source.checksum,
    sourceMetadata,
    isCreatedByUser: false,
    updatedAt: new Date(),
  } as const;
}

async function prepareDocxTemplatePack(
  requestedDir: string,
  templateImport: DocxTemplateImport,
  uploadSource: boolean,
) {
  const rootDir = path.resolve(process.cwd(), requestedDir);
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".docx"))
    .map((entry) => path.join(rootDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const prepared: Awaited<ReturnType<typeof prepareFile>>[] = [];
  for (const file of files) {
    prepared.push(await prepareFile(file, rootDir, uploadSource, templateImport));
  }
  if (new Set(prepared.map(({ stableKey }) => stableKey)).size !== prepared.length) {
    throw new Error(`DOCX template pack ${requestedDir} contains duplicate stable keys`);
  }
  return prepared;
}

export async function loadDocxTemplatePack(
  requestedDir: string,
  templateImport: DocxTemplateImport = DOCX_TEMPLATE_IMPORT,
) {
  return prepareDocxTemplatePack(requestedDir, templateImport, false);
}

export async function validateDocxTemplatePack(
  requestedDir: string,
  templateImport: DocxTemplateImport = DOCX_TEMPLATE_IMPORT,
): Promise<number> {
  return (await loadDocxTemplatePack(requestedDir, templateImport)).length;
}

export async function seedDocxTemplates(
  requestedDir: string,
  templateImport: DocxTemplateImport = DOCX_TEMPLATE_IMPORT,
): Promise<number> {
  const prepared = await prepareDocxTemplatePack(requestedDir, templateImport, true);

  await db.transaction(async (transaction) => {
    for (const values of prepared) {
      await transaction.insert(templates).values(values).onConflictDoUpdate({
        target: templates.stableKey,
        set: values,
      });
    }
  });
  return prepared.length;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  const requestedDir = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  if (!requestedDir) {
    console.error(
      "Usage: npm run seed:docx-templates --workspace @prism/backend -- [--dry-run] <directory>",
    );
    process.exitCode = 1;
  } else {
    const command = process.argv.includes("--dry-run")
      ? validateDocxTemplatePack(requestedDir)
      : withScriptApplication(process.env, () => seedDocxTemplates(requestedDir));
    command
      .then((count) => {
        console.info(
          `${process.argv.includes("--dry-run") ? "Validated" : "Seeded"} ${count} DOCX templates.`,
        );
      })
      .catch((error: unknown) => {
        console.error("DOCX template seeding failed.", error);
        process.exitCode = 1;
      });
  }
}
