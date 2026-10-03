import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewPage from './ReviewPage'

const mocks = vi.hoisted(() => ({
  mutation: () => [
    vi.fn(() => ({ unwrap: () => Promise.resolve({ id: 'review-1' }) })),
    { isLoading: false },
  ],
  query: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  detail: null as Record<string, unknown> | null,
  reviews: [] as Array<Record<string, unknown>>,
}))

vi.mock('../Layout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))

vi.mock('../FilePreviewModal', () => ({ default: () => null }))

vi.mock('../../store/hooks', () => ({
  useAppDispatch: () => vi.fn(),
  useAppSelector: () => [],
}))

vi.mock('../../store/api/tabularReviewApi', () => ({
  cancelTabularGenerate: vi.fn(),
  cancelTabularRegenerate: vi.fn(),
  hasTabularGenerateRun: vi.fn(() => false),
  hasTabularRegenerateRun: vi.fn(() => false),
  streamTabularGenerate: vi.fn(),
  streamTabularRegenerate: vi.fn(),
  useClearTabularCellsMutation: mocks.mutation,
  useCreateTabularReviewMutation: mocks.mutation,
  useDeleteTabularReviewMutation: mocks.mutation,
  useGetTabularReviewChatMessagesQuery: mocks.query,
  useGetTabularReviewChatsQuery: mocks.query,
  useGetTabularReviewQuery: () => ({
    data: mocks.detail,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetTabularReviewsQuery: () => ({
    data: mocks.reviews,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateTabularReviewMutation: mocks.mutation,
}))

vi.mock('../../features/projects/projectsApi', () => ({
  useGetProjectsQuery: () => ({ data: [{ id: 'project-1', name: 'Apollo' }] }),
}))

vi.mock('../../features/documents/documentsApi', () => ({
  useGetDocumentsQuery: () => ({ data: [], isLoading: false }),
}))

vi.mock('../../store/api/workflowsApi', () => ({
  useGetWorkflowsQuery: () => ({ data: [] }),
}))

describe('review accessibility', () => {
  beforeEach(() => {
    mocks.detail = null
    mocks.reviews.splice(0)
  })

  it('opens and closes the create dialog from the keyboard without violations', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>,
    )

    const newReview = screen.getByRole('button', { name: 'New Review' })
    await user.click(newReview)
    expect(screen.getByRole('dialog', { name: 'New tabular review' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(newReview).toHaveFocus()
  })

  it('supports keyboard filtering and context-menu navigation', async () => {
    mocks.reviews.push({
      id: 'review-1',
      title: 'Supplier review',
      projectId: 'project-1',
      is_owner: true,
      document_count: 2,
      updatedAt: '2026-09-01T12:00:00.000Z',
    })
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>,
    )

    const filters = screen.getByRole('button', { name: 'Filters' })
    await user.click(filters)
    const allProjects = screen.getByRole('menuitemradio', { name: 'All Projects' })
    await waitFor(() => expect(allProjects).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: 'Apollo' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(filters).toHaveFocus())

    const review = screen.getByRole('button', { name: /Supplier review/ })
    for (let index = 0; index < 30 && document.activeElement !== review; index += 1) {
      await user.tab()
    }
    expect(review).toHaveFocus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(screen.getByRole('menu', { name: 'Actions for Supplier review' })).toBeInTheDocument()
    const openItem = screen.getByRole('menuitem', { name: 'Open' })
    const renameItem = screen.getByRole('menuitem', { name: 'Rename' })
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' })
    await waitFor(() => expect(openItem).toHaveFocus())
    expect(openItem).toHaveAttribute('tabindex', '0')
    expect(renameItem).toHaveAttribute('tabindex', '-1')
    await user.keyboard('{ArrowDown}')
    expect(openItem).toHaveAttribute('tabindex', '-1')
    expect(renameItem).toHaveAttribute('tabindex', '0')
    expect(renameItem).toHaveFocus()
    await user.keyboard('{End}')
    expect(deleteItem).toHaveAttribute('tabindex', '0')
    await user.keyboard('{Home}')
    expect(openItem).toHaveFocus()
    await user.tab()
    expect(
      screen.queryByRole('menu', { name: 'Actions for Supplier review' }),
    ).not.toBeInTheDocument()

    review.focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'Rename review' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(review).toHaveFocus())
    expect(await axe(container)).toHaveNoViolations()
  })

  it('moves focus into cell details and restores the cell trigger', async () => {
    mocks.detail = {
      review: {
        id: 'review-1',
        title: 'Supplier review',
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
          content: { summary: 'Uncapped liability' },
          status: 'completed',
        },
      ],
    }
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter initialEntries={['/reviews/review-1']}>
        <Routes>
          <Route path="/reviews/:reviewId" element={<ReviewPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const trigger = await screen.findByRole('button', { name: 'Show Risk result details' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    await user.click(trigger)

    const details = screen.getByRole('dialog', { name: 'Risk result details' })
    await waitFor(() => expect(details).toHaveFocus())
    expect(await axe(container)).toHaveNoViolations()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Risk result details' })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
