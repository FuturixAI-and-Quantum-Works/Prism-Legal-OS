import { isChatStreamEvent, type ChatStreamEvent } from '@prism/protocol'
import { apiUrl } from '../../../lib/apiTransport'
import { streamSSE, type StreamOutcome } from '../../../lib/sseTransport'
import { baseApi } from '../baseApi'

export type { ChatStreamEvent as WorkspaceChatStreamEvent } from '@prism/protocol'

export interface WorkspaceCollaborator {
  id: string
  user_id: string
  email: string
  full_name: string | null
  role: 'admin' | 'editor' | 'viewer'
}

export interface DriveWorkspace {
  id: string
  owner_id: string
  owner_name: string | null
  name: string
  description: string | null
  storage_used_bytes: number
  storage_quota_bytes: number | null
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  file_count: number
  collaborators?: WorkspaceCollaborator[]
  created_at: string
  updated_at: string
}

export interface CreateWorkspaceRequest {
  name: string
  description?: string | null
}

export interface UpdateWorkspaceRequest {
  workspaceId: string
  name?: string
  description?: string | null
}

export interface WorkspaceChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface WorkspaceChatFile {
  filename: string
  file_id: string
}

export interface WorkspaceChat {
  id: string
  title: string | null
  userId: string
  workspaceId: string
  createdAt: string
  updatedAt: string
}

export const driveWorkspaceApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getDriveWorkspaces: builder.query<DriveWorkspace[], void>({
      query: () => '/drive/workspaces',
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'DriveWorkspaces' as const, id })),
              { type: 'DriveWorkspaces', id: 'LIST' },
            ]
          : [{ type: 'DriveWorkspaces', id: 'LIST' }],
    }),
    createDriveWorkspace: builder.mutation<DriveWorkspace, CreateWorkspaceRequest>({
      query: (body) => ({
        url: '/drive/workspaces',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'DriveWorkspaces', id: 'LIST' }],
    }),
    getDriveWorkspace: builder.query<DriveWorkspace, string>({
      query: (workspaceId) => `/drive/workspaces/${workspaceId}`,
      providesTags: (_result, _error, workspaceId) => [
        { type: 'DriveWorkspaces', id: workspaceId },
      ],
    }),
    updateDriveWorkspace: builder.mutation<DriveWorkspace, UpdateWorkspaceRequest>({
      query: ({ workspaceId, ...body }) => ({
        url: `/drive/workspaces/${workspaceId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { workspaceId }) => [
        { type: 'DriveWorkspaces', id: workspaceId },
        { type: 'DriveWorkspaces', id: 'LIST' },
      ],
    }),
    deleteDriveWorkspace: builder.mutation<void, string>({
      query: (workspaceId) => ({
        url: `/drive/workspaces/${workspaceId}`,
        method: 'DELETE',
      }),
      invalidatesTags: [
        { type: 'DriveWorkspaces', id: 'LIST' },
        { type: 'DriveFiles', id: 'LIST' },
        { type: 'DriveFolders', id: 'LIST' },
      ],
    }),
    getWorkspaceChats: builder.query<WorkspaceChat[], string>({
      query: (workspaceId) => `/drive/workspaces/${workspaceId}/chat/chats`,
      providesTags: (_result, _error, workspaceId) => [
        { type: 'DriveWorkspaces', id: `${workspaceId}-chats` },
        { type: 'Chat', id: 'LIST' },
      ],
    }),
  }),
})

export const {
  useGetDriveWorkspacesQuery,
  useLazyGetDriveWorkspacesQuery,
  useCreateDriveWorkspaceMutation,
  useGetDriveWorkspaceQuery,
  useLazyGetDriveWorkspaceQuery,
  useUpdateDriveWorkspaceMutation,
  useDeleteDriveWorkspaceMutation,
  useGetWorkspaceChatsQuery,
  useLazyGetWorkspaceChatsQuery,
} = driveWorkspaceApi

export interface WorkspaceChatStreamOptions {
  workspaceId: string
  messages: WorkspaceChatMessage[]
  chat_id?: string
  model?: string
  displayed_file?: WorkspaceChatFile
  attached_files?: WorkspaceChatFile[]
  onEvent: (event: ChatStreamEvent) => void
  onError?: (error: Error) => void
  onComplete?: () => void
  signal?: AbortSignal
}

export async function streamWorkspaceChat(
  options: WorkspaceChatStreamOptions,
): Promise<StreamOutcome> {
  const {
    workspaceId,
    messages,
    chat_id,
    model,
    displayed_file,
    attached_files,
    onEvent,
    onError,
    onComplete,
    signal,
  } = options

  return streamSSE(
    apiUrl(`/drive/workspaces/${workspaceId}/chat`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        chat_id,
        model,
        displayed_file,
        attached_files,
      }),
      signal,
    },
    {
      accepts: isChatStreamEvent,
      onEvent,
      onError,
      onComplete,
    },
  )
}
