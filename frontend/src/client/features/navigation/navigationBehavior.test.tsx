import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarNavigation } from './SidebarNavigation'
import Topbar from '../../components/Topbar'

const mocks = vi.hoisted(() => ({
  deleteNotification: vi.fn(),
  email: 'alex@example.com',
  logout: vi.fn(),
  markAllAsRead: vi.fn(),
  markAsRead: vi.fn(),
  notifications: [] as Array<Record<string, unknown>>,
  unreadCount: 0,
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    logout: mocks.logout,
    user: {
      displayName: 'Alex Morgan',
      email: mocks.email,
    },
  }),
}))

vi.mock('../../store/api/notificationsApi', () => ({
  useGetNotificationsQuery: () => ({
    data: { notifications: mocks.notifications },
    isLoading: false,
  }),
  useGetUnreadCountQuery: () => ({
    data: { unread_count: mocks.unreadCount },
  }),
  useMarkNotificationAsReadMutation: () => [
    (id: string) => ({
      unwrap: async () => mocks.markAsRead(id),
    }),
  ],
  useMarkAllNotificationsAsReadMutation: () => [
    () => ({
      unwrap: async () => mocks.markAllAsRead(),
    }),
  ],
  useDeleteNotificationMutation: () => [
    (id: string) => ({
      unwrap: async () => mocks.deleteNotification(id),
    }),
  ],
}))

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="Current route">{location.pathname}</output>
}

describe('navigation behavior', () => {
  beforeEach(() => {
    mocks.deleteNotification.mockReset()
    mocks.email = 'alex@example.com'
    mocks.logout.mockReset()
    mocks.markAllAsRead.mockReset()
    mocks.markAsRead.mockReset()
    mocks.notifications = []
    mocks.unreadCount = 0
  })

  it('expands the active sidebar group and follows its routes', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/compliance']}>
        <SidebarNavigation collapsed={false} activePage="compliance" onLibraryClick={vi.fn()} />
        <LocationProbe />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'Review' })).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('button', { name: 'Tabular Review' }))
    expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent('/review')

    await user.click(screen.getByRole('button', { name: 'Projects' }))
    await user.click(screen.getByRole('button', { name: 'Shared projects' }))
    expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent('/shared')
  })

  it('preserves document routes and collapsed group destinations', async () => {
    const user = userEvent.setup()
    const rendered = render(
      <MemoryRouter initialEntries={['/documents']}>
        <SidebarNavigation collapsed={false} activePage="documents" onLibraryClick={vi.fn()} />
        <LocationProbe />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'My Documents' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await user.click(screen.getByRole('button', { name: 'Shared Documents' }))
    expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent(
      '/shared-documents',
    )

    rendered.unmount()
    render(
      <MemoryRouter>
        <SidebarNavigation collapsed activePage="home" onLibraryClick={vi.fn()} />
        <LocationProbe />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Projects' }))
    expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent('/workspaces')
  })

  it('uses the authenticated identity and delegates logout to Better Auth', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Topbar
          userName="Fallback User"
          sidebarCollapsed={false}
          activePage="home"
          onToggleSidebar={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'Open account menu' })).toHaveTextContent('AM')

    await user.click(screen.getByRole('button', { name: 'Open account menu' }))
    expect(screen.getByText('alex@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))

    expect(mocks.logout).toHaveBeenCalledOnce()
  })

  it('does not fabricate a missing account email', async () => {
    mocks.email = ''
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Topbar
          userName="Fallback User"
          sidebarCollapsed={false}
          activePage="home"
          onToggleSidebar={vi.fn()}
        />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Open account menu' }))

    expect(screen.getByText('Not provided')).toBeInTheDocument()
    expect(screen.queryByText('user@example.com')).not.toBeInTheDocument()
  })

  it('keeps the account menu keyboard reachable and dismissible', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Topbar
          userName="Fallback User"
          sidebarCollapsed={false}
          activePage="home"
          onToggleSidebar={vi.fn()}
        />
      </MemoryRouter>,
    )

    const trigger = screen.getByRole('button', { name: 'Open account menu' })
    await user.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus()
    expect(screen.queryByRole('menuitem', { name: 'Profile' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Plans & Bills' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Need Help ?' })).not.toBeInTheDocument()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toHaveFocus()

    await user.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menuitem', { name: 'Settings' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('marks, deletes, and follows notification actions', async () => {
    const user = userEvent.setup()
    mocks.unreadCount = 1
    mocks.notifications = [
      {
        id: 'notification-1',
        icon: 'document',
        title: 'Contract ready',
        description: 'The final draft is available.',
        read: false,
        link: '/review',
        resource_type: null,
        resource_id: null,
        actor_user_id: null,
        metadata: null,
        created_at: new Date().toISOString(),
      },
      {
        id: 'notification-2',
        icon: 'system',
        title: 'Workspace updated',
        description: null,
        read: true,
        link: null,
        resource_type: null,
        resource_id: null,
        actor_user_id: null,
        metadata: null,
        created_at: new Date().toISOString(),
      },
    ]

    render(
      <MemoryRouter>
        <Topbar
          userName="Fallback User"
          sidebarCollapsed={false}
          activePage="home"
          onToggleSidebar={vi.fn()}
        />
        <LocationProbe />
      </MemoryRouter>,
    )

    const trigger = screen.getByRole('button', { name: 'Notifications, 1 unread' })
    await user.click(trigger)
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: /^Contract ready/ }))

    await waitFor(() => {
      expect(mocks.markAsRead).toHaveBeenCalledWith('notification-1')
      expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent('/review')
    })

    await user.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }))
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(mocks.markAllAsRead).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Delete notification: Workspace updated' }))
    expect(mocks.deleteNotification).toHaveBeenCalledWith('notification-2')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('keeps notifications open and reports failed actions without navigating', async () => {
    mocks.unreadCount = 1
    mocks.notifications = [
      {
        id: 'notification-1',
        icon: 'document',
        title: 'Contract ready',
        description: 'The final draft is available.',
        read: false,
        link: '/review',
        resource_type: null,
        resource_id: null,
        actor_user_id: null,
        metadata: null,
        created_at: new Date().toISOString(),
      },
    ]
    mocks.markAsRead.mockRejectedValueOnce({
      data: { detail: 'Could not update this notification.' },
    })
    mocks.markAllAsRead.mockRejectedValueOnce({
      data: { detail: 'Could not update notifications.' },
    })
    mocks.deleteNotification.mockRejectedValueOnce({
      data: { detail: 'Could not delete this notification.' },
    })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Topbar
          userName="Fallback User"
          sidebarCollapsed={false}
          activePage="home"
          onToggleSidebar={vi.fn()}
        />
        <LocationProbe />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }))
    await user.click(screen.getByRole('button', { name: /^Contract ready/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not update this notification.',
    )
    expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent('/')
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update notifications.')

    await user.click(screen.getByRole('button', { name: 'Delete notification: Contract ready' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not delete this notification.',
    )
    expect(screen.getByRole('button', { name: /^Contract ready/ })).toBeInTheDocument()
  })

  it('opens settings from the account menu and closes it with Escape', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Topbar
          userName="Fallback User"
          sidebarCollapsed={false}
          activePage="home"
          onToggleSidebar={vi.fn()}
        />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Open account menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage AI settings' })).toHaveAttribute(
      'href',
      '/settings',
    )
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/coming soon|support@prism\.com/i)).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
  })
})
