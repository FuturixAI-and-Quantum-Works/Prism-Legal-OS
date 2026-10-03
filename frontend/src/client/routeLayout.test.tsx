import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './App'

const mocks = vi.hoisted(() => ({ useAuth: vi.fn() }))

vi.mock('./hooks/useAuth', () => ({ useAuth: mocks.useAuth }))
vi.mock('./hooks/useNavigationWarning', () => ({ useNavigationWarning: () => undefined }))
vi.mock('./components/PendingProcessesIndicator', () => ({ default: () => null }))
vi.mock('./components/BackgroundChatIndicator', () => ({ default: () => null }))
vi.mock('./components/Layout', () => ({
  default: ({ activePage, children }: { activePage?: string; children: ReactNode }) => (
    <div data-testid="layout" data-active-page={activePage}>
      {children}
    </div>
  ),
}))
vi.mock('./features/documents/DocumentsFeature', () => ({
  default: ({ isShared }: { isShared?: boolean }) => (
    <div>{isShared ? 'Shared documents feature' : 'Documents feature'}</div>
  ),
}))
vi.mock('./features/workspaces/WorkspacesFeature', () => ({
  default: ({ filter }: { filter?: string }) => <div>{`Workspaces feature ${filter}`}</div>,
}))
vi.mock('./features/templates/TemplateLibraryFeature', () => ({
  default: () => <div>Templates feature</div>,
}))
vi.mock('./features/aiSettings/ProviderSettings', () => ({
  default: () => <div>Provider settings</div>,
}))
vi.mock('./features/projects/projectsApi', () => ({
  useGetProjectQuery: () => ({ data: undefined, isLoading: true, isError: false }),
}))

const cases = [
  ['/workspaces', 'Workspaces feature owned', 'projects'],
  ['/shared', 'Workspaces feature shared', 'shared'],
  ['/library', 'Documents feature', 'library'],
  ['/templates', 'Templates feature', 'library'],
  ['/documents', 'Documents feature', 'documents'],
  ['/shared-documents', 'Shared documents feature', 'shared-documents'],
  ['/settings', 'Provider settings', 'settings'],
  ['/projects/p1', 'Loading project...', 'projects'],
] as const

describe('route layout', () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue({ status: 'authenticated', error: null })
  })

  it.each(cases)('%s renders %s inside one layout with %s active', async (path, text, active) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(await screen.findByText(text)).toBeInTheDocument()
    const layouts = screen.getAllByTestId('layout')
    expect(layouts).toHaveLength(1)
    expect(layouts[0]).toHaveAttribute('data-active-page', active)
    expect(layouts[0]).toContainElement(screen.getByText(text))
  })
})
