import { configureStore } from '@reduxjs/toolkit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseApi } from '../baseApi'
import * as driveActivity from './driveActivityApi'
import * as driveFile from './driveFileApi'
import * as driveFolder from './driveFolderApi'
import * as driveInvitations from './driveInvitationsApi'
import * as driveWorkspace from './driveWorkspaceApi'

function captureRequests(): Request[] {
  const requests: Request[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request.clone())
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  return requests
}

function createApiStore() {
  return configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
  })
}

describe('drive API request contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves representative request contracts across every resource', async () => {
    const requests = captureRequests()
    const store = createApiStore()

    await store.dispatch(
      driveWorkspace.driveWorkspaceApi.endpoints.updateDriveWorkspace.initiate({
        workspaceId: 'workspace-1',
        name: 'Apollo',
      }),
    )
    await store.dispatch(
      driveFolder.driveFolderApi.endpoints.moveDriveItems.initiate({
        file_ids: ['file-1'],
        folder_ids: ['folder-1'],
        target_workspace_id: 'workspace-2',
        target_folder_id: null,
      }),
    )
    await store.dispatch(
      driveFile.driveFileApi.endpoints.getDriveFileUrl.initiate({
        fileId: 'file-1',
        inline: true,
      }),
    )
    await store.dispatch(
      driveActivity.driveActivityApi.endpoints.getWorkspaceActivity.initiate('workspace-1'),
    )
    await store.dispatch(
      driveInvitations.driveInvitationsApi.endpoints.inviteWorkspaceMember.initiate({
        workspaceId: 'workspace-1',
        email: 'editor@example.com',
        role: 'editor',
      }),
    )

    expect(requests).toHaveLength(5)
    expect([requests[0].method, new URL(requests[0].url).pathname]).toEqual([
      'PATCH',
      '/drive/workspaces/workspace-1',
    ])
    expect(await requests[0].json()).toEqual({ name: 'Apollo' })

    expect([requests[1].method, new URL(requests[1].url).pathname]).toEqual([
      'POST',
      '/drive/items/move',
    ])
    expect(await requests[1].json()).toEqual({
      file_ids: ['file-1'],
      folder_ids: ['folder-1'],
      target_workspace_id: 'workspace-2',
      target_folder_id: null,
    })

    const fileUrl = new URL(requests[2].url)
    expect([requests[2].method, fileUrl.pathname]).toEqual(['GET', '/drive/files/file-1/url'])
    expect(Object.fromEntries(fileUrl.searchParams)).toEqual({ inline: 'true' })

    expect([requests[3].method, new URL(requests[3].url).pathname]).toEqual([
      'GET',
      '/drive/workspaces/workspace-1/activity',
    ])

    expect([requests[4].method, new URL(requests[4].url).pathname]).toEqual([
      'POST',
      '/drive/workspaces/workspace-1/invitations',
    ])
    expect(await requests[4].json()).toEqual({
      email: 'editor@example.com',
      role: 'editor',
    })

    store.dispatch(baseApi.util.resetApiState())
  })
})
