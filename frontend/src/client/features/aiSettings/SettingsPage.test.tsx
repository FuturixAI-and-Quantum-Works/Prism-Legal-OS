import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '../settings/SettingsFeature'

const api = vi.hoisted(() => ({
  loadAiSettings: vi.fn(),
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
  testConnection: vi.fn(),
  savePreference: vi.fn(),
}))

vi.mock('./aiSettingsApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('./aiSettingsApi')>()
  return { ...original, ...api }
})

const capabilities = {
  input: { text: true, image: false, pdf: false },
  output: { text: true, structured: false, toolCalls: false },
}

function targetValue(connectionId: string, modelId: string) {
  return JSON.stringify([connectionId, modelId])
}

const snapshot = {
  connections: [
    {
      id: 'server-1',
      provider: 'anthropic',
      name: 'Company Claude',
      source: 'server',
      baseUrl: null,
      enabled: true,
      hasCredential: true,
      models: [],
      credential: 'server-secret-never-render',
    },
    {
      id: 'user-1',
      provider: 'openai',
      name: 'Personal OpenAI',
      source: 'user',
      baseUrl: null,
      enabled: true,
      hasCredential: true,
      models: [],
      credential: 'personal-secret-never-render',
    },
    {
      id: 'disabled-1',
      provider: 'openai-compatible',
      name: 'Disabled gateway',
      source: 'user',
      baseUrl: 'https://gateway.example.com/v1',
      enabled: false,
      hasCredential: true,
      models: [
        {
          id: 'disabled-title',
          providerModelId: 'renamable-model',
          displayName: 'Disabled Title',
          capabilities,
          tasks: ['title'],
        },
      ],
    },
  ],
  models: [
    {
      id: 'chat-model',
      provider: 'openai',
      providerModelId: 'gpt-main',
      displayName: 'Chat Model',
      capabilities,
      tasks: ['main'],
      connectionId: 'user-1',
      connectionName: 'Personal OpenAI',
      connectionSource: 'user',
    },
    {
      id: 'table-model',
      provider: 'openai',
      providerModelId: 'gpt-table',
      displayName: 'Table Model',
      capabilities,
      tasks: ['tabular'],
      connectionId: 'user-1',
      connectionName: 'Personal OpenAI',
      connectionSource: 'user',
    },
    {
      id: 'table-model-2',
      provider: 'openai',
      providerModelId: 'gpt-table-2',
      displayName: 'Table Model Two',
      capabilities,
      tasks: ['tabular'],
      connectionId: 'user-1',
      connectionName: 'Personal OpenAI',
      connectionSource: 'user',
    },
  ],
  preferences: { tabular: { connectionId: 'user-1', modelId: 'table-model' } },
}

async function renderPage() {
  const user = userEvent.setup()
  render(
    <main>
      <SettingsPage />
    </main>,
  )
  await screen.findByRole('heading', { name: 'Provider connections' })
  return user
}

describe('AI settings', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    api.loadAiSettings.mockResolvedValue(snapshot)
    api.createConnection.mockResolvedValue(undefined)
    api.updateConnection.mockResolvedValue(undefined)
    api.deleteConnection.mockResolvedValue(undefined)
    api.testConnection.mockResolvedValue(undefined)
    api.savePreference.mockResolvedValue(snapshot.preferences)
  })

  it('has no automated accessibility violations', async () => {
    await renderPage()
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('keeps sections, server controls, and the connection form in user-facing order', async () => {
    const user = await renderPage()
    const serverCard = screen.getByText('Company Claude').closest('article')
    const disabledCard = screen.getByText('Disabled gateway').closest('article')
    expect(serverCard).not.toBeNull()
    expect(disabledCard).not.toBeNull()
    if (!serverCard || !disabledCard) return

    expect(within(serverCard).getByText('Read-only')).toBeInTheDocument()
    expect(within(serverCard).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(within(disabledCard).getByRole('button', { name: 'Test' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Add connection' }))
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([
      'Provider connections',
      'Add provider connection',
      'Available models',
      'Model preferences',
    ])
  })

  it('keeps the form open and refreshes settings after a successful save', async () => {
    const user = await renderPage()
    await user.click(screen.getByRole('button', { name: 'Add connection' }))
    await user.type(screen.getByLabelText('Display name'), 'My Claude')
    await user.type(screen.getByLabelText('API key'), 'success-secret')
    await user.click(screen.getByRole('button', { name: 'Save connection' }))

    expect(await screen.findByText('Connection saved.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Add provider connection' })).toBeInTheDocument()
    expect(screen.getByLabelText('API key')).toHaveValue('')
    expect(api.loadAiSettings).toHaveBeenCalledTimes(2)
  })

  it('submits secrets through the API, clears them after success and error, and never renders payload secrets', async () => {
    const user = await renderPage()
    expect(screen.queryByText('server-secret-never-render')).not.toBeInTheDocument()
    expect(screen.queryByText('personal-secret-never-render')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add connection' }))
    const keyInput = screen.getByLabelText('API key')
    expect(keyInput).toHaveAttribute('type', 'password')
    expect(keyInput).toHaveAttribute('autocomplete', 'new-password')
    await user.type(screen.getByLabelText('Display name'), 'My Claude')
    await user.type(keyInput, 'success-secret')
    await user.click(screen.getByRole('button', { name: 'Save connection' }))

    await waitFor(() =>
      expect(api.createConnection).toHaveBeenCalledWith(
        expect.objectContaining({ credential: 'success-secret' }),
      ),
    )
    expect(keyInput).toHaveValue('')

    api.createConnection.mockRejectedValueOnce(new Error('raw provider failure'))
    await user.type(keyInput, 'failed-secret')
    await user.click(screen.getByRole('button', { name: 'Save connection' }))
    await screen.findByRole('alert')
    expect(keyInput).toHaveValue('')
    expect(screen.queryByText(/raw provider failure/i)).not.toBeInTheDocument()
  })

  it('validates custom endpoints and submits custom model definitions', async () => {
    const user = await renderPage()
    await user.click(screen.getByRole('button', { name: 'Add connection' }))
    await user.selectOptions(screen.getByLabelText('Provider'), 'openai-compatible')
    await user.type(screen.getByLabelText('Display name'), 'Local gateway')
    await user.type(screen.getByLabelText('API key'), 'custom-secret')
    await user.type(screen.getByLabelText('Endpoint URL'), 'http://example.com/v1')
    await user.type(screen.getByLabelText('Model ID'), 'custom-model')
    await user.type(screen.getByLabelText('Model display name'), 'Custom Model')
    await user.click(screen.getByRole('button', { name: 'Save connection' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Use HTTPS')
    expect(api.createConnection).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Endpoint URL'))
    await user.type(screen.getByLabelText('Endpoint URL'), 'http://localhost:11434/v1')
    await user.type(screen.getByLabelText('API key'), 'custom-secret')
    await user.click(screen.getByLabelText('Image input'))
    await user.click(screen.getByLabelText('Title generation', { selector: 'input' }))
    await user.click(screen.getByRole('button', { name: 'Save connection' }))

    await waitFor(() =>
      expect(api.createConnection).toHaveBeenCalledWith({
        provider: 'openai-compatible',
        name: 'Local gateway',
        credential: 'custom-secret',
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        models: [
          expect.objectContaining({
            providerModelId: 'custom-model',
            displayName: 'Custom Model',
            capabilities: expect.objectContaining({
              input: { text: true, image: true, pdf: false },
            }),
            tasks: ['main', 'title'],
          }),
        ],
      }),
    )
  })

  it('rejects loopback HTTP outside development', async () => {
    vi.stubEnv('DEV', false)
    const user = await renderPage()
    await user.click(screen.getByRole('button', { name: 'Add connection' }))
    await user.selectOptions(screen.getByLabelText('Provider'), 'openai-compatible')
    await user.type(screen.getByLabelText('Display name'), 'Local gateway')
    await user.type(screen.getByLabelText('API key'), 'custom-secret')
    await user.type(screen.getByLabelText('Endpoint URL'), 'http://localhost:11434/v1')
    await user.type(screen.getByLabelText('Model ID'), 'custom-model')
    await user.type(screen.getByLabelText('Model display name'), 'Custom Model')
    await user.click(screen.getByRole('button', { name: 'Save connection' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Loopback HTTP is allowed only in development',
    )
    expect(api.createConnection).not.toHaveBeenCalled()
  })

  it('filters preference models by enabled connection and task compatibility', async () => {
    await renderPage()
    const chat = screen.getByLabelText('Chat model')
    expect(within(chat).getByRole('option', { name: /Chat Model/ })).toBeInTheDocument()
    expect(within(chat).queryByRole('option', { name: /Table Model/ })).not.toBeInTheDocument()

    const title = screen.getByLabelText('Title generation model')
    expect(within(title).queryByRole('option', { name: /Disabled Title/ })).not.toBeInTheDocument()
    expect(title).toBeDisabled()
  })

  it('loads models for a disabled connection and re-enables it without resubmitting credentials', async () => {
    const user = await renderPage()
    const connectionCard = screen.getByText('Disabled gateway').closest('article')
    expect(connectionCard).not.toBeNull()
    if (!connectionCard) return

    await user.click(within(connectionCard).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Model ID')).toHaveValue('renamable-model')
    expect(screen.getByLabelText('Model display name')).toHaveValue('Disabled Title')
    expect(screen.getByLabelText(/API key/)).toHaveValue('')

    await user.click(screen.getByLabelText('Enabled'))
    await user.clear(screen.getByLabelText('Model ID'))
    await user.type(screen.getByLabelText('Model ID'), 'renamed-model')
    await user.click(screen.getByRole('button', { name: 'Save connection' }))

    await waitFor(() =>
      expect(api.updateConnection).toHaveBeenCalledWith('disabled-1', {
        provider: 'openai-compatible',
        name: 'Disabled gateway',
        enabled: true,
        baseUrl: 'https://gateway.example.com/v1',
        models: [
          expect.objectContaining({
            id: 'disabled-title',
            providerModelId: 'renamed-model',
          }),
        ],
      }),
    )
  })

  it('keeps identical model IDs distinct across provider connections', async () => {
    api.loadAiSettings.mockResolvedValue({
      ...snapshot,
      connections: [
        ...snapshot.connections,
        {
          id: 'user-2',
          provider: 'openai',
          name: 'Second OpenAI',
          source: 'user',
          baseUrl: null,
          enabled: true,
          hasCredential: true,
          models: [],
        },
      ],
      models: [
        ...snapshot.models,
        {
          ...snapshot.models[0],
          connectionId: 'user-2',
          connectionName: 'Second OpenAI',
        },
      ],
    })
    const user = await renderPage()
    const chat = screen.getByLabelText('Chat model')
    await user.selectOptions(chat, targetValue('user-2', 'chat-model'))
    await waitFor(() =>
      expect(api.savePreference).toHaveBeenCalledWith('main', {
        connectionId: 'user-2',
        modelId: 'chat-model',
      }),
    )
  })

  it('persists tabular and compliance controls through the same tabular preference', async () => {
    api.savePreference.mockImplementation(async (task, target) => ({ [task]: target }))
    const user = await renderPage()
    const tabular = screen.getByLabelText('Tabular analysis model')
    const compliance = screen.getByLabelText('Compliance review model')
    expect(tabular).toHaveValue(targetValue('user-1', 'table-model'))
    expect(compliance).toHaveValue(targetValue('user-1', 'table-model'))
    expect(screen.getByText(/Uses the Tabular analysis preference/)).toBeInTheDocument()

    await user.selectOptions(compliance, targetValue('user-1', 'table-model-2'))
    await waitFor(() =>
      expect(api.savePreference).toHaveBeenCalledWith('tabular', {
        connectionId: 'user-1',
        modelId: 'table-model-2',
      }),
    )
    expect(tabular).toHaveValue(targetValue('user-1', 'table-model-2'))
    expect(compliance).toHaveValue(targetValue('user-1', 'table-model-2'))
  })

  it('requires inline confirmation before deleting a personal connection', async () => {
    const user = await renderPage()
    const personalCard = screen.getByText('Personal OpenAI').closest('article')
    expect(personalCard).not.toBeNull()
    if (!personalCard) return
    await user.click(within(personalCard).getByRole('button', { name: 'Delete' }))
    expect(api.deleteConnection).not.toHaveBeenCalled()
    await user.click(within(personalCard).getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(api.deleteConnection).toHaveBeenCalledWith('user-1'))
  })

  it('shows safe load, test, and save errors without raw provider payloads', async () => {
    api.loadAiSettings.mockRejectedValueOnce(new Error('raw load payload'))
    const user = userEvent.setup()
    const { unmount } = render(
      <main>
        <SettingsPage />
      </main>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded')
    expect(screen.queryByText(/raw load payload/i)).not.toBeInTheDocument()
    unmount()

    api.loadAiSettings.mockResolvedValue(snapshot)
    api.testConnection.mockRejectedValueOnce(new Error('raw test payload'))
    await renderPage()
    const personalCard = screen.getByText('Personal OpenAI').closest('article')
    if (!personalCard) return
    await user.click(within(personalCard).getByRole('button', { name: 'Test' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('test failed')
    expect(screen.queryByText(/raw test payload/i)).not.toBeInTheDocument()

    api.createConnection.mockRejectedValueOnce(new Error('raw save payload'))
    await user.click(screen.getByRole('button', { name: 'Add connection' }))
    await user.type(screen.getByLabelText('Display name'), 'Provider')
    await user.type(screen.getByLabelText('API key'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Save connection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved')
    expect(screen.queryByText(/raw save payload/i)).not.toBeInTheDocument()
  })
})
