import { randomUUID } from "node:crypto";
import path from "node:path";
import { DOCX_TEMPLATE_MIME, fillDocxTemplate } from "../../lib/docxTemplateAnalyzer.js";
import type { AccessAuthority } from "../access/access.authority.js";
import type { DocumentDto } from "../documents/documents.models.js";
import type { TemplatesAuthorizationPolicy } from "./templates.policy.js";
import type { TemplatesRepository } from "./templates.repository.js";
import type { TemplateStorageCoordinator } from "./templates.storage.js";
import {
  TemplateError,
  type CreateTemplateDocumentInput,
  type CreateTemplateInput,
  type Template,
  type TemplateActor,
  type TemplateListType,
  type UpdateTemplateInput,
} from "./templates.types.js";

type DocumentCreator = Readonly<{
  createBlank(
    actor: TemplateActor,
    input: {
      filename: string;
      contentHtml: string;
      projectId: string | null;
      workspaceId: string | null;
      folderId: string | null;
      isPrimary?: boolean;
    },
  ): Promise<DocumentDto>;
  createFromBuffer(
    actor: TemplateActor,
    input: {
      filename: string;
      buffer: Buffer;
      projectId: string | null;
      workspaceId: string | null;
      folderId: string | null;
      isPrimary?: boolean;
    },
  ): Promise<DocumentDto>;
}>;

type TemplateField = Readonly<{ id: string; label: string; required: boolean }>;

function templateFields(value: unknown): readonly TemplateField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): TemplateField[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const field = Object.fromEntries(Object.entries(raw));
    const source = field.id ?? field.key ?? field.placeholder;
    if (typeof source !== "string" || !source.trim()) return [];
    const match = source.trim().match(/^\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}$/);
    const id = match?.[1] ?? source.trim();
    const label = typeof field.label === "string" && field.label.trim() ? field.label.trim() : id;
    return [{ id, label, required: field.required !== false }];
  });
}

function renderHtml(content: string, values: Readonly<Record<string, string>>): string {
  let rendered = content;
  for (const [key, value] of Object.entries(values)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rendered = rendered.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, "g"), value);
  }
  return rendered;
}

function isDocx(template: Template): boolean {
  return (
    template.sourceMimeType === DOCX_TEMPLATE_MIME ||
    template.sourceFilename?.toLowerCase().endsWith(".docx") === true
  );
}

export class TemplatesService {
  constructor(
    private readonly repository: TemplatesRepository,
    private readonly policy: TemplatesAuthorizationPolicy,
    private readonly authority: AccessAuthority,
    private readonly storage: TemplateStorageCoordinator,
    private readonly documents: DocumentCreator,
  ) {}

  async list(actor: TemplateActor, type: TemplateListType): Promise<readonly Template[]> {
    const grants = await this.authority.grants.listTemplateGrants({
      userId: actor.userId,
      email: "",
    });
    return this.repository.list([...grants.keys()], type);
  }

  get(actor: TemplateActor, templateId: string): Promise<Template> {
    return this.policy.requireAccessible(templateId, actor.userId);
  }

  create(actor: TemplateActor, input: CreateTemplateInput): Promise<Template> {
    return this.repository.create(actor.userId, input);
  }

  async update(actor: TemplateActor, templateId: string, input: UpdateTemplateInput) {
    await this.policy.requireOwned(templateId, actor.userId, "Template not found or not editable");
    const template = await this.repository.updateOwned(templateId, actor.userId, input);
    if (!template) throw new TemplateError(404, "Template not found or not editable");
    return template;
  }

  async remove(actor: TemplateActor, templateId: string): Promise<void> {
    const template = await this.policy.requireOwned(
      templateId,
      actor.userId,
      "Template not found or not deletable",
    );
    const commit = async () => {
      const deleted = await this.repository.deleteOwned(templateId, actor.userId);
      if (!deleted) throw new TemplateError(404, "Template not found or not deletable");
    };
    if (!template.sourceStoragePath) return commit();
    await this.storage.deleteThenCommit(
      template.sourceStoragePath,
      template.sourceMimeType ?? "application/octet-stream",
      commit,
    );
  }

  async clone(actor: TemplateActor, templateId: string, customName?: string) {
    const source = await this.policy.requireAccessible(templateId, actor.userId);
    const name = customName?.trim() || `${source.name} (Copy)`;
    if (!source.sourceStoragePath) {
      return this.repository.clone(source, actor.userId, name, null);
    }
    const filename = path.posix.basename(source.sourceFilename ?? "source.docx");
    const destination = `templates/users/${actor.userId}/${randomUUID()}/${filename}`;
    return this.storage.copyThenCommit(
      {
        sourcePath: source.sourceStoragePath,
        destinationPath: destination,
      },
      () => this.repository.clone(source, actor.userId, name, destination),
    );
  }

  async createDocument(
    actor: TemplateActor,
    templateId: string,
    input: CreateTemplateDocumentInput,
  ) {
    const template = await this.policy.requireAccessible(templateId, actor.userId);
    const missing = templateFields(template.fields)
      .filter((field) => field.required && !input.values[field.id]?.trim())
      .map(({ id, label }) => ({ id, label }));
    if (missing.length > 0) {
      throw new TemplateError(
        400,
        `Missing required template fields: ${missing.map(({ label }) => label).join(", ")}`,
        missing,
      );
    }
    const filename =
      input.filename?.trim() ||
      (input.name?.trim() ? `${input.name.trim()}.docx` : `${template.name}.docx`);
    const documentInput = {
      filename,
      projectId: input.projectId ?? null,
      workspaceId: input.workspaceId ?? null,
      folderId: input.folderId ?? null,
      ...(input.isPrimary === undefined ? {} : { isPrimary: input.isPrimary }),
    };
    if (isDocx(template)) {
      if (!template.sourceStoragePath) {
        throw new TemplateError(404, "Template DOCX source is not available");
      }
      const bytes = await this.storage.get(template.sourceStoragePath);
      const filled = await fillDocxTemplate(Buffer.from(bytes), input.values);
      const document = await this.documents.createFromBuffer(actor, {
        ...documentInput,
        buffer: filled.bytes,
      });
      return {
        ...document,
        template_id: template.id,
        template_replacements: filled.replacements,
      };
    }
    const document = await this.documents.createBlank(actor, {
      ...documentInput,
      contentHtml: renderHtml(template.contentHtml, input.values),
    });
    return { ...document, template_id: template.id };
  }
}
