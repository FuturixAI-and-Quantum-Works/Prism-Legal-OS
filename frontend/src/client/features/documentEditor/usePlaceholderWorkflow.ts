import { useState } from 'react'
import {
  useApplyDocumentPlaceholdersMutation,
  useLazyGetDocumentPlaceholdersQuery,
  useSaveDocumentPlaceholderValuesMutation,
} from '../documents/api/documentContentApi'
import { useCreateDocumentMutation } from '../documents/api/documentCoreApi'
import {
  type DocumentEditAnnotation,
  useAcceptDocumentEditMutation,
  useRejectDocumentEditMutation,
} from '../documents/api/documentVersionsApi'
import { useCreateDocumentFromTemplateMutation, type Template } from '../templates/templatesApi'
import {
  type PlaceholderToolState,
  type PlaceholderPromptOutcome,
  type PlaceholderSubmitOutcome,
  placeholderValues as createPlaceholderValues,
  templatePlaceholderFields,
  updatePlaceholderValue,
} from './placeholderModel'

interface UsePlaceholderWorkflowInput {
  autosave: () => Promise<unknown>
  canFill: boolean
  creation: {
    documentName?: string
    isPrimary?: boolean
    projectId?: string
    workspaceId?: string
  }
  documentId: string | undefined
  navigate: (path: string) => void
  refresh: () => Promise<unknown>
  roleBadge: string
  selectedTemplate: Template | null
}

export function usePlaceholderWorkflow({
  autosave,
  canFill,
  creation,
  documentId,
  navigate,
  refresh,
  roleBadge,
  selectedTemplate,
}: UsePlaceholderWorkflowInput) {
  const [createDocument] = useCreateDocumentMutation()
  const [createFromTemplate] = useCreateDocumentFromTemplateMutation()
  const [loadPlaceholders] = useLazyGetDocumentPlaceholdersQuery()
  const [saveValues] = useSaveDocumentPlaceholderValuesMutation()
  const [applyPlaceholders] = useApplyDocumentPlaceholdersMutation()
  const [acceptEdit] = useAcceptDocumentEditMutation()
  const [rejectEdit] = useRejectDocumentEditMutation()
  const [tool, setTool] = useState<PlaceholderToolState | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [editActionId, setEditActionId] = useState<string | null>(null)

  const start = async (message: string): Promise<PlaceholderPromptOutcome> => {
    if (!documentId && selectedTemplate?.fields?.length) {
      const fields = templatePlaceholderFields(selectedTemplate)
      const initialValues = createPlaceholderValues(fields)
      setValues(initialValues)
      setTool({ fields, values: initialValues, status: 'collecting', message })
      return { kind: 'presented' }
    }
    if (!documentId) {
      return {
        kind: 'reply',
        message:
          'Open a document first or select a template, then I can help fill its placeholders.',
      }
    }
    if (!canFill) {
      return {
        kind: 'reply',
        message: `Access Restricted This action requires Drafter access. Your current role on this document is ${roleBadge}.\n\nOnly a Drafter or Owner/Admin can fill placeholders. Please ask the Drafter to complete the guided interview.`,
      }
    }

    setTool(null)
    try {
      await autosave()
      const response = await loadPlaceholders(documentId).unwrap()
      const initialValues = createPlaceholderValues(response.fields)
      setValues(initialValues)
      if (response.fields.length === 0) {
        return {
          kind: 'reply',
          message:
            'I checked the open document and did not find any {{fieldKey}} or [Field Label] placeholders to fill.',
        }
      }
      setTool({
        fields: response.fields,
        values: initialValues,
        status: 'collecting',
        message,
      })
      return { kind: 'presented' }
    } catch {
      setTool({
        fields: [],
        values: {},
        status: 'error',
        message: 'Could not read placeholders from this document. Please try again.',
      })
      return { kind: 'presented' }
    }
  }

  const change = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    setTool((current) => (current ? updatePlaceholderValue(current, key, value) : current))
  }

  const present = (fields: PlaceholderToolState['fields'], nextValues: Record<string, string>) => {
    setValues(nextValues)
    setTool({ fields, values: nextValues, status: 'collecting' })
  }

  const submit = async (): Promise<PlaceholderSubmitOutcome> => {
    if (!tool || tool.status === 'saving') {
      return { kind: 'idle' }
    }
    setTool((current) =>
      current ? { ...current, status: 'saving', message: 'Saving details...' } : current,
    )
    try {
      if (!documentId && selectedTemplate) {
        const name = creation.documentName || selectedTemplate.name
        const created =
          selectedTemplate.sourceFilename || selectedTemplate.sourceStoragePath
            ? await createFromTemplate({
                id: selectedTemplate.id,
                data: {
                  name,
                  filename: `${name}.docx`,
                  values,
                  project_id: creation.projectId || null,
                  workspace_id: creation.workspaceId || null,
                  is_primary: creation.isPrimary ?? true,
                },
              }).unwrap()
            : await createDocument({
                name,
                filename: `${name}.docx`,
                content_html: selectedTemplate.contentHtml,
                project_id: creation.projectId || null,
                workspace_id: creation.workspaceId || null,
                is_primary: creation.isPrimary ?? true,
              }).unwrap()
        if (!selectedTemplate.sourceFilename && !selectedTemplate.sourceStoragePath) {
          await saveValues({ documentId: created.id, values }).unwrap()
          await applyPlaceholders({
            documentId: created.id,
            confirm: 'Confirm and fill',
          }).unwrap()
        }
        setTool((current) =>
          current
            ? { ...current, status: 'applied', message: 'Document created. Redirecting...' }
            : current,
        )
        window.setTimeout(() => navigate(`/documents/${created.id}`), 1000)
        return { kind: 'redirecting' }
      }
      if (!documentId) return { kind: 'idle' }
      await saveValues({ documentId, values }).unwrap()
      const applied = await applyPlaceholders({
        documentId,
        confirm: 'Confirm and fill',
      }).unwrap()
      await refresh()
      const message =
        applied.applied > 0
          ? `Created ${applied.applied} tracked placeholder change${applied.applied === 1 ? '' : 's'}. Review them below.`
          : 'No placeholder changes were needed.'
      setTool((current) => (current ? { ...current, status: 'applied', message } : current))
      return {
        kind: 'reply',
        message:
          applied.applied > 0
            ? `I saved the details and created ${applied.applied} tracked placeholder change${applied.applied === 1 ? '' : 's'} for review.`
            : 'I saved the details. There were no remaining placeholders to replace.',
      }
    } catch (error) {
      setTool((current) =>
        current
          ? {
              ...current,
              status: 'error',
              message: error instanceof Error ? error.message : 'Could not apply placeholders.',
            }
          : current,
      )
      return { kind: 'failed' }
    }
  }

  const resolveEdit = async (edit: DocumentEditAnnotation, mode: 'accept' | 'reject') => {
    if (!documentId || editActionId) return
    setEditActionId(edit.edit_id)
    try {
      const mutation = mode === 'accept' ? acceptEdit : rejectEdit
      await mutation({ documentId, editId: edit.edit_id }).unwrap()
      await refresh()
    } finally {
      setEditActionId(null)
    }
  }

  return { change, editActionId, present, resolveEdit, start, submit, tool, values }
}
