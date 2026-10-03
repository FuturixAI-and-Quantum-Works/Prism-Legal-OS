import { and, desc, eq } from "drizzle-orm";
import {
  db,
  documentEdits,
  documentPlaceholderValues,
  documents,
  documentVersions,
  type Database,
} from "../../db/index.js";

export class DocumentPlaceholdersRepository {
  constructor(private readonly database: Database = db) {}

  async findDocument(documentId: string) {
    const [document] = await this.database
      .select({
        id: documents.id,
        filename: documents.filename,
        fileType: documents.fileType,
        userId: documents.userId,
        projectId: documents.projectId,
      })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    return document ?? null;
  }

  async findActiveVersion(documentId: string) {
    const [document] = await this.database
      .select({ currentVersionId: documents.currentVersionId })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    if (!document?.currentVersionId) return null;
    const [version] = await this.database
      .select({
        id: documentVersions.id,
        storagePath: documentVersions.storagePath,
        versionNumber: documentVersions.versionNumber,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.id, document.currentVersionId),
          eq(documentVersions.documentId, documentId),
        ),
      )
      .limit(1);
    return version ?? null;
  }

  async valuesByKey(documentId: string): Promise<Map<string, string>> {
    const rows = await this.database
      .select({
        fieldKey: documentPlaceholderValues.fieldKey,
        value: documentPlaceholderValues.value,
      })
      .from(documentPlaceholderValues)
      .where(eq(documentPlaceholderValues.documentId, documentId));
    return new Map(rows.map((row) => [row.fieldKey, row.value]));
  }

  async saveValues(
    documentId: string,
    userId: string,
    values: Readonly<Record<string, string>>,
  ): Promise<void> {
    for (const [fieldKey, value] of Object.entries(values)) {
      const [existing] = await this.database
        .select({ id: documentPlaceholderValues.id })
        .from(documentPlaceholderValues)
        .where(
          and(
            eq(documentPlaceholderValues.documentId, documentId),
            eq(documentPlaceholderValues.fieldKey, fieldKey),
          ),
        )
        .limit(1);
      if (existing) {
        await this.database
          .update(documentPlaceholderValues)
          .set({ value, updatedByUserId: userId, updatedAt: new Date() })
          .where(eq(documentPlaceholderValues.id, existing.id));
      } else {
        await this.database.insert(documentPlaceholderValues).values({
          documentId,
          fieldKey,
          value,
          createdByUserId: userId,
          updatedByUserId: userId,
        });
      }
    }
  }

  listEdits(documentId: string, status: string | null) {
    const conditions = [eq(documentEdits.documentId, documentId)];
    if (status) conditions.push(eq(documentEdits.status, status));
    return this.database
      .select({
        id: documentEdits.id,
        documentId: documentEdits.documentId,
        versionId: documentEdits.versionId,
        versionNumber: documentVersions.versionNumber,
        changeId: documentEdits.changeId,
        delWId: documentEdits.delWId,
        insWId: documentEdits.insWId,
        deletedText: documentEdits.deletedText,
        insertedText: documentEdits.insertedText,
        contextBefore: documentEdits.contextBefore,
        contextAfter: documentEdits.contextAfter,
        reason: documentEdits.reason,
        status: documentEdits.status,
      })
      .from(documentEdits)
      .leftJoin(documentVersions, eq(documentEdits.versionId, documentVersions.id))
      .where(and(...conditions))
      .orderBy(desc(documentEdits.createdAt));
  }
}
