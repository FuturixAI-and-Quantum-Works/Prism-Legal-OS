import type { DocIndex, DocStore } from "./runtimeTypes.js";

export type TurnEditState = Map<
  string,
  { versionId: string; versionNumber: number; storagePath: string }
>;

export function registerCreatedDocumentInTurn(
  docIndex: DocIndex | undefined,
  docStore: DocStore,
  input: {
    documentId?: string | null;
    filename?: string | null;
    storagePath?: string | null;
    fileType?: string | null;
    versionId?: string | null;
    versionNumber?: number | null;
  },
): string | null {
  const { documentId, filename, storagePath } = input;
  if (!documentId || !filename || !storagePath || !docIndex) return null;
  const existingLabels = new Set(Object.keys(docIndex));
  let index = 0;
  while (existingLabels.has(`doc-${index}`)) index += 1;
  const label = `doc-${index}`;
  docIndex[label] = {
    document_id: documentId,
    filename,
    version_id: input.versionId ?? null,
    version_number: input.versionNumber ?? null,
  };
  docStore.set(label, {
    storage_path: storagePath,
    file_type: input.fileType ?? "docx",
    filename,
  });
  return label;
}
