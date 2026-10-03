import { EditorSurface } from './EditorSurface'
import { EditorToolbar } from './EditorToolbar'
import { useEditorState, type TiptapEditorProps } from './useEditorState'

export default function TiptapEditorFeature({
  content,
  onContentChange,
  editable = true,
  placeholder = 'Start typing...',
  zoom = 100,
  onZoomChange,
  onFocusChange,
  onEditorReady,
}: TiptapEditorProps) {
  const { editor, handleBlur, handleFocus } = useEditorState({
    content,
    editable,
    placeholder,
    onContentChange,
    onFocusChange,
    onEditorReady,
  })

  if (!editor) return null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#FFFFFF',
      }}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {editable && <EditorToolbar editor={editor} zoom={zoom} onZoomChange={onZoomChange} />}
      <EditorSurface editor={editor} editable={editable} zoom={zoom} />
    </div>
  )
}
