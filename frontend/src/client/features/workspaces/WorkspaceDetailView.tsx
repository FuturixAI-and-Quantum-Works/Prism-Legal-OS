import Layout from '../../components/Layout'
import { WorkspaceAddFilesDialog } from './WorkspaceAddFilesDialog'
import { WorkspaceDocumentDialogs } from './WorkspaceDocumentDialogs'
import { WorkspaceExternalOverlays } from './WorkspaceExternalOverlays'
import { WorkspaceHeader } from './WorkspaceHeader'
import { WorkspaceItemContextMenu } from './WorkspaceItemContextMenu'
import { WorkspaceMemberDialogs } from './WorkspaceMemberDialogs'
import { WorkspacePanel } from './WorkspacePanel'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import { workspaceFont } from './workspaceModels'
import { useWorkspaceDetailSession } from './useWorkspaceDetailSession'

export default function WorkspaceDetailView() {
  const session = useWorkspaceDetailSession()
  const rightPadding = session.ai.collapsed ? '64px' : `${session.ai.width + 16}px`
  return (
    <Layout activePage="projects" breadcrumbs={session.breadcrumbs}>
      {() => (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            flex: 1,
          }}
        >
          <WorkspaceHeader
            workspaceName={session.workspace?.name}
            updatedAt={session.workspace?.updated_at}
            role={session.workspace?.role}
            activeTab={session.sidebarTab}
            rightPadding={rightPadding}
            members={session.members}
            onSelectTab={session.actions.selectSidebarTab}
          />
          <div
            style={{
              flex: 1,
              display: 'flex',
              backgroundColor: '#FFFFFF',
              fontFamily: workspaceFont,
              overflow: 'hidden',
              minHeight: 0,
              paddingRight: session.ai.collapsed ? '48px' : `${session.ai.width}px`,
              transition: 'padding-right 0.2s ease',
            }}
          >
            <WorkspaceSidebar
              activeTab={session.sidebarTab}
              onSelect={session.actions.selectSidebarTab}
            />
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: '#FAFAFA',
                border: '1px solid #EDEDED',
                overflow: 'hidden',
              }}
            >
              <WorkspacePanel session={session} />
            </div>
          </div>
          <WorkspaceAddFilesDialog session={session.documents} />
          <WorkspaceDocumentDialogs session={session.documents} />
          <WorkspaceMemberDialogs
            session={session.members}
            workspaceId={session.workspaceId}
            workspaceName={session.workspace?.name}
          />
          <WorkspaceItemContextMenu session={session.documents} />
          <WorkspaceExternalOverlays session={session} />
        </div>
      )}
    </Layout>
  )
}
