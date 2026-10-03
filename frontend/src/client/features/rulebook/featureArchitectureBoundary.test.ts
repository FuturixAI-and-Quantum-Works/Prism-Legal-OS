import { describe, expect, it } from 'vitest'

const sourceFiles = import.meta.glob('../../**/*.{ts,tsx}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const removedCompatibilityFiles = [
  'components/AiAssistantPanel.tsx',
  'components/BrowseFilesModal.tsx',
  'components/CreateWorkspaceModal.tsx',
  'components/DocumentsScreen.tsx',
  'components/Dashboard.tsx',
  'components/LibraryDocumentsScreen.tsx',
  'components/LibraryTemplatesScreen.tsx',
  'components/TiptapEditor.tsx',
  'components/WorkspacesScreen.tsx',
  'components/chat/ChatInput.tsx',
  'components/chat/ChatInputConfig.ts',
  'components/chat/ChatStreamArtifacts.tsx',
  'components/pages/AnalysisPanel.tsx',
  'components/pages/AssistantHistoryPage.tsx',
  'components/pages/AssistantPage.tsx',
  'components/pages/CompliancePage.tsx',
  'components/pages/DocsCompliancePage.tsx',
  'components/pages/DocumentEditorPage.tsx',
  'components/pages/RulebookPage.tsx',
  'components/pages/SettingsPage.tsx',
  'components/pages/TemplatePreviewPage.tsx',
  'components/pages/WorkspaceDetailPage.tsx',
  'features/documentEditor/ChatArtifacts.tsx',
  'store/api/documentsApi.ts',
  'store/api/driveApi.ts',
  'store/api/projectsApi.ts',
  'store/api/templatesApi.ts',
]

const featureFiles = [
  'features/documents/DocumentsFeature.tsx',
  'features/documents/useDocumentsScreen.ts',
  'features/documents/documentLibraryModel.ts',
  'features/documents/DocumentsToolbar.tsx',
  'features/documents/DocumentsContent.tsx',
  'features/documents/DocumentsEmptyState.tsx',
  'features/documents/DocumentCard.tsx',
  'features/documents/DocumentActions.tsx',
  'features/documents/documentActionOptions.ts',
  'features/documents/DocumentDialogs.tsx',
  'features/documents/DocumentShareDialog.tsx',
  'features/dashboard/dashboardModel.ts',
  'features/dashboard/useDashboard.ts',
  'features/dashboard/DashboardFeature.tsx',
  'features/dashboard/DashboardFeatureCards.tsx',
  'features/dashboard/DashboardActivityPanels.tsx',
  'features/dashboard/DashboardAccessRequests.tsx',
  'features/dashboard/DashboardReviewDialog.tsx',
  'features/dashboard/DashboardAssistant.tsx',
  'features/templates/templateLibraryModel.ts',
  'features/templates/useTemplateLibrary.ts',
  'features/templates/TemplateLibraryToolbar.tsx',
  'features/templates/TemplateCard.tsx',
  'features/templates/TemplateGrid.tsx',
  'features/templates/TemplateDialogs.tsx',
  'features/templates/TemplateContextMenu.tsx',
  'features/templates/TemplateLibraryFeature.tsx',
  'features/rulebook/rulebookModel.ts',
  'features/rulebook/rulebookStyles.ts',
  'features/rulebook/RulebookFields.tsx',
  'features/rulebook/useRulebookListSession.ts',
  'features/rulebook/RulebookList.tsx',
  'features/rulebook/RulebookContextMenu.tsx',
  'features/rulebook/useRulebookEditor.ts',
  'features/rulebook/RulebookFaqRow.tsx',
  'features/rulebook/RulebookEditorDialog.tsx',
  'features/rulebook/useCreateRulebookReview.ts',
  'features/rulebook/CreateRulebookReviewDialog.tsx',
  'features/rulebook/RulebookFeature.tsx',
]

function sourcePath(path: string): string {
  return path.startsWith('features/rulebook/')
    ? `./${path.slice('features/rulebook/'.length)}`
    : path.startsWith('features/')
      ? `../${path.slice('features/'.length)}`
      : `../../${path}`
}

function lineCount(path: string): number {
  const source = sourceFiles[sourcePath(path)]
  if (!source) throw new Error(`Architecture boundary file not found: ${path}`)
  return source.split(/\r?\n/).length
}

describe('screen architecture boundaries', () => {
  it.each(removedCompatibilityFiles)('does not retain compatibility facade %s', (path) => {
    expect(sourceFiles[sourcePath(path)]).toBeUndefined()
  })

  it.each(featureFiles)('%s stays below 700 lines', (path) => {
    expect(lineCount(path)).toBeLessThanOrEqual(700)
  })
})
