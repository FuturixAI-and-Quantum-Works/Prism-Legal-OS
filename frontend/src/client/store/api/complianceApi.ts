import { baseApi } from './baseApi'
import {
  cancelDurableRun,
  hasDurableRunState,
  streamDurableSSE,
  type StreamOutcome,
} from '../../lib/sseTransport'
import { apiUrl } from '../../lib/apiTransport'
import { isComplianceRunEvent, type ComplianceRunEvent } from '@prism/protocol'

export type { ComplianceRunEvent } from '@prism/protocol'

export type ComplianceReviewStatus = 'pending' | 'running' | 'completed' | 'failed'
export type ComplianceRuleStatus = 'pending' | 'compliant' | 'non_compliant' | 'partial' | 'error'

export interface ComplianceReviewRule {
  id: string
  reviewId: string
  content: string
  status: ComplianceRuleStatus
  result: {
    summary?: string
    reasoning?: string
    citations?: Array<{
      documentId: string
      documentName: string
      excerpt: string
    }>
  } | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ComplianceReviewQuestion {
  id: string
  reviewId: string
  content: string
  status: ComplianceRuleStatus
  result: {
    answer?: string
    reasoning?: string
    citations?: Array<{
      documentId: string
      documentName: string
      excerpt: string
    }>
  } | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ComplianceReviewSupportingDoc {
  id: string
  reviewId?: string
  documentId: string
  filename?: string
  fileType?: string | null
  createdAt: string
}

export interface ComplianceReviewResults {
  criticalIssues: number
  pendingItems: number
  resolvedIssues: number
  critical_issues?: number
  pending_items?: number
  resolved_issues?: number
  partialIssues?: number
  compliantRules?: number
  totalRules?: number
  totalQuestions?: number
  errors?: number
}

export interface ComplianceReview {
  id: string
  userId: string
  projectId: string | null
  workspaceId: string | null
  primaryDocumentId: string | null
  title: string | null
  status: ComplianceReviewStatus
  complianceScore: number | null
  results: ComplianceReviewResults | null
  aiInsights: string[] | null
  ragCollectionName: string | null
  createdAt: string
  updatedAt: string
}

export interface ComplianceReviewResponse {
  review: ComplianceReview
  supportingDocs: ComplianceReviewSupportingDoc[]
  rules: ComplianceReviewRule[]
  questions: ComplianceReviewQuestion[]
  primaryDocument?: {
    id: string
    filename: string
    fileType?: string | null
  }
}

interface ComplianceReviewResultsWire {
  criticalIssues?: number
  pendingItems?: number
  resolvedIssues?: number
  partialIssues?: number
  compliantRules?: number
  totalRules?: number
  totalQuestions?: number
  critical_issues?: number
  pending_items?: number
  resolved_issues?: number
  partial_issues?: number
  compliant_rules?: number
  total_rules?: number
  total_questions?: number
  errors?: number
}

type ComplianceReviewWire = Omit<ComplianceReview, 'results'> & {
  results: ComplianceReviewResultsWire | null
}

interface ComplianceReviewWireResponse {
  review: ComplianceReviewWire
  primary_document?: ComplianceReviewResponse['primaryDocument'] | null
  primaryDocument?: ComplianceReviewResponse['primaryDocument'] | null
  supporting_documents?: ComplianceReviewSupportingDoc[]
  supportingDocs?: ComplianceReviewSupportingDoc[]
  rules: ComplianceReviewRule[]
  questions: ComplianceReviewQuestion[]
}

function normalizeComplianceReview(review: ComplianceReviewWire): ComplianceReview {
  const results = review.results
  const criticalIssues = results?.criticalIssues ?? results?.critical_issues ?? 0
  const pendingItems = results?.pendingItems ?? results?.pending_items ?? 0
  const resolvedIssues = results?.resolvedIssues ?? results?.resolved_issues ?? 0
  return {
    ...review,
    results: results
      ? {
          criticalIssues,
          pendingItems,
          resolvedIssues,
          critical_issues: criticalIssues,
          pending_items: pendingItems,
          resolved_issues: resolvedIssues,
          partialIssues: results.partialIssues ?? results.partial_issues,
          compliantRules: results.compliantRules ?? results.compliant_rules,
          totalRules: results.totalRules ?? results.total_rules,
          totalQuestions: results.totalQuestions ?? results.total_questions,
          errors: results.errors,
        }
      : null,
  }
}

function normalizeComplianceReviewResponse(
  response: ComplianceReviewWireResponse,
): ComplianceReviewResponse {
  return {
    review: normalizeComplianceReview(response.review),
    primaryDocument: response.primaryDocument ?? response.primary_document ?? undefined,
    supportingDocs: response.supportingDocs ?? response.supporting_documents ?? [],
    rules: response.rules,
    questions: response.questions,
  }
}

export interface CreateComplianceReviewRequest {
  primary_document_id: string
  title?: string
  project_id?: string | null
  workspace_id?: string | null
  supporting_document_ids?: string[]
  rules?: string[]
  questions?: string[]
}

export interface UpdateComplianceReviewRequest {
  title?: string
}

export interface AddSupportingDocRequest {
  document_id: string
}

export interface AddRuleRequest {
  content: string
  sort_order?: number
}

export interface AddQuestionRequest {
  content: string
  sort_order?: number
}

export const complianceApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getComplianceReviews: builder.query<
      ComplianceReview[],
      { project_id?: string; workspace_id?: string } | void
    >({
      query: (params) => ({
        url: '/compliance-review',
        params: params ?? undefined,
      }),
      transformResponse: (response: ComplianceReviewWire[]) =>
        response.map(normalizeComplianceReview),
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'ComplianceReview' as const, id })),
              { type: 'ComplianceReview', id: 'LIST' },
            ]
          : [{ type: 'ComplianceReview', id: 'LIST' }],
    }),

    createComplianceReview: builder.mutation<ComplianceReview, CreateComplianceReviewRequest>({
      query: (body) => ({
        url: '/compliance-review',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'ComplianceReview', id: 'LIST' }],
    }),

    getComplianceReview: builder.query<ComplianceReviewResponse, string>({
      query: (reviewId) => `/compliance-review/${reviewId}`,
      transformResponse: normalizeComplianceReviewResponse,
      providesTags: (_result, _error, reviewId) => [{ type: 'ComplianceReview', id: reviewId }],
    }),

    getComplianceReviewForDocument: builder.query<
      ComplianceReviewResponse,
      { documentId: string; projectId?: string; workspaceId?: string }
    >({
      query: ({ documentId, projectId, workspaceId }) => ({
        url: `/compliance-review/for-document/${documentId}`,
        params: { project_id: projectId, workspace_id: workspaceId },
      }),
      transformResponse: normalizeComplianceReviewResponse,
      providesTags: (result) =>
        result ? [{ type: 'ComplianceReview', id: result.review.id }] : [],
    }),

    getComplianceReviewForWorkspace: builder.query<
      ComplianceReviewResponse,
      { workspaceId: string }
    >({
      query: ({ workspaceId }) => `/compliance-review/for-workspace/${workspaceId}`,
      transformResponse: normalizeComplianceReviewResponse,
      providesTags: (result) =>
        result ? [{ type: 'ComplianceReview', id: result.review.id }] : [],
    }),

    updateComplianceReview: builder.mutation<
      ComplianceReview,
      { reviewId: string } & UpdateComplianceReviewRequest
    >({
      query: ({ reviewId, ...body }) => ({
        url: `/compliance-review/${reviewId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { reviewId }) => [
        { type: 'ComplianceReview', id: reviewId },
        { type: 'ComplianceReview', id: 'LIST' },
      ],
    }),

    deleteComplianceReview: builder.mutation<void, string>({
      query: (reviewId) => ({
        url: `/compliance-review/${reviewId}`,
        method: 'DELETE',
      }),
      invalidatesTags: [{ type: 'ComplianceReview', id: 'LIST' }],
    }),

    addComplianceSupportingDoc: builder.mutation<
      ComplianceReviewSupportingDoc,
      { reviewId: string } & AddSupportingDocRequest
    >({
      query: ({ reviewId, ...body }) => ({
        url: `/compliance-review/${reviewId}/supporting-docs`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { reviewId }) => [
        { type: 'ComplianceReview', id: reviewId },
      ],
    }),

    removeComplianceSupportingDoc: builder.mutation<void, { reviewId: string; documentId: string }>(
      {
        query: ({ reviewId, documentId }) => ({
          url: `/compliance-review/${reviewId}/supporting-docs/${documentId}`,
          method: 'DELETE',
        }),
        invalidatesTags: (_result, _error, { reviewId }) => [
          { type: 'ComplianceReview', id: reviewId },
        ],
      },
    ),

    addComplianceRule: builder.mutation<
      ComplianceReviewRule,
      { reviewId: string } & AddRuleRequest
    >({
      query: ({ reviewId, ...body }) => ({
        url: `/compliance-review/${reviewId}/rules`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { reviewId }) => [
        { type: 'ComplianceReview', id: reviewId },
      ],
    }),

    updateComplianceRule: builder.mutation<
      ComplianceReviewRule,
      { reviewId: string; ruleId: string; content: string }
    >({
      query: ({ reviewId, ruleId, content }) => ({
        url: `/compliance-review/${reviewId}/rules/${ruleId}`,
        method: 'PATCH',
        body: { content },
      }),
      invalidatesTags: (_result, _error, { reviewId }) => [
        { type: 'ComplianceReview', id: reviewId },
      ],
    }),

    removeComplianceRule: builder.mutation<void, { reviewId: string; ruleId: string }>({
      query: ({ reviewId, ruleId }) => ({
        url: `/compliance-review/${reviewId}/rules/${ruleId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { reviewId }) => [
        { type: 'ComplianceReview', id: reviewId },
      ],
    }),

    addComplianceQuestion: builder.mutation<
      ComplianceReviewQuestion,
      { reviewId: string } & AddQuestionRequest
    >({
      query: ({ reviewId, ...body }) => ({
        url: `/compliance-review/${reviewId}/questions`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { reviewId }) => [
        { type: 'ComplianceReview', id: reviewId },
      ],
    }),

    updateComplianceQuestion: builder.mutation<
      ComplianceReviewQuestion,
      { reviewId: string; questionId: string; content: string }
    >({
      query: ({ reviewId, questionId, content }) => ({
        url: `/compliance-review/${reviewId}/questions/${questionId}`,
        method: 'PATCH',
        body: { content },
      }),
      invalidatesTags: (_result, _error, { reviewId }) => [
        { type: 'ComplianceReview', id: reviewId },
      ],
    }),

    removeComplianceQuestion: builder.mutation<void, { reviewId: string; questionId: string }>({
      query: ({ reviewId, questionId }) => ({
        url: `/compliance-review/${reviewId}/questions/${questionId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { reviewId }) => [
        { type: 'ComplianceReview', id: reviewId },
      ],
    }),
  }),
})

export const {
  useGetComplianceReviewsQuery,
  useLazyGetComplianceReviewsQuery,
  useCreateComplianceReviewMutation,
  useGetComplianceReviewQuery,
  useLazyGetComplianceReviewQuery,
  useGetComplianceReviewForDocumentQuery,
  useLazyGetComplianceReviewForDocumentQuery,
  useGetComplianceReviewForWorkspaceQuery,
  useLazyGetComplianceReviewForWorkspaceQuery,
  useUpdateComplianceReviewMutation,
  useDeleteComplianceReviewMutation,
  useAddComplianceSupportingDocMutation,
  useRemoveComplianceSupportingDocMutation,
  useAddComplianceRuleMutation,
  useUpdateComplianceRuleMutation,
  useRemoveComplianceRuleMutation,
  useAddComplianceQuestionMutation,
  useUpdateComplianceQuestionMutation,
  useRemoveComplianceQuestionMutation,
} = complianceApi

export interface ComplianceRunOptions {
  reviewId: string
  mode?: 'start' | 'reconnect'
  model?: string
  onEvent: (event: ComplianceRunEvent) => void
  onError?: (error: Error) => void
  onComplete?: () => void
  signal?: AbortSignal
}

function complianceRunStorageKey(reviewId: string) {
  return `compliance:${reviewId}`
}

export function hasComplianceRun(reviewId: string) {
  return hasDurableRunState(complianceRunStorageKey(reviewId))
}

export async function streamComplianceRun(options: ComplianceRunOptions): Promise<StreamOutcome> {
  const { reviewId, mode = 'start', model, onEvent, onError, onComplete, signal } = options
  const runUrl = apiUrl(`/compliance-review/${reviewId}/run`)

  return streamDurableSSE({
    storageKey: complianceRunStorageKey(reviewId),
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
    runIdHeader: 'X-Compliance-Run-Id',
    signal,
    accepts: isComplianceRunEvent,
    onEvent,
    onError,
    onComplete,
  })
}

export async function cancelComplianceRun(reviewId: string) {
  const runUrl = apiUrl(`/compliance-review/${reviewId}/run`)
  return cancelDurableRun({
    storageKey: complianceRunStorageKey(reviewId),
    cancelUrl: (runId) => (runId ? `${runUrl}?run_id=${encodeURIComponent(runId)}` : runUrl),
  })
}
