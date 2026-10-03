import type { ReactNode } from 'react'

export interface BreadcrumbItem {
  label: string
  icon?: ReactNode
  path?: string
}

export interface NavigationTopbarProps {
  accountDisplayName?: string
  activePage: string
  breadcrumbs?: BreadcrumbItem[]
  isMobile?: boolean
  onLogout: () => void | Promise<unknown>
  onToggleSidebar: () => void
  sidebarCollapsed: boolean
  userEmail?: string
  userName: string
}

export interface SidebarNavigationProps {
  activePage: string
  collapsed: boolean
  onLibraryClick: () => void
}
