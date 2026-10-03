import { useRef, useState, type ChangeEvent } from 'react'
import AiAssistantPanel from '../assistant/panel/AiAssistantPanel'
import BrowseFilesModal from '../files/BrowseFilesDialog'
import { ProjectIcon } from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { DirectoryInput } from '../../components/ui/DirectoryInput'
import { getRequestErrorMessage } from '../../lib/requestErrors'
import {
  useDeleteDocumentMutation,
  useUpdateDocumentMutation,
  useUploadDocumentMutation,
} from '../documents/api/documentCoreApi'
import { dashboardFontFamily, formatDashboardRelativeTime } from './dashboardModel'
import type { DashboardSession } from './useDashboard'

type DashboardAssistantSession = Pick<
  DashboardSession,
  | 'aiPanelCollapsed'
  | 'aiPanelWidth'
  | 'browseFiles'
  | 'browseFilesModalOpen'
  | 'isWorkspacesEmpty'
  | 'recentWorkspaces'
  | 'userName'
> & {
  actions: Pick<
    DashboardSession['actions'],
    | 'openWorkspace'
    | 'selectFile'
    | 'setAiPanelCollapsed'
    | 'setAiPanelWidth'
    | 'setBrowseFilesModalOpen'
  >
}

function AssistantContinueWorking({ session }: { session: DashboardAssistantSession }) {
  if (session.recentWorkspaces.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <p
        style={{
          fontFamily: dashboardFontFamily,
          fontSize: '14px',
          fontWeight: 510,
          color: '#6B6B6B',
          letterSpacing: '-0.7px',
          lineHeight: '16px',
          margin: '0 0 4px 0',
        }}
      >
        Continue working
      </p>
      {session.recentWorkspaces.map((workspace) => (
        <Button
          key={workspace.id}
          onClick={() => session.actions.openWorkspace(workspace.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 12px',
            backgroundColor: '#F7F7F7',
            borderRadius: '10px',
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
            border: 'none',
            width: '100%',
            textAlign: 'left',
            fontFamily: dashboardFontFamily,
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.backgroundColor = '#EFEFEF'
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.backgroundColor = '#F7F7F7'
          }}
        >
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ProjectIcon />
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              minWidth: 0,
              flex: 1,
            }}
          >
            <p
              style={{
                fontFamily: dashboardFontFamily,
                fontSize: '14px',
                fontWeight: 510,
                color: '#272727',
                letterSpacing: '-0.7px',
                lineHeight: '18px',
                margin: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {workspace.name || 'Untitled Workspace'}
            </p>
            <p
              style={{
                fontFamily: dashboardFontFamily,
                fontSize: '12px',
                fontWeight: 400,
                color: '#6B6B6B',
                letterSpacing: '-0.6px',
                lineHeight: '14px',
                margin: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {workspace.file_count} files · Last edited{' '}
              {formatDashboardRelativeTime(new Date(workspace.updated_at || workspace.created_at))}
            </p>
          </div>
        </Button>
      ))}
    </div>
  )
}

export function DashboardAssistant({
  session,
  onAddProject,
}: {
  session: DashboardAssistantSession
  onAddProject: () => void
}) {
  const { actions } = session
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [deleteDocument] = useDeleteDocumentMutation()
  const [updateDocument] = useUpdateDocumentMutation()
  const [uploadDocument] = useUploadDocumentMutation()
  const [uploadError, setUploadError] = useState('')

  const uploadFiles = async (files: readonly File[]) => {
    await Promise.all(
      files.map((file) => {
        const formData = new FormData()
        formData.append('file', file)
        return uploadDocument(formData).unwrap()
      }),
    )
  }

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    setUploadError('')
    void uploadFiles(files).catch((error) => {
      setUploadError(getRequestErrorMessage(error, 'Could not upload all selected documents.'))
    })
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.txt,.rtf,.odt,.jpg,.jpeg,.png,.webp,.bmp"
        aria-label="Import documents"
        onChange={handleUpload}
        style={{ display: 'none' }}
      />
      <DirectoryInput
        ref={folderInputRef}
        accept=".pdf,.doc,.docx,.txt,.rtf,.odt,.jpg,.jpeg,.png,.webp,.bmp"
        aria-label="Upload document folder"
        onChange={handleUpload}
        style={{ display: 'none' }}
      />
      <BrowseFilesModal
        isOpen={session.browseFilesModalOpen}
        error={uploadError}
        onClose={() => {
          setUploadError('')
          actions.setBrowseFilesModalOpen(false)
        }}
        files={session.browseFiles}
        onImport={() => fileInputRef.current?.click()}
        onSelectFile={actions.selectFile}
        onUploadFolder={() => folderInputRef.current?.click()}
        onDeleteFiles={(fileIds) =>
          Promise.all(fileIds.map((fileId) => deleteDocument(fileId).unwrap())).then(
            () => undefined,
          )
        }
        onRenameFile={(fileId, name) =>
          updateDocument({ id: fileId, name })
            .unwrap()
            .then(() => undefined)
        }
      />

      <AiAssistantPanel
        userName={session.userName}
        collapsed={session.aiPanelCollapsed}
        onToggle={() => actions.setAiPanelCollapsed(!session.aiPanelCollapsed)}
        width={session.aiPanelWidth}
        onWidthChange={actions.setAiPanelWidth}
        minWidth={320}
        maxWidth={570}
        hideActionCards={true}
        isProjectsEmpty={session.isWorkspacesEmpty}
        onCreateProject={onAddProject}
        continueWorkingContent={<AssistantContinueWorking session={session} />}
      />
    </>
  )
}
