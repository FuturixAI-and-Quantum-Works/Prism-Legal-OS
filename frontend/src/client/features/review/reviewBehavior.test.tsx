import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewPage from '../../components/pages/ReviewPage'

const mocks = vi.hoisted(() => {
  function mutationResult<T>(value: T) {
    const result = Promise.resolve(value) as Promise<T> & { unwrap: () => Promise<T> }
    result.unwrap = () => Promise.resolve(value)
    return result
  }

  return {
    cancelGenerate: vi.fn(async () => undefined),
    cancelRegenerate: vi.fn(async () => undefined),
    clearCells: vi.fn(() => mutationResult(undefined)),
    createReview: vi.fn(() => mutationResult({ id: 'created-review' })),
    deleteReview: vi.fn(() => mutationResult(undefined)),
    detail: null as Record<string, unknown> | null,
    dispatch: vi.fn(),
    documents: [] as Array<Record<string, unknown>>,
    hasGenerateRun: false,
    hasRegenerateRun: false,
    refetchDetail: vi.fn(),
    refetchReviews: vi.fn(),
    reviews: [] as Array<Record<string, unknown>>,
    runningProcesses: [] as Array<Record<string, unknown>>,
    streamGenerate: vi.fn(async (_options: { signal: AbortSignal }) => ({
      kind: 'success' as const,
    })),
    streamRegenerate: vi.fn(async (_options: { signal: AbortSignal }) => ({
      kind: 'success' as const,
    })),
    updateReview: vi.fn(() => mutationResult({ id: 'review-1' })),
  }
})

vi.mock('../../components/Layout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))

vi.mock('../../components/FilePreviewModal', () => ({ default: () => null }))

vi.mock('../../store/hooks', () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: () => mocks.runningProcesses,
}))

vi.mock('../../store/api/tabularReviewApi', () => ({
  cancelTabularGenerate: mocks.cancelGenerate,
  cancelTabularRegenerate: mocks.cancelRegenerate,
  hasTabularGenerateRun: () => mocks.hasGenerateRun,
  hasTabularRegenerateRun: () => mocks.hasRegenerateRun,
  streamTabularGenerate: mocks.streamGenerate,
  streamTabularRegenerate: mocks.streamRegenerate,
  useClearTabularCellsMutation: () => [mocks.clearCells, { isLoading: false }],
  useCreateTabularReviewMutation: () => [mocks.createReview, { isLoading: false }],
  useDeleteTabularReviewMutation: () => [mocks.deleteReview, { isLoading: false }],
  useGetTabularReviewChatMessagesQuery: () => ({ data: [] }),
  useGetTabularReviewChatsQuery: () => ({ data: [], refetch: vi.fn() }),
  useGetTabularReviewQuery: () => ({
    data: mocks.detail,
    isLoading: false,
    isError: false,
    refetch: mocks.refetchDetail,
  }),
  useGetTabularReviewsQuery: () => ({
    data: mocks.reviews,
    isLoading: false,
    isError: false,
    refetch: mocks.refetchReviews,
  }),
  useUpdateTabularReviewMutation: () => [mocks.updateReview, { isLoading: false }],
}))

vi.mock('../projects/projectsApi', () => ({
  useGetProjectsQuery: () => ({ data: [] }),
}))

vi.mock('../documents/documentsApi', () => ({
  useGetDocumentsQuery: () => ({ data: mocks.documents, isLoading: false }),
}))

vi.mock('../../store/api/workflowsApi', () => ({
  useGetWorkflowsQuery: () => ({ data: [] }),
}))

function reviewDetail(status: 'pending' | 'generating' | 'done' | 'error' = 'done') {
  return {
    review: {
      id: 'review-1',
      title: 'Contract risk review',
      projectId: 'project-1',
      createdAt: '2026-09-01T12:00:00.000Z',
      columnsConfig: [
        {
          id: 'risk-column',
          index: 0,
          name: 'Risk',
          prompt: 'Summarize risk',
          format: 'text',
          width: 250,
        },
      ],
    },
    documents: [
      {
        id: 'document-1',
        filename: 'contract.pdf',
        file_type: 'pdf',
        created_at: '2026-09-01T12:00:00.000Z',
      },
    ],
    cells: [
      {
        id: 'cell-1',
        documentId: 'document-1',
        columnIndex: 0,
        content: status === 'done' ? { summary: 'Uncapped liability' } : null,
        status,
      },
    ],
  }
}

function renderRoutedReview() {
  return render(
    <MemoryRouter initialEntries={['/review/review-1']}>
      <Routes>
        <Route path="/review/:reviewId" element={<ReviewPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('review behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detail = reviewDetail()
    mocks.documents.splice(0)
    mocks.reviews.splice(0)
    mocks.runningProcesses.splice(0)
    mocks.hasGenerateRun = false
    mocks.hasRegenerateRun = false
  })

  it('starts and explicitly cancels a routed generation', async () => {
    const user = userEvent.setup()
    renderRoutedReview()

    await user.click(await screen.findByRole('button', { name: 'Run' }))

    expect(mocks.streamGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: 'review-1',
        mode: 'start',
        signal: expect.any(AbortSignal),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mocks.cancelGenerate).toHaveBeenCalledWith('review-1')
    expect(mocks.cancelRegenerate).not.toHaveBeenCalled()
  })

  it('prefers a saved regeneration when both durable cursors exist', async () => {
    const user = userEvent.setup()
    mocks.detail = reviewDetail('generating')
    mocks.hasGenerateRun = true
    mocks.hasRegenerateRun = true
    renderRoutedReview()

    await waitFor(() =>
      expect(mocks.streamRegenerate).toHaveBeenCalledWith(
        expect.objectContaining({ reviewId: 'review-1', mode: 'reconnect' }),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mocks.streamGenerate).not.toHaveBeenCalled()
    expect(mocks.cancelRegenerate).toHaveBeenCalledWith('review-1')
    expect(mocks.cancelGenerate).not.toHaveBeenCalled()
  })

  it('aborts a reconnect on unmount without cancelling the durable run', async () => {
    mocks.detail = reviewDetail('generating')
    mocks.hasGenerateRun = true
    const view = renderRoutedReview()

    await waitFor(() => expect(mocks.streamGenerate).toHaveBeenCalledOnce())
    const signal = mocks.streamGenerate.mock.calls[0][0].signal as AbortSignal

    view.unmount()

    expect(signal.aborted).toBe(true)
    expect(mocks.cancelGenerate).not.toHaveBeenCalled()
    expect(mocks.cancelRegenerate).not.toHaveBeenCalled()
  })

  it('keeps embedded workspace review discovery and document synchronization', async () => {
    mocks.reviews.push({
      id: 'workspace-review',
      title: 'Workspace Review (workspace-workspace-1)',
    })

    render(
      <MemoryRouter initialEntries={['/review/review-1']}>
        <ReviewPage
          embedded
          workspaceId="workspace-1"
          workspaceDocuments={[
            { id: 'document-1', name: 'contract.pdf', extension: 'pdf' },
            { id: 'document-2', name: 'schedule.docx', extension: 'docx' },
          ]}
        />
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(mocks.updateReview).toHaveBeenCalledWith({
        reviewId: 'workspace-review',
        document_ids: ['document-1', 'document-2'],
      }),
    )
  })
})
