import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { BrowseFile } from '../files/fileBrowserTypes'
import type { FilePreviewFile } from '../../components/FilePreviewModal'
import { getRequestErrorMessage } from '../../lib/requestErrors'
import {
  useAddDocumentContextFileMutation,
  useGetDocumentContextFilesQuery,
  useRemoveDocumentContextFileMutation,
} from '../documents/api/documentContentApi'
import { useGetDocumentsQuery, useUploadDocumentMutation } from '../documents/api/documentCoreApi'

function fileType(value: string | null): BrowseFile['type'] {
  if (value === 'pdf') return 'pdf'
  if (value === 'doc' || value === 'docx') return 'word'
  return 'other'
}

function dateLabel(value: string | Date | null) {
  return new Date(value || '').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface UseDocumentFilesInput {
  documentId: string | undefined
  projectId?: string | null
  workspaceId?: string | null
}

export function useDocumentFiles({ documentId, projectId, workspaceId }: UseDocumentFilesInput) {
  const [uploadDocument, { isLoading: isUploading }] = useUploadDocumentMutation()
  const [addContextFile] = useAddDocumentContextFileMutation()
  const [removeContextFile] = useRemoveDocumentContextFileMutation()
  const { currentData: contextFiles } = useGetDocumentContextFilesQuery(documentId || '', {
    skip: !documentId,
  })
  const { data: documents = [] } = useGetDocumentsQuery({})
  const [browseOpen, setBrowseOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState<FilePreviewFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sidebarInputRef = useRef<HTMLInputElement>(null)
  const documentIdRef = useRef(documentId)
  documentIdRef.current = documentId

  useEffect(() => {
    setError(null)
  }, [documentId])

  const attachedFiles = useMemo(
    () =>
      (contextFiles ?? []).map((file) => ({
        id: file.context_document_id,
        name: file.filename,
        type: fileType(file.file_type),
        date: dateLabel(file.created_at),
        createdAt: new Date(file.created_at),
        extension: file.file_type,
      })),
    [contextFiles],
  )

  const browseFiles = useMemo<BrowseFile[]>(
    () =>
      documents.map((document) => ({
        id: document.id,
        name: document.filename,
        type: fileType(document.file_type),
        date: dateLabel(document.updated_at),
        createdAt: new Date(document.created_at),
        extension: document.file_type,
      })),
    [documents],
  )

  const attachExisting = async (file: BrowseFile) => {
    if (attachedFiles.some((candidate) => candidate.id === file.id)) return
    if (!documentId) return
    const targetDocumentId = documentId
    setError(null)
    try {
      await addContextFile({
        documentId: targetDocumentId,
        contextDocumentId: file.id,
      }).unwrap()
    } catch (requestError) {
      if (documentIdRef.current === targetDocumentId) {
        setError(getRequestErrorMessage(requestError, `Could not attach "${file.name}".`))
      }
      throw requestError
    }
  }

  const remove = async (fileId: string) => {
    if (!documentId) return
    const targetDocumentId = documentId
    setError(null)
    try {
      await removeContextFile({
        documentId: targetDocumentId,
        contextFileId: fileId,
      }).unwrap()
    } catch (requestError) {
      if (documentIdRef.current === targetDocumentId) {
        setError(getRequestErrorMessage(requestError, 'Could not remove the context file.'))
      }
    }
  }

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !documentId) return
    const targetDocumentId = documentId
    const formData = new FormData()
    formData.append('file', file)
    if (projectId) formData.append('project_id', projectId)
    if (workspaceId) formData.append('workspace_id', workspaceId)
    setError(null)
    try {
      const uploaded = await uploadDocument(formData).unwrap()
      await addContextFile({
        documentId: targetDocumentId,
        contextDocumentId: uploaded.id,
      }).unwrap()
      event.target.value = ''
    } catch (requestError) {
      if (documentIdRef.current === targetDocumentId) {
        setError(
          getRequestErrorMessage(requestError, `Could not upload and attach "${file.name}".`),
        )
      }
    }
  }

  return {
    attachExisting,
    attachedFiles,
    browseFiles,
    browseOpen,
    error,
    isUploading,
    openBrowse: () => setBrowseOpen(true),
    previewFile,
    remove,
    setBrowseOpen,
    setPreviewFile,
    sidebarInputRef,
    upload,
  }
}
