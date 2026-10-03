import { describe, expect, it } from 'vitest'
import { routeDefinitions } from '../../routeManifest'
import {
  getDefaultBreadcrumb,
  intelligenceNavigationItems,
  isNavigationGroupRoute,
  isNavigationItemActive,
  navigationGroupsById,
  primaryNavigationItems,
  workspaceNavigation,
} from './navigationModel'

describe('navigation model', () => {
  it('keeps every navigation destination in the route manifest', () => {
    const sidebarItems = [
      ...primaryNavigationItems,
      ...workspaceNavigation.flatMap((entry) =>
        entry.kind === 'item' ? [entry.item] : entry.group.items,
      ),
      ...intelligenceNavigationItems,
    ]
    const sidebarPaths = sidebarItems.flatMap((item) =>
      item.target.kind === 'route' ? [item.target.path] : [],
    )
    const breadcrumbPaths = [
      'home',
      'assistant',
      'projects',
      'library',
      'templates',
      'shared',
      'review',
      'compliance',
      'sources',
      'rulebook',
      'settings',
      'documents',
    ].map((page) => getDefaultBreadcrumb(page).path)

    expect(
      [...new Set([...sidebarPaths, ...breadcrumbPaths])].filter(
        (path) => !routeDefinitions.some((route) => route.path === path),
      ),
    ).toEqual([])
  })

  it('keeps the established sidebar route groups', () => {
    expect(navigationGroupsById.projects.routes).toEqual(['/workspaces', '/shared'])
    expect(navigationGroupsById.documents.routes).toEqual(['/documents', '/shared-documents'])
    expect(navigationGroupsById.review.routes).toEqual(['/review', '/compliance'])

    expect(isNavigationGroupRoute(navigationGroupsById.projects, '/shared')).toBe(true)
    expect(isNavigationGroupRoute(navigationGroupsById.review, '/review/123')).toBe(false)
  })

  it('derives active items from the page and exact route contract', () => {
    const home = primaryNavigationItems[0]

    expect(isNavigationItemActive(home, 'home', '/workspaces')).toBe(true)
    expect(isNavigationItemActive(home, 'projects', '/')).toBe(false)
  })

  it('maps known breadcrumbs and falls back to home', () => {
    expect(getDefaultBreadcrumb('templates')).toEqual({
      label: 'Templates',
      path: '/templates',
    })
    expect(getDefaultBreadcrumb('unknown')).toEqual({
      label: 'Unknown',
      path: '/',
    })
  })
})
