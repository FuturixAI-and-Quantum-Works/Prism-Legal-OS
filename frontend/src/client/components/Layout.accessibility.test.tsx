import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Layout from './Layout'

vi.mock('../hooks', () => ({
  useResponsive: () => ({ isMobile: true, isTablet: false, isDesktop: false }),
}))

vi.mock('../features/navigation/SidebarNavigation', () => ({
  SidebarNavigation: ({ onLibraryClick }: { onLibraryClick: () => void }) => (
    <nav aria-label="Primary">
      <button type="button" onClick={onLibraryClick}>
        Open library
      </button>
    </nav>
  ),
}))

vi.mock('./Topbar', () => ({
  default: ({
    onToggleSidebar,
    sidebarCollapsed,
  }: {
    onToggleSidebar: () => void
    sidebarCollapsed: boolean
  }) => (
    <button
      type="button"
      aria-label="Toggle navigation"
      aria-expanded={!sidebarCollapsed}
      onClick={onToggleSidebar}
    >
      Menu
    </button>
  ),
}))

vi.mock('./LibraryPanel', () => ({ default: () => null }))
vi.mock('../features/workspaces/CreateWorkspaceModal', () => ({ default: () => null }))

describe('Layout mobile navigation accessibility', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      clear: vi.fn(),
      getItem: vi.fn(() => null),
      key: vi.fn(() => null),
      length: 0,
      removeItem: vi.fn(),
      setItem: vi.fn(),
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('traps focus in the navigation dialog and restores it on Escape', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter>
        <Layout>
          <p>Page content</p>
        </Layout>
      </MemoryRouter>,
    )
    const trigger = screen.getByRole('button', { name: 'Toggle navigation' })

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: 'Navigation menu' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open library' })).toHaveFocus()
    expect(await axe(container)).toHaveNoViolations()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
