import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'jest-axe'
import { describe, expect, it, vi } from 'vitest'
import { SidebarNavigation } from '../features/navigation/SidebarNavigation'
import Topbar from './Topbar'

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ logout: vi.fn(), user: { displayName: 'Alex Morgan' } }),
}))

vi.mock('../store/api/notificationsApi', () => ({
  useGetNotificationsQuery: () => ({ data: [], isLoading: false }),
  useGetUnreadCountQuery: () => ({ data: { count: 0 } }),
  useMarkNotificationAsReadMutation: () => [vi.fn()],
  useMarkAllNotificationsAsReadMutation: () => [vi.fn()],
  useDeleteNotificationMutation: () => [vi.fn()],
}))

describe('sidebar accessibility', () => {
  it('supports keyboard navigation without automated violations', async () => {
    const user = userEvent.setup()
    const onLibraryClick = vi.fn()
    const { container } = render(
      <MemoryRouter>
        <SidebarNavigation collapsed={false} activePage="home" onLibraryClick={onLibraryClick} />
      </MemoryRouter>,
    )

    await user.tab()
    expect(screen.getByRole('button', { name: 'Home' })).toHaveFocus()
    screen.getByRole('button', { name: 'Library' }).focus()
    await user.keyboard('{Enter}')

    expect(onLibraryClick).toHaveBeenCalledOnce()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('exposes named topbar controls without automated violations', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter>
        <Topbar
          userName="Alex Morgan"
          sidebarCollapsed={false}
          activePage="home"
          onToggleSidebar={vi.fn()}
        />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toHaveFocus()
    expect(screen.getByText('No notifications yet')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('keeps account and settings controls accessible', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter>
        <Topbar
          userName="Alex Morgan"
          sidebarCollapsed={false}
          activePage="home"
          onToggleSidebar={vi.fn()}
        />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Open account menu' }))
    expect(await axe(container)).toHaveNoViolations()

    await user.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})
