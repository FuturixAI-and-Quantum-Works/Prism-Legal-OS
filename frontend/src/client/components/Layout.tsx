import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { appRoutes } from '../appRoutes'
import { SidebarNavigation } from '../features/navigation/SidebarNavigation'
import Topbar, { BreadcrumbItem } from './Topbar'
import LibraryPanel from './LibraryPanel'
import { useResponsive } from '../hooks'
import CreateWorkspaceModal from '../features/workspaces/CreateWorkspaceModal'
import { AccessibleDialog } from './ui/AccessibleDialog'

const fontFamily = '-apple-system, BlinkMacSystemFont, "SF Pro", "Segoe UI", Roboto, sans-serif'

interface LayoutProps {
  children: ReactNode | ((props: { onAddProject: () => void }) => ReactNode)
  userName?: string
  activePage?: string
  breadcrumbs?: BreadcrumbItem[]
  forceSidebarCollapsed?: boolean
}

export default function Layout({
  children,
  userName = 'User',
  activePage = 'home',
  breadcrumbs,
  forceSidebarCollapsed,
}: LayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isMobile } = useResponsive()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('prism_sidebar_collapsed')
    return saved !== null ? saved === 'true' : true
  })
  const [sidebarHovered, setSidebarHovered] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [libraryPanelOpen, setLibraryPanelOpen] = useState(false)
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false)

  useEffect(() => {
    if (forceSidebarCollapsed !== undefined) {
      setSidebarCollapsed(forceSidebarCollapsed)
    }
  }, [forceSidebarCollapsed])

  useEffect(() => {
    localStorage.setItem('prism_sidebar_collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    setMobileSidebarOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target
      const isInput =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (isInput) return

      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault()
        if (isMobile) {
          setMobileSidebarOpen((previous) => !previous)
        } else {
          setSidebarCollapsed((previous) => !previous)
        }
      }
      if (
        e.ctrlKey &&
        (e.key === '+' || e.key === '=') &&
        location.pathname === appRoutes.workspaces
      ) {
        e.preventDefault()
        setCreateProjectModalOpen((prev) => !prev)
      }
      if (e.key === '/') {
        const aiPanel = document.querySelector('[data-ai-panel]')
        if (!aiPanel) {
          e.preventDefault()
          document.querySelector<HTMLInputElement>('[data-global-search]')?.focus()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMobile, location.pathname])

  const handleAddProject = () => {
    setCreateProjectModalOpen(true)
  }

  const handleLibraryItemSelect = (itemId: string) => {
    if (itemId === 'documents') {
      navigate('/documents')
    } else if (itemId === 'templates') {
      navigate('/templates')
    }
  }

  const handleToggleSidebar = () => {
    if (isMobile) {
      setMobileSidebarOpen((open) => !open)
    } else {
      setSidebarCollapsed((collapsed) => !collapsed)
    }
  }

  const sidebar = (
    <SidebarNavigation
      collapsed={isMobile ? false : sidebarCollapsed && !sidebarHovered}
      activePage={activePage}
      onLibraryClick={() => {
        setLibraryPanelOpen((open) => !open)
        if (isMobile) setMobileSidebarOpen(false)
      }}
    />
  )

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        backgroundColor: '#F9F9F9',
        fontFamily,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {isMobile ? (
        <AccessibleDialog
          open={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
          label="Navigation menu"
          overlayStyle={{
            alignItems: 'stretch',
            justifyContent: 'flex-start',
            position: 'fixed',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 998,
          }}
          contentStyle={{
            position: 'fixed',
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 999,
          }}
        >
          {sidebar}
        </AccessibleDialog>
      ) : (
        <div
          style={{
            position: 'relative',
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 'auto',
            transform: 'translateX(0)',
            transition: 'transform 0.3s ease',
          }}
          onMouseEnter={() => setSidebarHovered(true)}
          onMouseLeave={() => setSidebarHovered(false)}
        >
          {sidebar}
        </div>
      )}

      {!isMobile && (
        <LibraryPanel
          open={libraryPanelOpen}
          sidebarCollapsed={sidebarCollapsed && !sidebarHovered}
          onClose={() => setLibraryPanelOpen(false)}
          onItemSelect={handleLibraryItemSelect}
        />
      )}

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <Topbar
          userName={userName}
          sidebarCollapsed={isMobile ? !mobileSidebarOpen : sidebarCollapsed && !sidebarHovered}
          activePage={activePage}
          onToggleSidebar={handleToggleSidebar}
          isMobile={isMobile}
          breadcrumbs={breadcrumbs}
        />

        <main
          style={{
            flex: 1,
            overflow: 'auto',
            display: 'flex',
          }}
        >
          {typeof children === 'function' ? children({ onAddProject: handleAddProject }) : children}
        </main>
      </div>

      <CreateWorkspaceModal
        open={createProjectModalOpen}
        onClose={() => setCreateProjectModalOpen(false)}
      />
    </div>
  )
}
