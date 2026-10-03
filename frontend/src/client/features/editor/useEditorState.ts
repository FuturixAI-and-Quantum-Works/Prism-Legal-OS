import type { Editor } from '@tiptap/core'
import { useEditor } from '@tiptap/react'
import { useCallback, useEffect, useMemo, type FocusEvent } from 'react'
import { sanitizeEditorHtml } from '../../lib/sanitizeHtml'
import { createEditorExtensions } from './editorExtensions'

export interface TiptapEditorProps {
  content: string
  onContentChange?: (html: string) => void
  editable?: boolean
  placeholder?: string
  zoom?: number
  onZoomChange?: (zoom: number) => void
  onFocusChange?: (focused: boolean) => void
  onEditorReady?: (editor: Editor | null) => void
}

type EditorStateOptions = Pick<
  TiptapEditorProps,
  'content' | 'editable' | 'onContentChange' | 'onEditorReady' | 'onFocusChange' | 'placeholder'
>

export function useEditorState({
  content,
  editable = true,
  onContentChange,
  onEditorReady,
  onFocusChange,
  placeholder = 'Start typing...',
}: EditorStateOptions) {
  const safeContent = useMemo(() => sanitizeEditorHtml(content), [content])
  const editor = useEditor({
    editorProps: {
      attributes: {
        'aria-label': editable ? 'Document editor' : 'Document content',
      },
    },
    extensions: createEditorExtensions(placeholder),
    content: safeContent,
    editable,
    onUpdate: ({ editor: updatedEditor }) => {
      onContentChange?.(updatedEditor.getHTML())
    },
  })

  useEffect(() => {
    if (editor && (!editable || safeContent !== editor.getHTML())) {
      editor.commands.setContent(safeContent)
    }
  }, [editor, editable, safeContent])

  useEffect(() => {
    if (editor) editor.setEditable(editable)
  }, [editable, editor])

  useEffect(() => {
    onEditorReady?.(editor ?? null)
    return () => onEditorReady?.(null)
  }, [editor, onEditorReady])

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) onFocusChange?.(false)
    },
    [onFocusChange],
  )

  const handleFocus = useCallback(() => {
    onFocusChange?.(true)
  }, [onFocusChange])

  return {
    editor,
    handleBlur,
    handleFocus,
  }
}
