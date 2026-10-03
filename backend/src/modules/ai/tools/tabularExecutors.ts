import type { ToolExecutionContext, ToolExecutorResult } from "./types.js";

export type TabularCell = {
  summary: string;
  flag?: string;
  reasoning?: string;
};

export type TabularCellStore = {
  columns: { index: number; name: string }[];
  documents: { id: string; filename: string }[];
  cells: Map<string, TabularCell | null>;
};

export function createEmptyTabularCellStore(): TabularCellStore {
  return { columns: [], documents: [], cells: new Map() };
}

export function readTableCells(
  store: TabularCellStore,
  selection: { columnIndices?: number[]; rowIndices?: number[] },
): { label: string; content: string } {
  const columns = selection.columnIndices?.length
    ? store.columns.filter((_, index) => selection.columnIndices?.includes(index))
    : store.columns;
  const documents = selection.rowIndices?.length
    ? store.documents.filter((_, index) => selection.rowIndices?.includes(index))
    : store.documents;
  const label = `${columns.length} ${columns.length === 1 ? "column" : "columns"} × ${documents.length} ${documents.length === 1 ? "row" : "rows"}`;
  const lines: string[] = [];
  for (const column of columns) {
    const columnPosition = store.columns.findIndex((candidate) => candidate.index === column.index);
    for (const document of documents) {
      const rowPosition = store.documents.findIndex((candidate) => candidate.id === document.id);
      const cell = store.cells.get(`${column.index}:${document.id}`);
      lines.push(
        `[COL:${columnPosition} "${column.name}" | ROW:${rowPosition} "${document.filename}"]`,
      );
      if (cell?.summary) {
        lines.push(`Summary: ${cell.summary}`);
        if (cell.flag) lines.push(`Flag: ${cell.flag}`);
        if (cell.reasoning) lines.push(`Reasoning: ${cell.reasoning}`);
      } else {
        lines.push("(not yet generated)");
      }
    }
    lines.push("");
  }
  return { label, content: lines.join("\n") || "No cells found." };
}

export async function executeReadTableCells(
  context: ToolExecutionContext,
  input: { col_indices?: number[]; row_indices?: number[] },
): Promise<ToolExecutorResult> {
  const { label, content } = readTableCells(context.tabular, {
    columnIndices: input.col_indices,
    rowIndices: input.row_indices,
  });
  context.write({ type: "doc_read_start", filename: label });
  context.write({ type: "doc_read", filename: label });
  context.events.docsRead.push({ filename: label });
  return { output: content, content };
}
