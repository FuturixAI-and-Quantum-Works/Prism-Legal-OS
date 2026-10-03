import { baseApi } from './baseApi'
import {
  cancelDurableRun,
  hasDurableRunState,
  streamDurableSSE,
  type StreamOutcome,
} from '../../lib/sseTransport'
import { apiUrl } from '../../lib/apiTransport'
import { isTabularGenerateEvent, type TabularGenerateEvent } from '@prism/protocol'

export type { TabularGenerateEvent } from '@prism/protocol'
export interface ColumnConfig {
  id?: string
  index: number
  name: string
  prompt: string
  format?: string
  tags?: string[]
  width?: number
}

export interface TabularReviewDocument {
  id: string
  filename: string
  fileType?: string | null
  file_type?: string | null
  createdAt?: string
  created_at?: string
  has_pdf_rendition?: boolean
}

export interface TabularReviewCell {
  id: string
  reviewId: string
  documentId: string
  columnIndex: number
  content: {
    summary?: string
    flag?: 'green' | 'grey' | 'yellow' | 'red'
    reasoning?: string
  } | null
  status: 'pending' | 'generating' | 'done' | 'error'
  createdAt: string
  updatedAt: string
}

export interface TabularReview {
  id: string
  userId: string
  projectId: string | null
  workflowId: string | null
  title: string | null
  columnsConfig: ColumnConfig[]
  document_count?: number
  createdAt: string
  updatedAt: string
  allow_edit?: boolean
  is_owner?: boolean
  shared_by_name?: string | null
}

export interface TabularReviewResponse {
  review: TabularReview
  documents: TabularReviewDocument[]
  cells: TabularReviewCell[]
}

export interface TabularReviewPerson {
  id: string
  email: string
  display_name: string | null
  role: 'owner' | 'editor' | 'viewer'
}

export interface TabularReviewChat {
  id: string
  title: string | null
  reviewId: string
  userId: string
  createdAt: string
  updatedAt: string
}

export interface TabularReviewChatMessage {
  id: string
  chatId: string
  role: 'user' | 'assistant'
  content: string | null | unknown[]
  createdAt: string
}

export interface CreateTabularReviewRequest {
  title: string
  project_id?: string | null
  workflow_id?: string | null
  document_ids?: string[]
  columns_config?: ColumnConfig[]
}

export interface UpdateTabularReviewRequest {
  title?: string
  columns_config?: ColumnConfig[]
  document_ids?: string[]
  project_id?: string | null
}

export interface GenerateColumnPromptRequest {
  column_name: string
  existing_prompts?: { name: string; prompt: string }[]
}

export interface ClearCellsRequest {
  document_ids?: string[]
  column_indexes?: number[]
}

export const tabularReviewApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getTabularReviews: builder.query<TabularReview[], { project_id?: string } | void>({
      query: (params) => ({
        url: '/tabular-review',
        params: params ?? undefined,
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'TabularReview' as const, id })),
              { type: 'TabularReview', id: 'LIST' },
            ]
          : [{ type: 'TabularReview', id: 'LIST' }],
    }),

    createTabularReview: builder.mutation<TabularReview, CreateTabularReviewRequest>({
      query: (body) => ({
        url: '/tabular-review',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'TabularReview', id: 'LIST' }],
    }),

    generateColumnPrompt: builder.mutation<{ prompt: string }, GenerateColumnPromptRequest>({
      query: (body) => ({
        url: '/tabular-review/prompt',
        method: 'POST',
        body,
      }),
    }),

    getTabularReview: builder.query<TabularReviewResponse, string>({
      query: (reviewId) => `/tabular-review/${reviewId}`,
      providesTags: (_result, _error, reviewId) => [{ type: 'TabularReview', id: reviewId }],
    }),

    updateTabularReview: builder.mutation<
      TabularReview,
      { reviewId: string } & UpdateTabularReviewRequest
    >({
      query: ({ reviewId, ...body }) => ({
        url: `/tabular-review/${reviewId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { reviewId }) => [
        { type: 'TabularReview', id: reviewId },
        { type: 'TabularReview', id: 'LIST' },
      ],
    }),

    deleteTabularReview: builder.mutation<void, string>({
      query: (reviewId) => ({
        url: `/tabular-review/${reviewId}`,
        method: 'DELETE',
      }),
      invalidatesTags: [{ type: 'TabularReview', id: 'LIST' }],
    }),

    getTabularReviewPeople: builder.query<TabularReviewPerson[], string>({
      query: (reviewId) => `/tabular-review/${reviewId}/people`,
      providesTags: (_result, _error, reviewId) => [
        { type: 'TabularReview', id: `${reviewId}-people` },
      ],
    }),

    clearTabularCells: builder.mutation<void, { reviewId: string } & ClearCellsRequest>({
      query: ({ reviewId, ...body }) => ({
        url: `/tabular-review/${reviewId}/clear-cells`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { reviewId }) => [{ type: 'TabularReview', id: reviewId }],
    }),

    getTabularReviewChats: builder.query<TabularReviewChat[], string>({
      query: (reviewId) => `/tabular-review/${reviewId}/chats`,
      providesTags: (_result, _error, reviewId) => [
        { type: 'TabularReview', id: `${reviewId}-chats` },
      ],
    }),

    deleteTabularReviewChat: builder.mutation<void, { reviewId: string; chatId: string }>({
      query: ({ reviewId, chatId }) => ({
        url: `/tabular-review/${reviewId}/chats/${chatId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { reviewId }) => [
        { type: 'TabularReview', id: `${reviewId}-chats` },
      ],
    }),

    getTabularReviewChatMessages: builder.query<
      TabularReviewChatMessage[],
      { reviewId: string; chatId: string }
    >({
      query: ({ reviewId, chatId }) => `/tabular-review/${reviewId}/chats/${chatId}/messages`,
      providesTags: (_result, _error, { reviewId, chatId }) => [
        { type: 'TabularReview', id: `${reviewId}-chat-${chatId}` },
      ],
    }),
  }),
})

export const {
  useGetTabularReviewsQuery,
  useCreateTabularReviewMutation,
  useGetTabularReviewQuery,
  useUpdateTabularReviewMutation,
  useDeleteTabularReviewMutation,
  useClearTabularCellsMutation,
  useGetTabularReviewChatsQuery,
  useGetTabularReviewChatMessagesQuery,
} = tabularReviewApi

export interface TabularGenerateOptions {
  reviewId: string
  mode?: 'start' | 'reconnect'
  model?: string
  onEvent: (event: TabularGenerateEvent) => void
  onError?: (error: Error) => void
  onComplete?: () => void
  signal?: AbortSignal
}

function tabularGenerateStorageKey(reviewId: string) {
  return `tabular-generate:${reviewId}`
}

export function hasTabularGenerateRun(reviewId: string) {
  return hasDurableRunState(tabularGenerateStorageKey(reviewId))
}

export async function streamTabularGenerate(
  options: TabularGenerateOptions,
): Promise<StreamOutcome> {
  const { reviewId, mode = 'start', model, onEvent, onError, onComplete, signal } = options
  const runUrl = apiUrl(`/tabular-review/${reviewId}/generate`)

  return streamDurableSSE({
    storageKey: tabularGenerateStorageKey(reviewId),
    mode,
    startUrl: runUrl,
    startInit: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model }),
    },
    reconnectUrl: ({ runId, after }) => {
      const params = new URLSearchParams({ after: String(after) })
      if (runId) params.set('run_id', runId)
      return `${runUrl}?${params}`
    },
    runIdHeader: 'X-Tabular-Run-Id',
    signal,
    accepts: isTabularGenerateEvent,
    onEvent,
    onError,
    onComplete,
  })
}

export async function cancelTabularGenerate(reviewId: string) {
  const runUrl = apiUrl(`/tabular-review/${reviewId}/generate`)
  return cancelDurableRun({
    storageKey: tabularGenerateStorageKey(reviewId),
    cancelUrl: (runId) => (runId ? `${runUrl}?run_id=${encodeURIComponent(runId)}` : runUrl),
  })
}

type TabularRegenerateCallbacks = Readonly<{
  reviewId: string
  onEvent: (event: TabularGenerateEvent) => void
  onError?: (error: Error) => void
  onComplete?: () => void
  signal?: AbortSignal
}>

export type TabularRegenerateOptions = TabularRegenerateCallbacks &
  (
    | Readonly<{ mode: 'start'; documentId: string; columnIndex: number }>
    | Readonly<{ mode: 'reconnect' }>
  )

function tabularRegenerateStorageKey(reviewId: string) {
  return `tabular-regenerate:${reviewId}`
}

export function hasTabularRegenerateRun(reviewId: string) {
  return hasDurableRunState(tabularRegenerateStorageKey(reviewId))
}

export async function streamTabularRegenerate(options: TabularRegenerateOptions) {
  const { reviewId, mode, onEvent, onError, onComplete, signal } = options
  const runUrl = apiUrl(`/tabular-review/${reviewId}/regenerate-cell`)

  return streamDurableSSE({
    storageKey: tabularRegenerateStorageKey(reviewId),
    mode,
    startUrl: runUrl,
    startInit: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_id: options.mode === 'start' ? options.documentId : undefined,
        column_index: options.mode === 'start' ? options.columnIndex : undefined,
      }),
    },
    reconnectUrl: ({ runId, after }) => {
      const params = new URLSearchParams({ after: String(after) })
      if (runId) params.set('run_id', runId)
      return `${runUrl}?${params}`
    },
    runIdHeader: 'X-Tabular-Run-Id',
    signal,
    accepts: isTabularGenerateEvent,
    onEvent,
    onError,
    onComplete,
  })
}

export async function cancelTabularRegenerate(reviewId: string) {
  const runUrl = apiUrl(`/tabular-review/${reviewId}/regenerate-cell`)
  return cancelDurableRun({
    storageKey: tabularRegenerateStorageKey(reviewId),
    cancelUrl: (runId) => (runId ? `${runUrl}?run_id=${encodeURIComponent(runId)}` : runUrl),
  })
}
