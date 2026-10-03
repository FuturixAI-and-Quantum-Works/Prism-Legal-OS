import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { HomeIcon, LibraryIcon, ProjectIcon, ProjectsIcon } from '../../components/icons'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  useAcceptDocumentEditMutation,
  useGetDocumentChatMessagesQuery,
  useGetDocumentEditsQuery,
  useGetDocumentQuery,
  useGetDocumentVersionsQuery,
  useLazyGetDocumentHtmlQuery,
  useRejectDocumentEditMutation,
} from '../documents/documentsApi'
import { useGetTemplatesQuery, type Template } from '../templates/templatesApi'
import { useAuth } from '../../hooks/useAuth'
import { useDocumentSession } from './useDocumentSession'
import { useDocumentComments } from './useDocumentComments'
import { useDocumentContent } from './useDocumentContent'
import { useVersionComparison } from './useVersionComparison'
import { useDocumentApproval } from './useDocumentApproval'
import { useDocumentSharing } from './useDocumentSharing'
import { useDocumentAudit } from './useDocumentAudit'
import { useDocumentInsights } from './useDocumentInsights'
import { useRiskFixWorkflow } from './useRiskFixWorkflow'
import { usePlaceholderWorkflow } from './usePlaceholderWorkflow'
import { useDocumentFiles } from './useDocumentFiles'
import { useDocumentChat } from './useDocumentChat'
import { DocumentEditorWorkspaceDialogs } from './DocumentEditorWorkspaceDialogs'
import { DocumentEditorWorkspaceLayout } from './DocumentEditorWorkspaceLayout'
import { useDocumentExport } from './useDocumentExport'
import { useEditorNavigation } from './useEditorNavigation'
import { useChatComposer } from './chatComposerModel'
import {
  useAnimatedPlaceholder,
  useRightPanelResize,
  useWorkspaceDropdowns,
} from './useWorkspaceUi'
import { aiSuggestions, getVisibleStatusTabs } from './workspaceOptions'
import {
  filterTemplates,
  getDocumentStatusConfig,
  getUpdatedTimeDisplay,
  getWorkspaceActivePage,
  getWorkspaceBreadcrumbs,
  type WorkspaceLocationState,
} from './workspaceViewModel'

const breadcrumbIcons = {
  home: <HomeIcon />,
  library: <LibraryIcon />,
  projects: <ProjectsIcon />,
  project: <ProjectIcon />,
}

interface DocumentEditorProps {
  documentName?: string
  creating?: boolean
}

export default function DocumentEditorWorkspace({ documentName }: DocumentEditorProps) {
  const { documentId: uuid } = useParams<{ documentId: string }>()
  const location = useLocation()
  const locationState = location.state as WorkspaceLocationState | null
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: documentData } = useGetDocumentQuery(uuid || '', { skip: !uuid })
  const {
    session: sessionContext,
    isLoading: sessionContextLoading,
    permissions,
  } = useDocumentSession(uuid, documentData?.lifecycle_status)
  const content = useDocumentContent(uuid)
  const { data: versionsData, refetch: refetchVersions } = useGetDocumentVersionsQuery(uuid || '', {
    skip: !uuid,
  })
  const audit = useDocumentAudit(uuid)
  const sharing = useDocumentSharing({
    activity: audit.activity,
    canManage: permissions.canManageSharing,
    documentId: uuid,
  })
  const { data: documentChatHistory = [], refetch: refetchChatHistory } =
    useGetDocumentChatMessagesQuery(uuid || '', { skip: !uuid })
  const { data: pendingDocumentEdits = [], refetch: refetchPendingEdits } =
    useGetDocumentEditsQuery({ documentId: uuid || '', status: 'pending' }, { skip: !uuid })
  const [loadDocumentHtml] = useLazyGetDocumentHtmlQuery()
  const [acceptDocumentEdit] = useAcceptDocumentEditMutation()
  const [rejectDocumentEdit] = useRejectDocumentEditMutation()

  const [tiptapEditor, setTiptapEditor] = useState<Editor | null>(null)
  const [activeTab, setActiveTab] = useState<'canvas' | 'tabular'>('canvas')
  const [activeStatusTab, setActiveStatusTab] = useState('prism')
  const [zoom, setZoom] = useState(100)
  const [filesPanelOpen, setFilesPanelOpen] = useState(false)
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false)
  const [chatHistoryPanelOpen, setChatHistoryPanelOpen] = useState(false)
  const [historyDropdownOpen, setHistoryDropdownOpen] = useState(false)
  const [isEditorFocused, setIsEditorFocused] = useState(false)
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false)
  const [templateSearchQuery, setTemplateSearchQuery] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)

  const files = useDocumentFiles({
    documentId: uuid,
    projectId: documentData?.project_id,
    workspaceId: documentData?.workspace_id,
  })
  const commentsModel = useDocumentComments({
    documentId: uuid,
    currentVersionId: versionsData?.current_version_id ?? null,
    canComment: permissions.canComment,
  })
  const insights = useDocumentInsights({ active: activeStatusTab === 'insights', documentId: uuid })
  const { data: templates = [] } = useGetTemplatesQuery()
  const displayedTemplates = useMemo(
    () => filterTemplates(templates, templateSearchQuery),
    [templateSearchQuery, templates],
  )

  const currentVersionId = versionsData?.current_version_id ?? null
  const versionHistory = useMemo(() => versionsData?.versions ?? [], [versionsData?.versions])
  const comparison = useVersionComparison({
    active: activeTab === 'tabular',
    currentHtml: content.content,
    currentVersionId,
    documentId: uuid,
    loadHtml: loadDocumentHtml,
    versions: versionHistory,
  })
  const visibleStatusTabs = useMemo(
    () => getVisibleStatusTabs(permissions.visibleTabs),
    [permissions.visibleTabs],
  )

  useEffect(() => {
    if (visibleStatusTabs.length && !visibleStatusTabs.some((tab) => tab.id === activeStatusTab)) {
      setActiveStatusTab(visibleStatusTabs[0].id)
    }
  }, [activeStatusTab, visibleStatusTabs])

  const lifecycleState = sessionContext?.document_state ?? documentData?.lifecycle_status ?? null
  const latestRejectionComment = useMemo(
    () =>
      commentsModel.comments.find((comment) => comment.kind === 'rejection' && !comment.resolved) ??
      null,
    [commentsModel.comments],
  )
  const approval = useDocumentApproval({
    canReview: permissions.canOwnerReviewApproval,
    canSend: permissions.canSendForApproval,
    documentId: uuid,
    refresh: () =>
      Promise.all([
        audit.refetch(),
        refetchVersions(),
        content.refetchHtml(),
        commentsModel.refetch(),
      ]),
  })
  const {
    setApproveOpen: setApprovalApproveOpen,
    setRejectOpen: setApprovalRejectOpen,
    setSendOpen: setApprovalSendOpen,
  } = approval
  const closeDialogs = useCallback(() => {
    setIsTemplateModalOpen(false)
    setApprovalSendOpen(false)
    setApprovalApproveOpen(false)
    setApprovalRejectOpen(false)
  }, [setApprovalApproveOpen, setApprovalRejectOpen, setApprovalSendOpen])
  const dropdowns = useWorkspaceDropdowns({ closeDialogs })
  const resize = useRightPanelResize()
  const animation = useAnimatedPlaceholder()
  const docName = documentData?.filename || documentName || 'Document'
  const documentExport = useDocumentExport({
    documentId: uuid,
    documentName: docName,
    html: content.content,
  })
  const placeholder = usePlaceholderWorkflow({
    autosave: () => content.autosave(refetchVersions),
    canFill: permissions.canFillPlaceholders,
    creation: {
      documentName,
      isPrimary: locationState?.isPrimary,
      workspaceId: locationState?.workspaceId,
    },
    documentId: uuid,
    navigate,
    refresh: () =>
      Promise.all([
        content.refetchHtml(),
        refetchPendingEdits(),
        refetchVersions(),
        audit.refetch(),
      ]),
    roleBadge: permissions.roleBadge,
    selectedTemplate,
  })
  const chat = useDocumentChat({
    addComment: commentsModel.addText,
    canComment: permissions.canComment,
    canEdit: permissions.canEdit,
    contextFiles: files.attachedFiles,
    document: {
      filename: documentData?.filename,
      projectId: documentData?.project_id,
      workspaceId: documentData?.workspace_id,
    },
    documentId: uuid,
    history: documentChatHistory,
    onPlaceholderPrompt: placeholder.start,
    onPlaceholderResult: placeholder.present,
    refreshActivity: audit.refetch,
    refreshHistory: refetchChatHistory,
    refreshHtml: content.refetchHtml,
    refreshPendingEdits: refetchPendingEdits,
    roleBadge: permissions.roleBadge,
  })
  const handleSavePlaceholderDetails = async () => {
    const outcome = await placeholder.submit()
    if (outcome.kind === 'reply') await chat.streamLocal(outcome.message)
  }
  const composer = useChatComposer({
    isSending: chat.isSending,
    messages: chat.messages,
    send: chat.send,
  })
  const editorNavigation = useEditorNavigation({
    editor: tiptapEditor,
    rejectionComment: latestRejectionComment,
    setActiveStatusTab,
    setActiveTab,
    setInputText: composer.setInputText,
  })
  const riskFix = useRiskFixWorkflow({
    acceptEdit: (input) => acceptDocumentEdit(input).unwrap(),
    document: {
      filename: documentData?.filename,
      projectId: documentData?.project_id,
      workspaceId: documentData?.workspace_id,
    },
    documentId: uuid,
    onAccepted: (risk) => insights.removeRisk(risk.title),
    refresh: () =>
      Promise.all([
        content.refetchHtml(),
        refetchPendingEdits(),
        refetchVersions(),
        audit.refetch(),
      ]),
    rejectEdit: (input) => rejectDocumentEdit(input).unwrap(),
  })

  const statusConfig = getDocumentStatusConfig(
    lifecycleState,
    documentData?.status ?? undefined,
    lifecycleState === 'DRAFT' && !!latestRejectionComment,
  )
  const breadcrumbs = getWorkspaceBreadcrumbs(
    locationState,
    documentData?.filename || documentName || 'New Document',
  ).map(({ icon, ...breadcrumb }) => ({
    ...breadcrumb,
    icon: icon ? breadcrumbIcons[icon] : undefined,
  }))

  return (
    <DocumentEditorWorkspaceLayout
      activePage={getWorkspaceActivePage(locationState)}
      breadcrumbs={breadcrumbs}
      canGoToFlaggedSection={permissions.canEdit && !!latestRejectionComment}
      onGoToFlaggedSection={editorNavigation.goToFlaggedSection}
      header={{
        canEditDocument: permissions.canEdit,
        canManageDocumentSharing: permissions.canManageSharing,
        canOwnerReviewApproval: permissions.canOwnerReviewApproval,
        canSendForApproval: permissions.canSendForApproval,
        displayedCollaborators: sharing.collaborators,
        docName,
        exportDisabled: !uuid || !content.contentReady || !content.content.trim(),
        exportError: documentExport.error,
        handleExportDocx: documentExport.exportDocx,
        handleExportPdf: documentExport.exportPdf,
        handleSaveVersion: content.saveVersion,
        isEditorFocused,
        isExporting: documentExport.isExporting,
        isSavingVersion: content.isSavingVersion,
        isSendingForApproval: approval.isLoading,
        moreOptionsDropdownOpen: dropdowns.moreOptionsDropdownOpen,
        moreOptionsDropdownRef: dropdowns.moreOptionsDropdownRef,
        setApprovalError: approval.setSendError,
        setApprovalModalOpen: approval.setSendOpen,
        setInviteError: sharing.setError,
        setInviteModalOpen: sharing.setOpen,
        setInviteNotice: sharing.setNotice,
        setMoreOptionsDropdownOpen: dropdowns.setMoreOptionsDropdownOpen,
        setOwnerApprovalError: approval.setReviewError,
        setOwnerApproveModalOpen: approval.setApproveOpen,
        setOwnerRejectAnchor: approval.setRejectAnchor,
        setOwnerRejectModalOpen: approval.setRejectOpen,
        setOwnerRejectNote: approval.setRejectNote,
        setOwnerRejectPage: approval.setRejectPage,
        setOwnerRejectSection: approval.setRejectSection,
        statusConfig,
        updatedTimeDisplay: getUpdatedTimeDisplay(documentData?.updated_at),
        versionSaveDisabled:
          !permissions.canEdit ||
          !uuid ||
          !content.contentReady ||
          !content.content.trim() ||
          content.isSavingVersion,
        versionSaveMessage: content.saveMessage,
      }}
      sidebar={{
        activeTab,
        attachedFilesForPanel: files.attachedFiles,
        chatHistoryPanelOpen,
        currentVersionId,
        documentChatHistory,
        documentFilename: documentData?.filename,
        filesError: files.error,
        filesPanelOpen,
        handleRemoveContextFile: files.remove,
        handleSidebarFileUpload: files.upload,
        historyDropdownOpen,
        historyPanelOpen,
        isUploadingFile: files.isUploading,
        setActiveStatusTab,
        setActiveTab,
        setBrowseFilesModalOpen: files.setBrowseOpen,
        setChatHistoryPanelOpen,
        setFilesPanelOpen,
        setHistoryDropdownOpen,
        setHistoryPanelOpen,
        setPreviewFile: files.setPreviewFile,
        sidebarFileInputRef: files.sidebarInputRef,
        versionHistory,
      }}
      canvas={{
        activeTab,
        canEditDocument: permissions.canEdit,
        currentVersion: comparison.currentVersion,
        documentContentReady: content.contentReady,
        documentFilename: documentData?.filename,
        editorContent: content.content,
        htmlError: content.htmlError,
        lifecycleState,
        loadPreviewUrlFallback: content.loadPreviewUrl,
        previewError: content.previewError,
        previewLoading: content.previewLoading,
        previewUrl: content.previewUrl,
        previousVersionCount: comparison.previousVersions.length,
        refreshVersionComparison: comparison.refresh,
        selectedComparisonVersionId: comparison.selectedVersionId,
        setBrowseFilesModalOpen: files.setBrowseOpen,
        setEditorContent: content.setContent,
        setIsEditorFocused,
        setIsTemplateModalOpen,
        setSelectedComparisonVersionId: comparison.select,
        setTiptapEditor,
        setZoom,
        uuid,
        versionComparisonError: comparison.error,
        versionComparisonLoading: comparison.loading,
        versionComparisons: comparison.rows,
        zoom,
      }}
      rightPanel={{
        activeStatusTab,
        audit,
        bottleneckMatchIndexes: editorNavigation.bottleneckMatchIndexes,
        bottleneckToast: editorNavigation.bottleneckToast,
        canCommentDocument: permissions.canComment,
        canEditDocument: permissions.canEdit,
        canFillPlaceholders: permissions.canFillPlaceholders,
        canResolveComments: permissions.canResolveComments,
        chatMessages: chat.messages,
        cleanStreamingText: chat.cleanStreamingText,
        commentsModel,
        dismissClauses: chat.dismissClauses,
        dismissCompare: chat.dismissCompare,
        dismissSuggestions: chat.dismissSuggestions,
        editActionId: placeholder.editActionId,
        handleKeyDown: composer.handleKeyDown,
        handleOpenFixRiskModal: riskFix.open,
        handlePlaceholderValueChange: placeholder.change,
        handleResolveTrackedEdit: placeholder.resolveEdit,
        handleSavePlaceholderDetails,
        handleSendMessage: composer.handleSendMessage,
        inputText: composer.inputText,
        insights,
        isAnimating: animation.isAnimating,
        isResizing: resize.isResizing,
        isSending: chat.isSending,
        isStreaming: chat.isStreaming,
        compareTool: chat.compareTool,
        extractTool: chat.clausesTool,
        suggestTool: chat.suggestTool,
        toolArtifacts: chat.toolArtifacts,
        messagesEndRef: composer.messagesEndRef,
        placeholderIndex: animation.placeholderIndex,
        placeholderTool: placeholder.tool,
        placeholderValues: placeholder.values,
        pendingDocumentEdits,
        reasoningText: chat.reasoningText,
        resizeRef: resize.resizeRef,
        rightPanelWidth: resize.rightPanelWidth,
        scrollAndHighlightBottleneck: editorNavigation.scrollAndHighlightBottleneck,
        sessionContextLoading,
        setActiveStatusTab,
        setBottleneckMatchIndexes: editorNavigation.setBottleneckMatchIndexes,
        setInputText: composer.setInputText,
        setIsResizing: resize.setIsResizing,
        sourceResults: chat.sourceResults,
        streamingText: chat.streamingText,
        suggestions: aiSuggestions,
        tiptapEditor,
        userName: user?.displayName?.split(' ')[0] || 'User',
        uuid,
        visibleStatusTabs,
      }}
    >
      <DocumentEditorWorkspaceDialogs
        approval={approval}
        canManageSharing={permissions.canManageSharing}
        canOwnerReviewApproval={permissions.canOwnerReviewApproval}
        canSendForApproval={permissions.canSendForApproval}
        displayedTemplates={displayedTemplates}
        files={files}
        isTemplateModalOpen={isTemplateModalOpen}
        onEditFile={(fileId) => navigate(`/documents/${fileId}`)}
        riskFix={riskFix}
        setEditorContent={content.setContent}
        setIsTemplateModalOpen={setIsTemplateModalOpen}
        setSelectedTemplate={setSelectedTemplate}
        setTemplateSearchQuery={setTemplateSearchQuery}
        sharing={sharing}
        templateSearchQuery={templateSearchQuery}
      />
    </DocumentEditorWorkspaceLayout>
  )
}
