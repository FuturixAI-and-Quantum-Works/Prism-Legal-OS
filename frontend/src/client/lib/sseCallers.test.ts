import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamProjectChat } from '../features/projects/projectsApi'
import { streamChat } from '../store/api/chatApi'
import { cancelComplianceRun, streamComplianceRun } from '../store/api/complianceApi'
import { streamWorkspaceChat } from '../store/api/drive/driveWorkspaceApi'
import {
  cancelTabularGenerate,
  cancelTabularRegenerate,
  streamTabularGenerate,
  streamTabularRegenerate,
} from '../store/api/tabularReviewApi'
import { durableRunStoragePrefix } from './apiTransport'

const originalFetch = globalThis.fetch

function installMemoryStorage() {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  })
  return storage
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('SSE callers', () => {
  type Callbacks = {
    onError: (error: Error) => void
    onComplete: () => void
  }

  const callers = [
    (callbacks: Callbacks) =>
      streamChat({
        messages: [{ role: 'user', content: 'hello' }],
        historyMode: 'record',
        onEvent: vi.fn(),
        ...callbacks,
      }),
    (callbacks: Callbacks) =>
      streamProjectChat({
        projectId: 'project-1',
        messages: [{ role: 'user', content: 'hello' }],
        onEvent: vi.fn(),
        ...callbacks,
      }),
    (callbacks: Callbacks) =>
      streamWorkspaceChat({
        workspaceId: 'workspace-1',
        messages: [{ role: 'user', content: 'hello' }],
        onEvent: vi.fn(),
        ...callbacks,
      }),
    (callbacks: Callbacks) =>
      streamComplianceRun({
        reviewId: 'review-1',
        onEvent: vi.fn(),
        ...callbacks,
      }),
    (callbacks: Callbacks) =>
      streamTabularGenerate({
        reviewId: 'review-1',
        onEvent: vi.fn(),
        ...callbacks,
      }),
  ]

  it.each(callers)('does not complete caller %#: after a server failure', async (call) => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('data: {"type":"error","message":"failed"}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )
    const onError = vi.fn()
    const onComplete = vi.fn()

    const outcome = await call({ onError, onComplete })

    expect(outcome.kind).toBe('server-error')
    expect(onError).toHaveBeenCalledOnce()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it.each([
    ['record', false],
    ['discard', true],
  ] as const)('serializes %s chat history mode', async (historyMode, ephemeral) => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('data: {"type":"done"}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )

    await streamChat({
      messages: [{ role: 'user', content: 'hello' }],
      historyMode,
      onEvent: vi.fn(),
    })

    const request = vi.mocked(globalThis.fetch).mock.calls[0]?.[1]
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>
    if (ephemeral) {
      expect(body.ephemeral).toBe(true)
    } else {
      expect(body).not.toHaveProperty('ephemeral')
    }
  })

  it('uses the compliance and tabular durable cancellation endpoints', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))

    await cancelComplianceRun('compliance-1')
    await cancelTabularGenerate('tabular-1')
    await cancelTabularRegenerate('tabular-2')

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3001/compliance-review/compliance-1/run',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    )
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3001/tabular-review/tabular-1/generate',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    )
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:3001/tabular-review/tabular-2/regenerate-cell',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    )
  })

  it('sends the persisted compliance run identity when cancelling', async () => {
    const storage = installMemoryStorage()
    storage.setItem(
      `${durableRunStoragePrefix}compliance:compliance-1`,
      JSON.stringify({ kind: 'reconnecting', runId: 'run-9', after: 4 }),
    )
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))

    await cancelComplianceRun('compliance-1')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/compliance-review/compliance-1/run?run_id=run-9',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    )
  })

  it('reconnects a completed tabular cell request through its durable stream', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ summary: 'Result' }), {
          status: 200,
          headers: { 'X-Tabular-Run-Id': 'run-3' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            'id: 1',
            'data: {"type":"cell_update","document_id":"document-1","column_index":2,"status":"done","content":{"summary":"Result"}}',
            '',
            'data: {"type":"done"}',
            '',
            '',
          ].join('\n'),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    const onEvent = vi.fn()

    const outcome = await streamTabularRegenerate({
      reviewId: 'review-1',
      mode: 'start',
      documentId: 'document-1',
      columnIndex: 2,
      onEvent,
    })

    expect(outcome.kind).toBe('success')
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3001/tabular-review/review-1/regenerate-cell?after=0&run_id=run-3',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cell_update', document_id: 'document-1' }),
    )
  })
})
