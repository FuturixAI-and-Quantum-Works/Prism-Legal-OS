import { createElement, type ComponentType } from 'react'
import { appRoutePatterns } from './appRoutes'

export type RouteAccess = 'public' | 'onboarding' | 'protected'

type RouteModule = Readonly<{ default: ComponentType }>

export type RouteDefinition = Readonly<{
  path: string
  access: RouteAccess
  load: () => Promise<RouteModule>
}>

const withLayout =
  <Props extends object>(
    activePage: string,
    load: () => Promise<Readonly<{ default: ComponentType<Props> }>>,
    props?: Props,
  ) =>
  async (): Promise<RouteModule> => {
    const [{ default: Layout }, { default: Page }] = await Promise.all([
      import('./components/Layout'),
      load(),
    ])
    return {
      default: () =>
        createElement(Layout, { activePage, children: createElement(Page, props as Props) }),
    }
  }

const loadComplianceList = async (): Promise<RouteModule> => {
  const { ComplianceListFeature } = await import('./features/compliance/ComplianceListFeature')
  return { default: ComplianceListFeature }
}

const loadComplianceReview = async (): Promise<RouteModule> => {
  const { ComplianceReviewFeature } = await import('./features/compliance/ComplianceReviewFeature')
  return { default: ComplianceReviewFeature }
}

export const routeDefinitions: readonly RouteDefinition[] = [
  {
    path: '/login',
    access: 'public',
    load: () => import('./components/LoginScreen'),
  },
  {
    path: '/approval/:token',
    access: 'public',
    load: () => import('./components/pages/ApprovalDecisionPage'),
  },
  {
    path: '/share/accept/:token',
    access: 'public',
    load: () => import('./components/pages/ShareAcceptPage'),
  },
  {
    path: '/status',
    access: 'protected',
    load: () => import('./components/pages/StatusPage'),
  },
  {
    path: '*',
    access: 'public',
    load: () => import('./components/pages/NotFoundPage'),
  },
  {
    path: '/onboarding',
    access: 'onboarding',
    load: () => import('./components/ProfileOnboardingScreen'),
  },
  {
    path: '/',
    access: 'protected',
    load: () => import('./features/dashboard/DashboardFeature'),
  },
  {
    path: '/assistant',
    access: 'protected',
    load: () => import('./features/assistant/AssistantPage'),
  },
  {
    path: '/assistant/history',
    access: 'protected',
    load: () => import('./features/assistant/history/AssistantHistoryPage'),
  },
  {
    path: appRoutePatterns.workspaces,
    access: 'protected',
    load: withLayout('projects', () => import('./features/workspaces/WorkspacesFeature'), {
      filter: 'owned',
    }),
  },
  {
    path: appRoutePatterns.workspace,
    access: 'protected',
    load: () => import('./features/workspaces/WorkspaceDetailView'),
  },
  {
    path: appRoutePatterns.project,
    access: 'protected',
    load: withLayout('projects', () => import('./features/projects/ProjectDetailPage')),
  },
  {
    path: '/library',
    access: 'protected',
    load: withLayout('library', () => import('./features/documents/DocumentsFeature')),
  },
  {
    path: '/templates',
    access: 'protected',
    load: withLayout('library', () => import('./features/templates/TemplateLibraryFeature')),
  },
  {
    path: '/template-preview/:templateId',
    access: 'protected',
    load: () => import('./features/templatePreview/TemplatePreviewFeature'),
  },
  {
    path: '/shared',
    access: 'protected',
    load: withLayout('shared', () => import('./features/workspaces/WorkspacesFeature'), {
      filter: 'shared',
    }),
  },
  {
    path: '/shared-documents',
    access: 'protected',
    load: withLayout('shared-documents', () => import('./features/documents/DocumentsFeature'), {
      isShared: true,
    }),
  },
  {
    path: '/review',
    access: 'protected',
    load: () => import('./components/pages/ReviewPage'),
  },
  {
    path: '/review/:reviewId',
    access: 'protected',
    load: () => import('./components/pages/ReviewPage'),
  },
  {
    path: '/sources',
    access: 'protected',
    load: () => import('./components/pages/SourcesPage'),
  },
  {
    path: '/rulebook',
    access: 'protected',
    load: () => import('./features/rulebook/RulebookFeature'),
  },
  {
    path: '/settings',
    access: 'protected',
    load: withLayout('settings', () => import('./features/settings/SettingsFeature')),
  },
  {
    path: '/documents',
    access: 'protected',
    load: withLayout('documents', () => import('./features/documents/DocumentsFeature')),
  },
  {
    path: '/documents/new',
    access: 'protected',
    load: () => import('./features/documentEditor/DocumentEditorWorkspace'),
  },
  {
    path: appRoutePatterns.document,
    access: 'protected',
    load: () => import('./features/documentEditor/DocumentEditorWorkspace'),
  },
  {
    path: '/compliance',
    access: 'protected',
    load: loadComplianceList,
  },
  {
    path: appRoutePatterns.complianceWorkspace,
    access: 'protected',
    load: loadComplianceReview,
  },
  {
    path: appRoutePatterns.complianceDocument,
    access: 'protected',
    load: loadComplianceReview,
  },
  {
    path: appRoutePatterns.complianceReview,
    access: 'protected',
    load: loadComplianceReview,
  },
]

export const routePaths = routeDefinitions.map(({ path }) => path)
