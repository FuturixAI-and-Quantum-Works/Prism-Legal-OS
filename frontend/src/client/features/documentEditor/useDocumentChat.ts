import { useEffect, useMemo, useState } from 'react'
import type { ChatStreamEvent } from '@prism/protocol'
import type { BrowseFile } from '../files/fileBrowserTypes'
import type {
  ChatSourceResultArtifact,
  ChatToolCallArtifact,
} from '../assistant/stream/artifactTypes'
import { streamChat } from '../../store/api/chatApi'
import type { ProjectChatMessage } from '../projects/projectsApi'
import type { DocumentPlaceholderField } from '../documents/api/documentContentApi'
import {
  parseToolResult,
  updateToolCalls,
  type CompareDocumentsToolState,
  type ExtractClausesToolState,
  type SuggestEditToolState,
  type ToolCall,
} from './chatToolEvents'
import { formatChatTimestamp, isDocumentEditPrompt } from './editorUtilities'
import { parseMessageContent } from './messageParsing'
import { isPlaceholderFillPrompt, type PlaceholderPromptOutcome } from './placeholderModel'
import { getRequestErrorMessage } from '../../lib/requestErrors'

interface UseDocumentChatInput {
  addComment: (body: string) => Promise<boolean>
  canComment: boolean
  canEdit: boolean
  contextFiles: BrowseFile[]
  document: {
    filename?: string
    projectId?: string | null
    workspaceId?: string | null
  }
  documentId: string | undefined
  history: Array<{
    aiLabel?: string | null
    content: string
    createdAt?: string | null
    roleBadge: string
    userEmail?: string | null
    userName?: string | null
  }>
  onPlaceholderPrompt: (message: string) => Promise<PlaceholderPromptOutcome>
  onPlaceholderResult: (fields: DocumentPlaceholderField[], values: Record<string, string>) => void
  refreshActivity: () => unknown
  refreshHistory: () => unknown
  refreshHtml: () => unknown
  refreshPendingEdits: () => unknown
  roleBadge: string
}

export function useDocumentChat(input: UseDocumentChatInput) {
  const [messages, setMessages] = useState<ProjectChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [reasoningText, setReasoningText] = useState('')
  const [sourceResults, setSourceResults] = useState<ChatSourceResultArtifact[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [chatId, setChatId] = useState<string | null>(null)
  const [toolCalls, setToolCalls] = useState<Map<string, ToolCall>>(new Map())
  const [compareTool, setCompareTool] = useState<CompareDocumentsToolState | null>(null)
  const [clausesTool, setClausesTool] = useState<ExtractClausesToolState | null>(null)
  const [suggestTool, setSuggestTool] = useState<SuggestEditToolState | null>(null)

  useEffect(() => {
    if (messages.length > 0 || input.history.length === 0 || isSending) return
    setMessages(
      input.history.map((message) => {
        const badge =
          message.aiLabel === 'AI_LUNA_PRISM'
            ? 'AI • LUNA PRISM'
            : message.aiLabel === 'AI_LUNA'
              ? 'AI • LUNA'
              : message.roleBadge
        const name =
          message.roleBadge === 'AI'
            ? 'Luna'
            : message.userName || message.userEmail || 'Unknown user'
        return {
          role: message.roleBadge === 'AI' ? 'assistant' : 'user',
          content: message.content,
          meta: `[${formatChatTimestamp(message.createdAt)}] [${badge}] ${name}\n${message.content}`,
        }
      }),
    )
  }, [input.history, isSending, messages.length])

  const toolArtifacts = useMemo(
    () =>
      Array.from(toolCalls.values()).map((tool): ChatToolCallArtifact => ({
        id: tool.id,
        tool: tool.tool,
        input: tool.input,
        output: tool.output,
        status: tool.status,
      })),
    [toolCalls],
  )
  const cleanStreamingText = useMemo(
    () => parseMessageContent(streamingText).cleanContent,
    [streamingText],
  )

  const append = (message: ProjectChatMessage) => {
    setMessages((current) => [...current, message])
  }

  const streamLocal = async (content: string) => {
    setIsStreaming(true)
    setStreamingText('')
    const chunkSize = 5
    for (let index = chunkSize; index <= content.length + chunkSize; index += chunkSize) {
      setStreamingText(content.slice(0, Math.min(index, content.length)))
      await new Promise((resolve) => setTimeout(resolve, 18))
    }
    append({ role: 'assistant', content })
    setStreamingText('')
    setIsStreaming(false)
  }

  const send = async (messageText: string) => {
    if (!messageText || isSending) return
    const userMessage: ProjectChatMessage = { role: 'user', content: messageText }
    append(userMessage)
    setIsSending(true)
    setStreamingText('')
    setReasoningText('')
    setSourceResults([])
    setIsStreaming(true)
    setToolCalls(new Map())

    let accumulatedText = ''
    let handledStreamError = false
    const showAssistantError = (message: string) => {
      if (handledStreamError) return
      handledStreamError = true
      const cleanMessage = message.trim() || 'The AI assistant could not respond. Please try again.'
      const errorContent = cleanMessage.startsWith('Error:')
        ? cleanMessage
        : `Error: ${cleanMessage}`
      append({
        role: 'assistant',
        content: accumulatedText ? `${accumulatedText}\n\n${errorContent}` : errorContent,
      })
      setStreamingText('')
      setReasoningText('')
      setIsStreaming(false)
      setIsSending(false)
    }

    if (isPlaceholderFillPrompt(messageText)) {
      try {
        const outcome = await input.onPlaceholderPrompt(messageText)
        if (outcome.kind === 'reply') {
          append({ role: 'assistant', content: outcome.message })
        }
        setIsSending(false)
        setIsStreaming(false)
      } catch (error) {
        showAssistantError(
          getRequestErrorMessage(error, 'The placeholder workflow could not be started.'),
        )
      }
      return
    }

    if (!input.canEdit && isDocumentEditPrompt(messageText)) {
      let denial = `Access Restricted This action requires edit access. Your current role on this document is ${input.roleBadge}.\n\nYou can read and comment, but document content changes must be made by an Editor or Owner/Admin.`
      if (input.canComment && input.documentId) {
        const saved = await input.addComment(messageText)
        denial = saved
          ? "I can't make edits with your current role, so I saved that as a comment for an editor to review."
          : "I can't make edits with your current role, and I couldn't save this as a comment right now. Please add it in the Comments tab."
        if (saved) input.refreshActivity()
      }
      append({ role: 'assistant', content: denial })
      setIsSending(false)
      setIsStreaming(false)
      return
    }

    try {
      const files = [
        ...(input.documentId && input.document.filename
          ? [{ filename: input.document.filename, document_id: input.documentId }]
          : []),
        ...input.contextFiles
          .filter((file) => file.type !== 'folder')
          .map((file) => ({ filename: file.name, document_id: file.id })),
      ]
      await streamChat({
        messages: [...messages, userMessage].map((message, index, all) => ({
          role: message.role,
          content: message.content,
          files: index === all.length - 1 && files.length ? files : undefined,
        })),
        chat_id: chatId || undefined,
        project_id: input.document.projectId ?? null,
        workspace_id: input.document.workspaceId ?? null,
        historyMode: 'record',
        onEvent: (event: ChatStreamEvent) => {
          switch (event.type) {
            case 'chat_id':
              setChatId(event.chatId)
              break
            case 'doc_edited':
              input.refreshHtml()
              input.refreshPendingEdits()
              input.refreshActivity()
              break
            case 'content_delta':
            case 'text_delta':
              accumulatedText += event.text
              setStreamingText(accumulatedText)
              break
            case 'reasoning_delta':
              setReasoningText((current) => current + event.text)
              break
            case 'tool_call_start':
            case 'tool_call':
              setToolCalls((current) => updateToolCalls(current, event))
              break
            case 'tool_result': {
              setToolCalls((current) => updateToolCalls(current, event))
              const result = parseToolResult(event.tool, event.output)
              if (result.kind === 'compare') setCompareTool(result.value)
              if (result.kind === 'clauses') setClausesTool(result.value)
              if (result.kind === 'suggestions') setSuggestTool(result.value)
              if (result.kind === 'placeholders') {
                input.onPlaceholderResult(result.fields, result.values)
              }
              break
            }
            case 'source_results':
              setSourceResults((current) => [...current, ...event.results])
              break
            case 'done':
              if (!handledStreamError) {
                setIsStreaming(false)
                if (accumulatedText) append({ role: 'assistant', content: accumulatedText })
                setStreamingText('')
                setIsSending(false)
                input.refreshActivity()
                input.refreshHistory()
              }
              break
            case 'error':
              showAssistantError(event.message || 'The AI assistant could not respond.')
              break
          }
        },
        onError: (error) =>
          showAssistantError(error.message || 'The AI assistant could not respond.'),
        onComplete: () => {
          if (!handledStreamError) {
            setIsStreaming(false)
            setIsSending(false)
            input.refreshActivity()
            input.refreshHistory()
          }
        },
      })
    } catch (error) {
      showAssistantError(getRequestErrorMessage(error, 'The AI assistant could not respond.'))
    }
  }

  return {
    append,
    cleanStreamingText,
    clausesTool,
    compareTool,
    dismissClauses: () => setClausesTool(null),
    dismissCompare: () => setCompareTool(null),
    dismissSuggestions: () => setSuggestTool(null),
    isSending,
    isStreaming,
    messages,
    reasoningText,
    send,
    sourceResults,
    streamLocal,
    streamingText,
    suggestTool,
    toolArtifacts,
  }
}
