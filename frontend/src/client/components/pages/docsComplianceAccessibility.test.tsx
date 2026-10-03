import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComplianceReviewFeature as DocsCompliancePage } from '../../features/compliance/ComplianceReviewFeature'

const mocks = vi.hoisted(() => {
  const mutation = vi.fn(() => ({ unwrap: () => Promise.resolve({ id: 'created-1' }) }))
  return {
    cancelComplianceRun: vi.fn(() => Promise.resolve()),
    complianceData: undefined as Record<string, unknown> | undefined,
    getReview: vi.fn(),
    getDocumentReview: vi.fn(),
    getWorkspaceReview: vi.fn(),
    hasComplianceRun: false,
    mutation,
    refetchCompliance: vi.fn(() => Promise.resolve()),
    streamComplianceRun: vi.fn(() => Promise.resolve()),
  }
})

vi.mock('../Layout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))

vi.mock('../../features/files/BrowseFilesDialog', () => ({
  default: () => null,
}))

vi.mock('../FilePreviewModal', () => ({
  default: () => null,
}))

vi.mock('../../store/hooks', () => ({
  useAppDispatch: () => vi.fn(),
  useAppSelector: () => [],
}))

vi.mock('../../features/documents/documentsApi', () => ({
  useGetDocumentQuery: () => ({
    currentData: {
      id: 'document-1',
      filename: 'Agreement.pdf',
      file_type: 'pdf',
      created_at: '2026-09-01T12:00:00.000Z',
    },
    isLoading: false,
  }),
  useGetDocumentsQuery: () => ({ currentData: [] }),
  useDeleteDocumentMutation: () => [mocks.mutation],
  useUpdateDocumentMutation: () => [mocks.mutation],
  useUploadDocumentMutation: () => [mocks.mutation],
}))
vi.mock('../../features/documents/api/documentCoreApi', () => ({
  useGetDocumentQuery: () => ({
    currentData: {
      id: 'document-1',
      filename: 'Agreement.pdf',
      file_type: 'pdf',
      created_at: '2026-09-01T12:00:00.000Z',
    },
    isLoading: false,
  }),
  useGetDocumentsQuery: () => ({ currentData: [] }),
  useDeleteDocumentMutation: () => [mocks.mutation],
  useUpdateDocumentMutation: () => [mocks.mutation],
  useUploadDocumentMutation: () => [mocks.mutation],
}))

vi.mock('../../store/api/workflowsApi', () => ({
  useGetWorkflowsQuery: () => ({ data: [] }),
}))

vi.mock('../../store/api/drive/driveWorkspaceApi', () => ({
  useGetDriveWorkspaceQuery: () => ({
    currentData: { id: 'workspace-1', name: 'Deal room' },
  }),
}))
vi.mock('../../store/api/drive/driveFileApi', () => ({
  useGetDriveFilesQuery: () => ({ currentData: { files: [] } }),
}))

vi.mock('../../store/api/complianceApi', () => ({
  cancelComplianceRun: mocks.cancelComplianceRun,
  hasComplianceRun: vi.fn(() => mocks.hasComplianceRun),
  streamComplianceRun: mocks.streamComplianceRun,
  useGetComplianceReviewQuery: (reviewId: string, options: { skip: boolean }) => {
    mocks.getReview(reviewId, options)
    return { currentData: mocks.complianceData, refetch: mocks.refetchCompliance }
  },
  useGetComplianceReviewForDocumentQuery: (
    input: { documentId: string },
    options: { skip: boolean },
  ) => {
    mocks.getDocumentReview(input, options)
    return { currentData: mocks.complianceData, refetch: mocks.refetchCompliance }
  },
  useGetComplianceReviewForWorkspaceQuery: (
    input: { workspaceId: string },
    options: { skip: boolean },
  ) => {
    mocks.getWorkspaceReview(input, options)
    return { currentData: mocks.complianceData, refetch: mocks.refetchCompliance }
  },
  useAddComplianceRuleMutation: () => [mocks.mutation],
  useAddComplianceQuestionMutation: () => [mocks.mutation],
  useAddComplianceSupportingDocMutation: () => [mocks.mutation],
  useRemoveComplianceRuleMutation: () => [mocks.mutation],
  useRemoveComplianceQuestionMutation: () => [mocks.mutation],
  useRemoveComplianceSupportingDocMutation: () => [mocks.mutation],
  useUpdateComplianceRuleMutation: () => [mocks.mutation],
  useUpdateComplianceQuestionMutation: () => [mocks.mutation],
}))

describe('document compliance accessibility', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    mocks.cancelComplianceRun.mockClear()
    mocks.complianceData = undefined
    mocks.getReview.mockClear()
    mocks.getDocumentReview.mockClear()
    mocks.getWorkspaceReview.mockClear()
    mocks.hasComplianceRun = false
    mocks.mutation.mockClear()
    mocks.refetchCompliance.mockClear()
    mocks.streamComplianceRun.mockClear()
  })

  it('supports keyboard tabs and supporting-document actions', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter initialEntries={['/compliance/documents/document-1']}>
        <Routes>
          <Route
            path="/compliance/documents/:documentId"
            element={<DocsCompliancePage embedded />}
          />
        </Routes>
      </MemoryRouter>,
    )

    const overview = screen.getByRole('tab', { name: 'Overview' })
    overview.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Risk Threats' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    const actions = screen.getByRole('button', { name: 'Supporting document actions' })
    await user.click(actions)
    expect(screen.getByRole('menuitem', { name: 'Upload Document' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Browse files' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(
      screen.queryByRole('menu', { name: 'Supporting document actions' }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(actions).toHaveFocus())

    expect(await axe(container)).toHaveNoViolations()
  })

  it('hydrates an existing review and reconnects and cancels its durable run', async () => {
    mocks.complianceData = {
      questions: [
        {
          content: 'Which obligations survive termination?',
          id: 'question-1',
        },
      ],
      review: {
        aiInsights: ['The indemnity is uncapped.'],
        complianceScore: 91,
        id: 'review-1',
        results: {
          criticalIssues: 1,
          pendingItems: 2,
          resolvedIssues: 3,
        },
        status: 'running',
      },
      rules: [
        {
          content: 'Liability must be capped.',
          id: 'rule-1',
          result: {
            summary: 'The indemnity is uncapped.',
          },
          status: 'non_compliant',
        },
      ],
      supportingDocs: [],
    }
    mocks.hasComplianceRun = true
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/compliance/documents/document-1']}>
        <Routes>
          <Route
            path="/compliance/documents/:documentId"
            element={<DocsCompliancePage embedded />}
          />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(mocks.streamComplianceRun).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'reconnect',
          reviewId: 'review-1',
        }),
      ),
    )
    expect(screen.getByLabelText('Review rule instruction')).toHaveValue(
      'Liability must be capped.',
    )
    expect(screen.getByLabelText('Question text')).toHaveValue(
      'Which obligations survive termination?',
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocks.cancelComplianceRun).toHaveBeenCalledWith('review-1')
    expect(mocks.refetchCompliance).toHaveBeenCalled()
  })

  it('loads review routes with a review ID instead of a workspace ID', () => {
    mocks.complianceData = {
      questions: [],
      review: {
        id: 'review-1',
        workspaceId: 'workspace-1',
        primaryDocumentId: 'document-1',
        status: 'completed',
      },
      rules: [],
      supportingDocs: [],
    }

    render(
      <MemoryRouter initialEntries={['/compliance/reviews/review-1']}>
        <Routes>
          <Route path="/compliance/reviews/:reviewId" element={<DocsCompliancePage embedded />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(mocks.getReview).toHaveBeenCalledWith('review-1', { skip: false })
    expect(mocks.getWorkspaceReview).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1' },
      { skip: true },
    )
  })
})
