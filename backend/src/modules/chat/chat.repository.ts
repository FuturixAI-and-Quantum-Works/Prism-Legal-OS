import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  chatMessages,
  chats,
  chatSessions,
  db,
  documentEdits,
  documentVersions,
  type Database,
} from "../../db/index.js";
import type { AccessibleChat, ChatMessage } from "./chat.types.js";

export type StoredMessage = typeof chatMessages.$inferSelect;
export type StoredChat = typeof chats.$inferSelect;

export type SaveMessageInput = Readonly<{
  chatId: string;
  role: "user" | "assistant";
  content: string | null;
  files?: ChatMessage["files"] | null;
  workflow?: ChatMessage["workflow"] | null;
  annotations?: unknown[] | null;
}>;

export interface ChatRepository {
  findChat(chatId: string): Promise<AccessibleChat | null>;
  createChat(input: {
    userId: string;
    sessionId: string | null;
    projectId: string | null;
    workspaceId: string | null;
  }): Promise<AccessibleChat | null>;
  saveMessage(input: SaveMessageInput): Promise<void>;
  setTitle(chatId: string, title: string): Promise<void>;
  listPersonalSessions(userId: string): Promise<unknown[]>;
  createSession(input: {
    userId: string;
    projectId: string | null;
    workspaceId: string | null;
  }): Promise<string>;
  createManagedChat(input: {
    userId: string;
    sessionId: string | null;
    projectId: string | null;
  }): Promise<string>;
  touchSession(sessionId: string): Promise<void>;
  listHydratedMessages(chatId: string): Promise<Record<string, unknown>[]>;
  updateTitle(chatId: string, title: string): Promise<boolean>;
  deleteChat(chatId: string): Promise<void>;
  listWorkspaceChats(workspaceId: string): Promise<
    {
      id: string;
      title: string | null;
      createdAt: Date;
      updatedAt: Date;
    }[]
  >;
}

export class DrizzleChatRepository implements ChatRepository {
  constructor(private readonly database: Database = db) {}

  async findChat(chatId: string): Promise<AccessibleChat | null> {
    const [chat] = await this.database.select().from(chats).where(eq(chats.id, chatId)).limit(1);
    return chat
      ? {
          id: chat.id,
          title: chat.title,
          userId: chat.userId,
          projectId: chat.projectId,
          workspaceId: chat.workspaceId,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
        }
      : null;
  }

  async createChat(input: {
    userId: string;
    sessionId: string | null;
    projectId: string | null;
    workspaceId: string | null;
  }): Promise<AccessibleChat | null> {
    const [chat] = await this.database.insert(chats).values(input).returning({
      id: chats.id,
      title: chats.title,
      userId: chats.userId,
      projectId: chats.projectId,
      workspaceId: chats.workspaceId,
      createdAt: chats.createdAt,
      updatedAt: chats.updatedAt,
    });
    return chat ?? null;
  }

  async saveMessage(input: SaveMessageInput): Promise<void> {
    await this.database.insert(chatMessages).values(input);
  }

  async setTitle(chatId: string, title: string): Promise<void> {
    await this.database.update(chats).set({ title }).where(eq(chats.id, chatId));
  }

  async listPersonalSessions(userId: string): Promise<unknown[]> {
    const sessions = await this.database
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.userId, userId),
          isNull(chatSessions.projectId),
          isNull(chatSessions.workspaceId),
        ),
      )
      .orderBy(desc(chatSessions.updatedAt));
    const sessionIds = sessions.map(({ id }) => id);
    const sessionChats =
      sessionIds.length > 0
        ? await this.database
            .select()
            .from(chats)
            .where(inArray(chats.sessionId, sessionIds))
            .orderBy(desc(chats.createdAt))
        : [];
    const orphanChats = await this.database
      .select()
      .from(chats)
      .where(
        and(
          eq(chats.userId, userId),
          isNull(chats.sessionId),
          isNull(chats.projectId),
          isNull(chats.workspaceId),
        ),
      )
      .orderBy(desc(chats.createdAt));
    const chatsBySession = new Map<string, StoredChat[]>();
    for (const chat of sessionChats) {
      if (!chat.sessionId) continue;
      const grouped = chatsBySession.get(chat.sessionId) ?? [];
      grouped.push(chat);
      chatsBySession.set(chat.sessionId, grouped);
    }
    const result = sessions.map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      chats: chatsBySession.get(session.id) ?? [],
    }));
    for (const chat of orphanChats) {
      result.push({
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        chats: [chat],
      });
    }
    return result.sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
  }

  async createSession(input: {
    userId: string;
    projectId: string | null;
    workspaceId: string | null;
  }): Promise<string> {
    const [session] = await this.database
      .insert(chatSessions)
      .values(input)
      .returning({ id: chatSessions.id });
    if (!session) throw new Error("Failed to create chat session");
    return session.id;
  }

  async createManagedChat(input: {
    userId: string;
    sessionId: string | null;
    projectId: string | null;
  }): Promise<string> {
    const [chat] = await this.database
      .insert(chats)
      .values({ ...input, workspaceId: null })
      .returning({ id: chats.id });
    if (!chat) throw new Error("Failed to create chat");
    return chat.id;
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.database
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));
  }

  async listHydratedMessages(chatId: string): Promise<Record<string, unknown>[]> {
    const messages = await this.database
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId))
      .orderBy(asc(chatMessages.createdAt));
    return this.hydrateEditStatuses(messages);
  }

  async updateTitle(chatId: string, title: string): Promise<boolean> {
    const rows = await this.database
      .update(chats)
      .set({ title })
      .where(eq(chats.id, chatId))
      .returning({ id: chats.id });
    return rows.length === 1;
  }

  async deleteChat(chatId: string): Promise<void> {
    await this.database.delete(chats).where(eq(chats.id, chatId));
  }

  listWorkspaceChats(workspaceId: string) {
    return this.database
      .select({
        id: chats.id,
        title: chats.title,
        createdAt: chats.createdAt,
        updatedAt: chats.updatedAt,
      })
      .from(chats)
      .where(eq(chats.workspaceId, workspaceId))
      .orderBy(chats.updatedAt);
  }

  private async hydrateEditStatuses(messages: StoredMessage[]): Promise<Record<string, unknown>[]> {
    const editIds = new Set<string>();
    const versionIds = new Set<string>();
    const collectAnnotations = (value: unknown): void => {
      if (!Array.isArray(value)) return;
      for (const annotation of value) {
        if (!annotation || typeof annotation !== "object") continue;
        const editId = Reflect.get(annotation, "edit_id");
        const versionId = Reflect.get(annotation, "version_id");
        if (typeof editId === "string") editIds.add(editId);
        if (typeof versionId === "string") versionIds.add(versionId);
      }
    };
    for (const message of messages) {
      collectAnnotations(message.annotations);
      if (!Array.isArray(message.content)) continue;
      for (const event of message.content) {
        if (!event || typeof event !== "object" || Reflect.get(event, "type") !== "doc_edited") {
          continue;
        }
        collectAnnotations(Reflect.get(event, "annotations"));
        const versionId = Reflect.get(event, "version_id");
        if (typeof versionId === "string") versionIds.add(versionId);
      }
    }
    if (editIds.size === 0 && versionIds.size === 0) return messages;

    const statusById = new Map<string, "pending" | "accepted" | "rejected">();
    if (editIds.size > 0) {
      const rows = await this.database
        .select({ id: documentEdits.id, status: documentEdits.status })
        .from(documentEdits)
        .where(inArray(documentEdits.id, [...editIds]));
      for (const row of rows) {
        if (row.status === "pending" || row.status === "accepted" || row.status === "rejected") {
          statusById.set(row.id, row.status);
        }
      }
    }
    const versionNumberById = new Map<string, number | null>();
    if (versionIds.size > 0) {
      const rows = await this.database
        .select({ id: documentVersions.id, versionNumber: documentVersions.versionNumber })
        .from(documentVersions)
        .where(inArray(documentVersions.id, [...versionIds]));
      for (const row of rows) versionNumberById.set(row.id, row.versionNumber ?? null);
    }

    const patchAnnotations = (value: unknown): unknown => {
      if (!Array.isArray(value)) return value;
      return value.map((annotation) => {
        if (!annotation || typeof annotation !== "object") return annotation;
        const editId = Reflect.get(annotation, "edit_id");
        const versionId = Reflect.get(annotation, "version_id");
        return {
          ...annotation,
          ...(typeof editId === "string" && statusById.has(editId)
            ? { status: statusById.get(editId) }
            : {}),
          ...(typeof versionId === "string" && versionNumberById.has(versionId)
            ? { version_number: versionNumberById.get(versionId) ?? null }
            : {}),
        };
      });
    };

    return messages.map((message) => ({
      ...message,
      annotations: patchAnnotations(message.annotations),
      content: Array.isArray(message.content)
        ? message.content.map((event) => {
            if (
              !event ||
              typeof event !== "object" ||
              Reflect.get(event, "type") !== "doc_edited"
            ) {
              return event;
            }
            const versionId = Reflect.get(event, "version_id");
            return {
              ...event,
              annotations: patchAnnotations(Reflect.get(event, "annotations")),
              ...(typeof versionId === "string" && versionNumberById.has(versionId)
                ? { version_number: versionNumberById.get(versionId) ?? null }
                : {}),
            };
          })
        : message.content,
    }));
  }
}
