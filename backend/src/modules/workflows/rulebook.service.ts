import type { ContentTextService } from "../content/contentText.service.js";
import type { RulebookRepository } from "./rulebook.repository.js";
import { WorkflowError, type WorkflowActor } from "./workflows.types.js";

const FORMATS = [
  "text",
  "bulleted_list",
  "number",
  "currency",
  "yes_no",
  "date",
  "tag",
  "percentage",
] as const;

type ColumnFormat = (typeof FORMATS)[number];
type Severity = "info" | "warning" | "error";

type GeneratedFaq = Readonly<{
  id: string;
  question: string;
  column_name: string;
  prompt: string;
  format: ColumnFormat;
  category: string;
  severity: Severity;
  rationale: string;
  tags?: readonly string[];
}>;

export type GenerateRulebookInput = Readonly<{
  documentType: string;
  sampleDocumentId?: string;
  extraRequirements: string;
  count: number;
}>;

type RulebookDocumentAccess = Readonly<{
  canReadDocument: (documentId: string, actor: WorkflowActor) => Promise<boolean>;
}>;

type RulebookAi = Readonly<{
  complete(input: {
    actor: WorkflowActor;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<string>;
}>;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeFormat(value: unknown): ColumnFormat {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const format = FORMATS.find((candidate) => candidate === normalized);
  if (format) return format;
  if (normalized === "boolean" || normalized === "yes/no") return "yes_no";
  if (normalized === "list" || normalized === "bullets") return "bulleted_list";
  if (normalized === "money" || normalized === "monetary_amount") return "currency";
  return "text";
}

function normalizeSeverity(value: unknown): Severity {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["error", "high", "critical"].includes(normalized)) return "error";
  if (normalized === "warning" || normalized === "medium") return "warning";
  return "info";
}

function normalizeTags(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value
    .flatMap((tag) => (typeof tag === "string" && tag.trim() ? [tag.trim()] : []))
    .slice(0, 12);
  return tags.length > 0 ? tags : undefined;
}

function shortColumnName(question: string, index: number): string {
  const compact = question
    .replace(/\?+$/, "")
    .replace(/^(does|do|did|is|are|was|were|has|have|should|must|can)\s+/i, "")
    .trim();
  const words = compact.split(/\s+/).slice(0, 6).join(" ");
  if (!words) return `Check ${index + 1}`;
  return words.length > 70 ? `${words.slice(0, 67)}...` : words;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function parseDraft(raw: string, count: number): { title: string; faqs: GeneratedFaq[] } {
  const trimmed = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  const payload: unknown = JSON.parse(
    first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed,
  );
  const root = record(payload);
  const rawFaqs = root?.faqs;
  const faqs = Array.isArray(rawFaqs)
    ? rawFaqs.flatMap((value, index): GeneratedFaq[] => {
        const faq = record(value);
        const question = text(faq?.question);
        const prompt = text(faq?.prompt, question);
        if (!question || !prompt) return [];
        const tags = normalizeTags(faq?.tags);
        return [
          {
            id: `rule-${Date.now()}-${index}`,
            question,
            column_name: text(
              faq?.column_name ?? faq?.columnName,
              shortColumnName(question, index),
            ),
            prompt,
            format: normalizeFormat(faq?.format),
            category: text(faq?.category, "General"),
            severity: normalizeSeverity(faq?.severity),
            rationale: text(faq?.rationale),
            ...(tags ? { tags } : {}),
          },
        ];
      })
    : [];
  return { title: text(root?.title), faqs: faqs.slice(0, count) };
}

function columns(faqs: readonly GeneratedFaq[]) {
  return faqs.map((faq, index) => ({
    id: faq.id,
    index,
    name: faq.column_name,
    prompt: faq.prompt,
    format: faq.format,
    tags: faq.tags,
    width: 260,
    question: faq.question,
    category: faq.category,
    severity: faq.severity,
    rationale: faq.rationale,
  }));
}

export class RulebookDraftService {
  constructor(
    private readonly repository: RulebookRepository,
    private readonly documents: RulebookDocumentAccess,
    private readonly content: ContentTextService,
    private readonly ai: RulebookAi,
  ) {}

  async generate(actor: WorkflowActor, input: GenerateRulebookInput) {
    const sample = input.sampleDocumentId
      ? await this.loadSample(actor, input.sampleDocumentId)
      : null;
    const sampleText = sample?.text.trim()
      ? `\n\nSample document filename: ${sample.document.filename}\n\nSample document text:\n${sample.text.slice(0, 80_000)}`
      : sample
        ? `\n\nSample document filename: ${sample.document.filename}\n\nNo extractable sample text was available. Generate from the document type and instructions.`
        : "";
    const raw = await this.ai.complete({
      actor,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Document type: ${input.documentType}
Desired number of compliance questions: ${input.count}
${input.extraRequirements ? `Extra user requirements:\n${input.extraRequirements}` : "Extra user requirements: none"}${sampleText}

Generate reusable compliance questions for a tabular legal review of this document type. Each question must be suitable both as a human checklist item and as one tabular-review column. Focus on concrete checks a lawyer would want answered against the document text.`,
    });
    const draft = parseDraft(raw, input.count);
    if (draft.faqs.length === 0) {
      throw new WorkflowError(502, "The model did not return usable rulebook questions");
    }
    return {
      title: draft.title || `${input.documentType} Compliance Rulebook`,
      document_type: input.documentType,
      sample_document: sample
        ? { id: sample.document.id, filename: sample.document.filename }
        : null,
      faqs: draft.faqs,
      columns_config: columns(draft.faqs),
      source: "llm",
    };
  }

  private async loadSample(actor: WorkflowActor, documentId: string) {
    const document = (await this.documents.canReadDocument(documentId, actor))
      ? await this.repository.findSampleDocument(documentId)
      : null;
    if (!document) throw new WorkflowError(404, "Sample document not found");
    const extracted = await this.content.extract({
      kind: "document",
      id: document.id,
      fileType: document.fileType,
    });
    return { document, text: extracted };
  }
}

const SYSTEM_PROMPT = `You create legal compliance rulebooks for document review. Return ONLY valid JSON with this exact shape:
{
  "title": "Short rulebook title",
  "faqs": [
    {
      "question": "Human-readable compliance question ending with ?",
      "column_name": "Short tabular column name",
      "prompt": "Precise instruction for an AI legal reviewer checking the document.",
      "format": "text|bulleted_list|number|currency|yes_no|date|tag|percentage",
      "category": "Short category",
      "severity": "info|warning|error",
      "rationale": "Why this check matters",
      "tags": []
    }
  ]
}
Avoid duplicate checks. Prefer yes_no for binary compliance checks. Use text or bulleted_list when the answer needs detail.`;
