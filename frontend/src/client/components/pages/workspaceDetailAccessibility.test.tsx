import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { axe } from 'jest-axe'
import { describe, expect, it, vi } from 'vitest'
import WorkspaceDetailView from '../../features/workspaces/WorkspaceDetailView'

vi.mock('../Layout', () => ({
  default: ({ children }: { children: () => React.ReactNode }) => <>{children()}</>,
}))
vi.mock('../../features/files/BrowseFilesDialog', () => ({ default: () => null }))
vi.mock('../FilePreviewModal', () => ({ default: () => null }))
vi.mock('../../features/assistant/panel/AiAssistantPanel', () => ({ default: () => null }))
vi.mock('../../features/analysis/AnalysisPanelFeature', () => ({ default: () => null }))
vi.mock('./RulebookPanel', () => ({ default: () => null }))
vi.mock('../../features/compliance/ComplianceReviewFeature', () => ({
  ComplianceReviewFeature: () => null,
}))
vi.mock('./ReviewPage', () => ({ default: () => null }))

vi.mock('../../store/api/drive/driveWorkspaceApi', () => ({
  useGetDriveWorkspaceQuery: () => ({
    data: {
      id: 'workspace-1',
      owner_id: 'user-1',
      owner_name: 'Alex Morgan',
      name: 'Apollo',
      role: 'owner',
      collaborators: [],
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  }),
  streamWorkspaceChat: vi.fn(),
}))
vi.mock('../../store/api/drive/driveFileApi', () => ({
  useGetDriveFilesQuery: () => ({
    data: { files: [] },
    isLoading: false,
    refetch: vi.fn(),
  }),
  useUploadDriveFileMutation: () => [vi.fn(), { isLoading: false }],
  useDeleteDriveFileMutation: () => [vi.fn()],
}))
vi.mock('../../store/api/drive/driveActivityApi', () => ({
  useGetWorkspaceActivityQuery: () => ({ data: [] }),
}))
vi.mock('../../store/api/drive/driveInvitationsApi', () => ({
  useRemoveWorkspaceMemberMutation: () => [vi.fn()],
  useInviteWorkspaceMemberMutation: () => [vi.fn()],
}))

vi.mock('../../features/documents/documentsApi', () => {
  const documents = [
    {
      id: 'document-1',
      filename: 'contract.pdf',
      file_type: 'pdf',
      size_bytes: 2048,
      status: 'ready',
      is_primary: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ]
  const refetch = vi.fn()

  return {
    useGetDocumentsQuery: () => ({ data: documents, isLoading: false, refetch }),
    useLazyGetDocumentDisplayQuery: () => [vi.fn()],
    useDeleteDocumentMutation: () => [vi.fn()],
    useCreateDocumentMutation: () => [vi.fn(), { isLoading: false }],
  }
})
vi.mock('../../features/documents/api/documentCoreApi', () => {
  const documents = [
    {
      id: 'document-1',
      filename: 'contract.pdf',
      file_type: 'pdf',
      size_bytes: 2048,
      status: 'ready',
      is_primary: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ]
  const refetch = vi.fn()

  return {
    useGetDocumentsQuery: () => ({ data: documents, isLoading: false, refetch }),
    useDeleteDocumentMutation: () => [vi.fn()],
    useCreateDocumentMutation: () => [vi.fn(), { isLoading: false }],
    useUpdateDocumentMutation: () => [vi.fn()],
  }
})
vi.mock('../../features/documents/api/documentContentApi', () => ({
  useLazyGetDocumentDisplayQuery: () => [vi.fn()],
}))

describe('workspace detail accessibility', () => {
  it('supports document tabs, filters, selection, and dialogs from the keyboard', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter initialEntries={['/workspaces/workspace-1']}>
        <Routes>
          <Route path="/workspaces/:workspaceId" element={<WorkspaceDetailView />} />
        </Routes>
      </MemoryRouter>,
    )

    const primary = screen.getByRole('tab', { name: 'Primary Documents' })
    for (let index = 0; index < 30 && document.activeElement !== primary; index += 1) {
      await user.tab()
    }
    expect(primary).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Supporting Documents' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.keyboard('{ArrowLeft}')

    const filters = screen.getByRole('button', { name: 'Filters' })
    await user.click(filters)
    const pdf = screen.getByRole('menuitemcheckbox', { name: 'PDF' })
    expect(pdf).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(pdf).toHaveAttribute('aria-checked', 'true')
    expect(await axe(container)).toHaveNoViolations()
    await user.keyboard('{Escape}')
    expect(filters).toHaveFocus()

    const sort = screen.getByRole('button', { name: 'Sort : Newest' })
    await user.click(sort)
    expect(screen.getByRole('menuitemradio', { name: 'Newest First' })).toHaveFocus()
    await user.keyboard('{End}{Enter}')
    expect(screen.getByRole('button', { name: 'Sort : Name Z-A' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    const memberTrigger = screen.getByRole('button', { name: 'View Alex Morgan' })
    await user.click(memberTrigger)
    const memberDetails = screen.getByRole('dialog', { name: 'Alex Morgan details' })
    expect(memberDetails).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(memberTrigger).toHaveFocus()

    const moreActions = screen.getByRole('button', { name: 'More project actions' })
    await user.click(moreActions)
    expect(screen.getByRole('menuitem', { name: 'Share Project' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('dialog', { name: 'Share "Apollo"' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Invite by email' })).toHaveFocus()
    await user.tab()
    const roleTrigger = screen.getByRole('button', { name: 'Role' })
    expect(roleTrigger).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: 'Editor' })).toHaveFocus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(roleTrigger).toHaveTextContent('Viewer')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Share "Apollo"' })).not.toBeInTheDocument()

    const selectDocument = screen.getByRole('button', { name: 'Select contract.pdf' })
    for (let index = 0; index < 80 && document.activeElement !== selectDocument; index += 1) {
      await user.tab()
    }
    expect(selectDocument).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Deselect contract.pdf' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.tab()
    const openDocument = screen.getByRole('button', { name: 'Open contract.pdf' })
    expect(openDocument).toHaveFocus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(openDocument).toHaveFocus()

    await user.tab()
    const documentActions = screen.getByRole('button', { name: 'Actions for contract.pdf' })
    expect(documentActions).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(documentActions).toHaveFocus()

    const addDocument = screen.getByRole('button', { name: 'Add a Document' })
    await user.click(addDocument)
    expect(screen.getByRole('dialog', { name: 'Add files to project' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(addDocument).toHaveFocus()
  })
})
