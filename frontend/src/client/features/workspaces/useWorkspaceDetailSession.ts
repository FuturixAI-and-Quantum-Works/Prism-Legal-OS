import { createElement, useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { appRoutes } from '../../appRoutes'
import { HomeIcon, LibraryIcon, ProjectIcon } from '../../components/icons'
import { useGetWorkspaceActivityQuery } from '../../store/api/drive/driveActivityApi'
import { useGetDriveWorkspaceQuery } from '../../store/api/drive/driveWorkspaceApi'
import { useWorkspaceAnalysisSession } from './useWorkspaceAnalysisSession'
import { useWorkspaceDocumentsSession } from './useWorkspaceDocumentsSession'
import { useWorkspaceMembersSession } from './useWorkspaceMembersSession'
import type { WorkspaceSidebarTab } from './workspaceModels'

function readSidebarTab(value: string | null): WorkspaceSidebarTab {
  if (
    value === 'compliance' ||
    value === 'tabular' ||
    value === 'analysis' ||
    value === 'rulebook' ||
    value === 'activity' ||
    value === 'documents'
  ) {
    return value
  }
  return 'documents'
}

export function useWorkspaceDetailSession() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: workspace } = useGetDriveWorkspaceQuery(workspaceId, { skip: !workspaceId })
  const { data: activity = [] } = useGetWorkspaceActivityQuery(workspaceId, {
    skip: !workspaceId,
  })
  const [sidebarTab, setSidebarTab] = useState<WorkspaceSidebarTab>(() =>
    readSidebarTab(searchParams.get('tab')),
  )
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(true)
  const [aiPanelWidth, setAiPanelWidth] = useState(420)
  const readRulebookId = useCallback(() => {
    try {
      return localStorage.getItem(`prism_workspace_rulebook_${workspaceId}`) || null
    } catch {
      return null
    }
  }, [workspaceId])
  const [selectedRulebookId, setSelectedRulebookId] = useState<string | null>(readRulebookId)
  const documents = useWorkspaceDocumentsSession({
    workspaceId,
    workspaceName: workspace?.name,
  })
  const members = useWorkspaceMembersSession({ workspaceId, workspace })
  const analysis = useWorkspaceAnalysisSession(workspaceId, documents.allItems)

  useEffect(() => {
    setSelectedRulebookId(readRulebookId())
  }, [readRulebookId, sidebarTab])

  useEffect(() => {
    const requestedTab = searchParams.get('tab')
    const nextTab = readSidebarTab(requestedTab)
    if (!requestedTab || nextTab !== requestedTab) return
    setSidebarTab(nextTab)
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    const toggleAssistant = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const isTyping =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if (event.key !== '/' || isTyping) return
      event.preventDefault()
      setAiPanelCollapsed((collapsed) => !collapsed)
    }
    document.addEventListener('keydown', toggleAssistant)
    return () => document.removeEventListener('keydown', toggleAssistant)
  }, [])

  const selectSidebarTab = (tab: WorkspaceSidebarTab) => {
    setSidebarTab(tab)
    if (
      tab === 'analysis' &&
      documents.allItems.length > 0 &&
      !analysis.data &&
      !analysis.isLoading
    ) {
      void analysis.run()
    }
  }

  return {
    workspaceId,
    workspace,
    activity,
    sidebarTab,
    selectedRulebookId,
    isViewer: workspace?.role === 'viewer',
    ai: {
      collapsed: aiPanelCollapsed,
      width: aiPanelWidth,
      open: () => setAiPanelCollapsed(false),
      toggle: () => setAiPanelCollapsed((collapsed) => !collapsed),
      setWidth: setAiPanelWidth,
    },
    breadcrumbs: [
      { label: 'Home', icon: createElement(HomeIcon), path: '/' },
      { label: 'Projects', icon: createElement(LibraryIcon), path: appRoutes.workspaces },
      { label: workspace?.name ?? 'Workspace', icon: createElement(ProjectIcon) },
    ],
    documents,
    members,
    analysis,
    actions: {
      selectSidebarTab,
      closePanel: () => setSidebarTab('documents'),
    },
  }
}

export type WorkspaceDetailSession = ReturnType<typeof useWorkspaceDetailSession>
