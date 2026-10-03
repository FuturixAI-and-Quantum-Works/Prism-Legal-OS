import { useCallback, useRef, useState } from 'react'
import type { AnalysisData } from '../analysis/analysisModel'
import {
  streamWorkspaceChat,
  type WorkspaceChatStreamEvent,
} from '../../store/api/drive/driveWorkspaceApi'
import { getRequestErrorMessage } from '../../lib/requestErrors'
import { parseWorkspaceAnalysis } from './workspaceModels'
import type { WorkspaceItem } from './workspaceModels'

function analysisPrompt(items: WorkspaceItem[]) {
  const documentNames = items.map((item) => item.name || 'Untitled').join(', ')
  return `Analyze all documents in this workspace and provide a comprehensive analysis. The workspace contains: ${documentNames}.

IMPORTANT: You must respond with ONLY a valid JSON object, no other text before or after. Use this exact structure:

{
  "summaries": [
    {
      "id": "unique-id",
      "documentName": "Document Name",
      "purpose": "Brief description of the document's purpose",
      "mainPoints": ["Point 1", "Point 2", "Point 3"]
    }
  ],
  "risks": [
    {
      "id": "unique-id",
      "title": "Risk Title",
      "category": "Finance|Legal|Compliance|Operational",
      "description": "Detailed description of the risk",
      "severity": "high|medium|low"
    }
  ],
  "clauses": [
    {
      "id": "unique-id",
      "title": "Clause Title",
      "documentName": "Source Document",
      "type": "Liability|Termination|Obligation|Indemnification|Other",
      "content": "Summary of the clause content"
    }
  ]
}

Analyze thoroughly and include all relevant findings.`
}

export function useWorkspaceAnalysisSession(workspaceId: string, items: WorkspaceItem[]) {
  const [data, setData] = useState<AnalysisData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async () => {
    if (!workspaceId || items.length === 0 || isLoading) return
    setIsLoading(true)
    setError(null)
    abortRef.current = new AbortController()
    let response = ''
    try {
      const outcome = await streamWorkspaceChat({
        workspaceId,
        messages: [{ role: 'user', content: analysisPrompt(items) }],
        onEvent: (event: WorkspaceChatStreamEvent) => {
          if (event.type === 'text_delta' || event.type === 'content_delta') response += event.text
        },
        onError: (streamError) => {
          console.error('Analysis stream error:', streamError)
          setError(streamError.message || 'Failed to analyze documents')
        },
        signal: abortRef.current.signal,
      })
      if (outcome.kind !== 'success') return
      try {
        setData(parseWorkspaceAnalysis(response))
      } catch (parseError) {
        console.error('Failed to parse analysis response:', parseError, response)
        setError('Failed to parse analysis results. Please try again.')
      }
    } catch (requestError) {
      if (!(requestError instanceof Error && requestError.name === 'AbortError')) {
        console.error('Analysis failed:', requestError)
        setError(getRequestErrorMessage(requestError, 'Failed to analyze documents'))
      }
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, items, workspaceId])

  return { data, isLoading, error, run }
}
