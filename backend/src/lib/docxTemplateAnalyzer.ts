import crypto from "crypto";
import { XMLParser } from "fast-xml-parser";
import { withDocxPackage } from "../modules/content/documentContent.js";

type XNode = Record<string, unknown>;

const ATTR_KEY = ":@";
const TEXT_KEY = "#text";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const WORD_CONTENT_PART_RE =
  /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/i;

export type DocxTemplateFieldType =
  "text" | "textarea" | "date" | "number" | "email" | "phone" | "address";

export interface DocxTemplateField {
  id: string;
  label: string;
  placeholder: string;
  type: DocxTemplateFieldType;
  required: boolean;
  occurrences: number;
}

export interface DocxTemplateAnalysis {
  fields: DocxTemplateField[];
  previewHtml: string;
  metadata: {
    source: {
      filename: string;
      mimeType: string;
      checksum: string;
      sizeBytes: number;
    };
    placeholders: {
      unique: number;
      occurrences: number;
      rawXmlOccurrences: number;
      splitAcrossXml: number;
      keys: string[];
    };
    document: {
      paragraphs: number;
      tables: number;
      rows: number;
      cells: number;
      alignments: string[];
      paragraphStyles: string[];
      indentationSamples: Record<string, string>[];
      typography: {
        fonts: string[];
        fontSizesHalfPoints: string[];
        boldRuns: number;
        italicRuns: number;
        underlineRuns: number;
      };
      tableSummaries: Array<{
        index: number;
        rows: number;
        cellCounts: number[];
      }>;
    };
  };
}

export interface FilledDocxTemplate {
  bytes: Buffer;
  replacements: Record<string, number>;
}

function isWordContentPart(path: string): boolean {
  return WORD_CONTENT_PART_RE.test(path);
}

function createParser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
    trimValues: false,
    parseAttributeValue: false,
    processEntities: true,
  });
}

function isXNode(value: unknown): value is XNode {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseXml(xml: string): XNode[] {
  const value: unknown = createParser().parse(xml);
  return Array.isArray(value) ? value.filter(isXNode) : [];
}

function elName(node: unknown): string | null {
  if (!isXNode(node)) return null;
  for (const key of Object.keys(node)) {
    if (key === ATTR_KEY || key === TEXT_KEY) continue;
    return key;
  }
  return null;
}

function elChildren(node: unknown): XNode[] {
  const name = elName(node);
  if (!name || !isXNode(node)) return [];
  const value = node[name];
  return Array.isArray(value) ? value.filter(isXNode) : [];
}

function elAttrs(node: unknown): Record<string, string> {
  if (!isXNode(node)) return {};
  const attrs = node[ATTR_KEY];
  if (!isXNode(attrs)) return {};
  return Object.fromEntries(
    Object.entries(attrs).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function firstChild(node: unknown, name: string): XNode | null {
  return elChildren(node).find((child) => elName(child) === name) ?? null;
}

function findAll(nodes: XNode[], predicate: (node: XNode) => boolean, out: XNode[] = []): XNode[] {
  for (const node of nodes) {
    if (predicate(node)) out.push(node);
    findAll(elChildren(node), predicate, out);
  }
  return out;
}

function textNodeValue(node: unknown): string {
  if (!isXNode(node)) return "";
  const value = node[TEXT_KEY];
  return typeof value === "string" ? value : "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function textFromNodes(nodes: XNode[]): string {
  let out = "";
  const visit = (node: XNode) => {
    const name = elName(node);
    if (!name) {
      out += textNodeValue(node);
      return;
    }
    if (name === "w:t" || name === "w:delText") {
      for (const child of elChildren(node)) out += textNodeValue(child);
      return;
    }
    if (name === "w:tab") {
      out += "\t";
      return;
    }
    if (name === "w:br" || name === "w:cr") {
      out += "\n";
      return;
    }
    for (const child of elChildren(node)) visit(child);
  };

  for (const node of nodes) visit(node);
  return out;
}

function plainTextFromXml(xml: string): string {
  return textFromNodes(parseXml(xml));
}

function extractPlaceholderKeys(text: string): string[] {
  const keys: string[] = [];
  const regex = /\{\{\s*([^{}\r\n]+?)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const key = match[1]?.trim();
    if (key) keys.push(key);
  }
  return keys;
}

function templateFieldLabel(key: string): string {
  const knownAbbreviations = new Set([
    "AGM",
    "CIN",
    "CS",
    "DIN",
    "DT",
    "EGM",
    "FRN",
    "FY",
    "GSTIN",
    "INR",
    "NO",
    "OR",
    "PAN",
    "PB",
    "PIN",
    "REGD",
    "SHR",
    "SR",
    "TAN",
  ]);

  return key
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => {
      const upper = word.toUpperCase();
      if (knownAbbreviations.has(upper)) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function templateFieldType(key: string): DocxTemplateFieldType {
  if (/EMAIL/i.test(key)) return "email";
  if (/PHONE|MOBILE|TEL/i.test(key)) return "phone";
  if (/ADDRESS/i.test(key)) return "address";
  if (/(DATE|_DT|DT$)/i.test(key)) return "date";
  if (/(AMOUNT|INR|PERCENT|SHARE|MEMBER|TOTAL|LIMIT|VALUE|NO|NUMBER|COUNT|CAPITAL)/i.test(key)) {
    return "number";
  }
  if (/(TEXT|DESCRIPTION|PROVISIONS|RESOLUTION|SUBJECT|CREDENTIALS|WORDS|VENUE)/i.test(key)) {
    return "textarea";
  }
  return "text";
}

function fieldsFromKeys(keys: string[]): DocxTemplateField[] {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);

  const seen = new Set<string>();
  const fields: DocxTemplateField[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push({
      id: key,
      label: templateFieldLabel(key),
      placeholder: `{{${key}}}`,
      type: templateFieldType(key),
      required: true,
      occurrences: counts.get(key) ?? 1,
    });
  }
  return fields;
}

function styleObjectToString(style: Record<string, string | number | undefined>): string {
  return Object.entries(style)
    .filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "",
    )
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
}

function twipsToPt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return `${Math.round((parsed / 20) * 100) / 100}pt`;
}

function paragraphStyle(node: XNode): Record<string, string | undefined> {
  const pPr = firstChild(node, "w:pPr");
  const style: Record<string, string | undefined> = {
    margin: "0 0 8pt 0",
  };
  if (!pPr) return style;

  const jc = firstChild(pPr, "w:jc");
  const jcValue = jc ? elAttrs(jc)["@_w:val"] : undefined;
  if (jcValue) {
    style["text-align"] = jcValue === "both" ? "justify" : jcValue;
  }

  const ind = firstChild(pPr, "w:ind");
  if (ind) {
    const attrs = elAttrs(ind);
    style["margin-left"] = twipsToPt(attrs["@_w:left"]);
    style["margin-right"] = twipsToPt(attrs["@_w:right"]);
    style["text-indent"] = twipsToPt(attrs["@_w:firstLine"]);
    if (!style["text-indent"] && attrs["@_w:hanging"]) {
      const hanging = twipsToPt(attrs["@_w:hanging"]);
      if (hanging) style["text-indent"] = `-${hanging}`;
    }
  }

  const spacing = firstChild(pPr, "w:spacing");
  if (spacing) {
    const attrs = elAttrs(spacing);
    style["margin-top"] = twipsToPt(attrs["@_w:before"]);
    style["margin-bottom"] = twipsToPt(attrs["@_w:after"]);
    if (attrs["@_w:line"]) {
      const line = Number.parseInt(attrs["@_w:line"], 10);
      if (Number.isFinite(line))
        style["line-height"] = String(Math.round((line / 240) * 100) / 100);
    }
  }

  return style;
}

function runStyle(node: XNode): Record<string, string | undefined> {
  const rPr = firstChild(node, "w:rPr");
  const style: Record<string, string | undefined> = {};
  if (!rPr) return style;

  if (firstChild(rPr, "w:b")) style["font-weight"] = "700";
  if (firstChild(rPr, "w:i")) style["font-style"] = "italic";
  if (firstChild(rPr, "w:u")) style["text-decoration"] = "underline";

  const size = firstChild(rPr, "w:sz");
  const sizeVal = size ? elAttrs(size)["@_w:val"] : undefined;
  if (sizeVal) {
    const parsed = Number.parseInt(sizeVal, 10);
    if (Number.isFinite(parsed)) style["font-size"] = `${parsed / 2}pt`;
  }

  const color = firstChild(rPr, "w:color");
  const colorVal = color ? elAttrs(color)["@_w:val"] : undefined;
  if (colorVal && colorVal !== "auto") style.color = `#${colorVal}`;

  const font = firstChild(rPr, "w:rFonts");
  const fontVal = font ? (elAttrs(font)["@_w:ascii"] ?? elAttrs(font)["@_w:hAnsi"]) : undefined;
  if (fontVal) style["font-family"] = `"${fontVal}"`;

  return style;
}

function renderRun(node: XNode): string {
  const chunks: string[] = [];
  for (const child of elChildren(node)) {
    const name = elName(child);
    if (name === "w:t" || name === "w:delText") {
      chunks.push(escapeHtml(textFromNodes([child])));
    } else if (name === "w:tab") {
      chunks.push('<span style="display: inline-block; width: 32px"></span>');
    } else if (name === "w:br" || name === "w:cr") {
      chunks.push("<br />");
    }
  }

  const inner = chunks.join("");
  if (!inner) return "";
  const style = styleObjectToString(runStyle(node));
  return style ? `<span style="${style}">${inner}</span>` : inner;
}

function renderParagraph(node: XNode): string {
  const content = elChildren(node)
    .map((child) => (elName(child) === "w:r" ? renderRun(child) : ""))
    .join("");
  const style = styleObjectToString(paragraphStyle(node));
  return `<p${style ? ` style="${style}"` : ""}>${content || "&nbsp;"}</p>`;
}

function cellStyle(node: XNode): Record<string, string | undefined> {
  const tcPr = firstChild(node, "w:tcPr");
  const style: Record<string, string | undefined> = {
    border: "1px solid #444",
    padding: "4pt 6pt",
    "vertical-align": "top",
  };
  if (!tcPr) return style;
  const width = firstChild(tcPr, "w:tcW");
  const widthVal = width ? elAttrs(width)["@_w:w"] : undefined;
  const widthPt = twipsToPt(widthVal);
  if (widthPt) style.width = widthPt;
  const vAlign = firstChild(tcPr, "w:vAlign");
  const vAlignVal = vAlign ? elAttrs(vAlign)["@_w:val"] : undefined;
  if (vAlignVal) style["vertical-align"] = vAlignVal === "center" ? "middle" : vAlignVal;
  return style;
}

function renderTable(node: XNode): string {
  const rows = elChildren(node)
    .filter((child) => elName(child) === "w:tr")
    .map((row) => {
      const cells = elChildren(row)
        .filter((child) => elName(child) === "w:tc")
        .map((cell) => {
          const style = styleObjectToString(cellStyle(cell));
          const inner = elChildren(cell)
            .map((child) => renderBlockNode(child))
            .join("");
          return `<td${style ? ` style="${style}"` : ""}>${inner || "&nbsp;"}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table style="width: 100%; border-collapse: collapse; margin: 8pt 0">${rows}</table>`;
}

function renderBlockNode(node: XNode): string {
  const name = elName(node);
  if (name === "w:p") return renderParagraph(node);
  if (name === "w:tbl") return renderTable(node);
  if (name === "w:sdt" || name === "w:sdtContent") {
    return elChildren(node)
      .map((child) => renderBlockNode(child))
      .join("");
  }
  return "";
}

function renderPreviewHtml(documentXml: string): string {
  const tree = parseXml(documentXml);
  const body = findAll(tree, (node) => elName(node) === "w:body")[0];
  const blocks = (body ? elChildren(body) : tree).map((node) => renderBlockNode(node)).join("");
  return `<div style="font-family: 'Times New Roman', serif; color: #111; line-height: 1.35">${blocks}</div>`;
}

export async function renderDocxPreviewHtml(buffer: Buffer): Promise<string> {
  return withDocxPackage({ bytes: buffer }, async (docx) =>
    renderPreviewHtml(await docx.readXml(docx.documentPath)),
  );
}

function collectDocumentMetadata(
  documentXml: string,
): DocxTemplateAnalysis["metadata"]["document"] {
  const tree = parseXml(documentXml);
  const paragraphs = findAll(tree, (node) => elName(node) === "w:p");
  const tables = findAll(tree, (node) => elName(node) === "w:tbl");
  const rows = findAll(tree, (node) => elName(node) === "w:tr");
  const cells = findAll(tree, (node) => elName(node) === "w:tc");
  const runs = findAll(tree, (node) => elName(node) === "w:r");

  const alignments = new Set<string>();
  const paragraphStyles = new Set<string>();
  const indentationSamples: Record<string, string>[] = [];
  for (const paragraph of paragraphs) {
    const pPr = firstChild(paragraph, "w:pPr");
    if (!pPr) continue;
    const jc = firstChild(pPr, "w:jc");
    if (jc) {
      const value = elAttrs(jc)["@_w:val"];
      if (value) alignments.add(value);
    }
    const pStyle = firstChild(pPr, "w:pStyle");
    if (pStyle) {
      const value = elAttrs(pStyle)["@_w:val"];
      if (value) paragraphStyles.add(value);
    }
    const ind = firstChild(pPr, "w:ind");
    if (ind && indentationSamples.length < 20) indentationSamples.push(elAttrs(ind));
  }

  const fonts = new Set<string>();
  const sizes = new Set<string>();
  let boldRuns = 0;
  let italicRuns = 0;
  let underlineRuns = 0;
  for (const run of runs) {
    const rPr = firstChild(run, "w:rPr");
    if (!rPr) continue;
    if (firstChild(rPr, "w:b")) boldRuns += 1;
    if (firstChild(rPr, "w:i")) italicRuns += 1;
    if (firstChild(rPr, "w:u")) underlineRuns += 1;
    const font = firstChild(rPr, "w:rFonts");
    if (font) {
      const attrs = elAttrs(font);
      const value = attrs["@_w:ascii"] ?? attrs["@_w:hAnsi"];
      if (value) fonts.add(value);
    }
    const size = firstChild(rPr, "w:sz");
    if (size) {
      const value = elAttrs(size)["@_w:val"];
      if (value) sizes.add(value);
    }
  }

  const tableSummaries = tables.map((table, index) => {
    const tableRows = elChildren(table).filter((child) => elName(child) === "w:tr");
    return {
      index: index + 1,
      rows: tableRows.length,
      cellCounts: tableRows.map(
        (row) => elChildren(row).filter((child) => elName(child) === "w:tc").length,
      ),
    };
  });

  return {
    paragraphs: paragraphs.length,
    tables: tables.length,
    rows: rows.length,
    cells: cells.length,
    alignments: [...alignments],
    paragraphStyles: [...paragraphStyles],
    indentationSamples,
    typography: {
      fonts: [...fonts],
      fontSizesHalfPoints: [...sizes],
      boldRuns,
      italicRuns,
      underlineRuns,
    },
    tableSummaries,
  };
}

export function checksumBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function analyzeDocxTemplate(
  buffer: Buffer,
  filename: string,
): Promise<DocxTemplateAnalysis> {
  return withDocxPackage({ bytes: buffer }, async (docx) => {
    const contentParts: { path: string; xml: string; text: string }[] = [];
    for (const path of docx.paths) {
      if (!isWordContentPart(path)) continue;
      const xml = await docx.readXml(path);
      contentParts.push({ path, xml, text: plainTextFromXml(xml) });
    }

    const documentPart = contentParts.find((part) => part.path === docx.documentPath);
    if (!documentPart) throw new Error("DOCX is missing word/document.xml");

    const textKeys = contentParts.flatMap((part) => extractPlaceholderKeys(part.text));
    const rawKeys = contentParts.flatMap((part) => extractPlaceholderKeys(part.xml));
    const fields = fieldsFromKeys(textKeys);
    const checksum = checksumBuffer(buffer);

    return {
      fields,
      previewHtml: renderPreviewHtml(documentPart.xml),
      metadata: {
        source: {
          filename,
          mimeType: DOCX_MIME,
          checksum,
          sizeBytes: buffer.byteLength,
        },
        placeholders: {
          unique: fields.length,
          occurrences: textKeys.length,
          rawXmlOccurrences: rawKeys.length,
          splitAcrossXml: Math.max(0, textKeys.length - rawKeys.length),
          keys: fields.map((field) => field.id),
        },
        document: collectDocumentMetadata(documentPart.xml),
      },
    };
  });
}

export async function fillDocxTemplate(
  buffer: Buffer,
  values: Record<string, string>,
): Promise<FilledDocxTemplate> {
  return withDocxPackage({ bytes: buffer }, async (docx) => {
    const replacements: Record<string, number> = {};
    const normalizedValues = new Map(
      Object.entries(values).map(([key, value]) => [key.trim(), String(value ?? "")]),
    );

    for (const path of docx.paths) {
      if (!isWordContentPart(path)) continue;
      const xml = await docx.readXml(path);
      const nextXml = xml.replace(/\{\{\s*([^{}\r\n]+?)\s*\}\}/g, (token, rawKey: string) => {
        const key = rawKey.trim();
        if (!normalizedValues.has(key)) return token;
        replacements[key] = (replacements[key] ?? 0) + 1;
        return escapeXml(normalizedValues.get(key) ?? "");
      });
      if (nextXml !== xml) docx.writeXml(path, nextXml);
    }

    return {
      bytes: await docx.toBuffer(),
      replacements,
    };
  });
}

export const DOCX_TEMPLATE_MIME = DOCX_MIME;
