import { configureStore } from '@reduxjs/toolkit'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { baseApi } from '../../../store/api/baseApi'
import * as documentsPublic from '../documentsApi'
import publicIndexSource from '../documentsApi.ts?raw'
import * as documentContent from './documentContentApi'
import contentSource from './documentContentApi.ts?raw'
import * as documentCore from './documentCoreApi'
import coreSource from './documentCoreApi.ts?raw'
import * as documentGovernance from './documentGovernanceApi'
import governanceSource from './documentGovernanceApi.ts?raw'
import * as documentSharing from './documentSharingApi'
import sharingSource from './documentSharingApi.ts?raw'
import * as documentVersions from './documentVersionsApi'
import versionsSource from './documentVersionsApi.ts?raw'
import type * as PublicDocumentTypes from '../documentsApi'
import type * as ContentTypes from './documentContentApi'
import type * as CoreTypes from './documentCoreApi'
import type * as GovernanceTypes from './documentGovernanceApi'
import type * as SharingTypes from './documentSharingApi'
import type * as VersionTypes from './documentVersionsApi'

type StableDocumentTypes = [
  PublicDocumentTypes.DocumentListRequest,
  PublicDocumentTypes.DocumentVersion,
  PublicDocumentTypes.DocumentVersionsResponse,
  PublicDocumentTypes.TrackedChangeId,
  PublicDocumentTypes.TrackedChangeIdsResponse,
  PublicDocumentTypes.EditResolutionResponse,
  PublicDocumentTypes.UploadVersionRequest,
  PublicDocumentTypes.RenameVersionRequest,
  PublicDocumentTypes.DocumentEditAnnotation,
  PublicDocumentTypes.DocumentUrlResponse,
  PublicDocumentTypes.PreviewSummaryResponse,
  PublicDocumentTypes.DocumentPlaceholderField,
  PublicDocumentTypes.DocumentPlaceholdersResponse,
  PublicDocumentTypes.ApplyDocumentPlaceholdersResponse,
  PublicDocumentTypes.DocumentContextFile,
  PublicDocumentTypes.DocumentRisk,
  PublicDocumentTypes.DocumentInsights,
  PublicDocumentTypes.ProductShareRole,
  PublicDocumentTypes.ShareDelivery,
  PublicDocumentTypes.PendingShareInvitation,
  PublicDocumentTypes.DocumentShare,
  PublicDocumentTypes.DocumentSharesResponse,
  PublicDocumentTypes.DocumentRole,
  PublicDocumentTypes.DocumentAccessRole,
  PublicDocumentTypes.DocumentLifecycleStatus,
  PublicDocumentTypes.DocumentSessionContext,
  PublicDocumentTypes.DocumentCommentMetadata,
  PublicDocumentTypes.DocumentComment,
  PublicDocumentTypes.CreateDocumentCommentRequest,
  PublicDocumentTypes.UpdateDocumentCommentRequest,
  PublicDocumentTypes.DocumentActivity,
  PublicDocumentTypes.RejectionTarget,
  PublicDocumentTypes.DocumentMember,
  PublicDocumentTypes.DocumentChatMessage,
]

type FocusedDocumentTypes = [
  CoreTypes.DocumentListRequest,
  VersionTypes.DocumentVersion,
  VersionTypes.DocumentVersionsResponse,
  VersionTypes.TrackedChangeId,
  VersionTypes.TrackedChangeIdsResponse,
  VersionTypes.EditResolutionResponse,
  VersionTypes.UploadVersionRequest,
  VersionTypes.RenameVersionRequest,
  VersionTypes.DocumentEditAnnotation,
  ContentTypes.DocumentUrlResponse,
  ContentTypes.PreviewSummaryResponse,
  ContentTypes.DocumentPlaceholderField,
  ContentTypes.DocumentPlaceholdersResponse,
  ContentTypes.ApplyDocumentPlaceholdersResponse,
  ContentTypes.DocumentContextFile,
  ContentTypes.DocumentRisk,
  ContentTypes.DocumentInsights,
  SharingTypes.ProductShareRole,
  SharingTypes.ShareDelivery,
  SharingTypes.PendingShareInvitation,
  SharingTypes.DocumentShare,
  SharingTypes.DocumentSharesResponse,
  GovernanceTypes.DocumentRole,
  GovernanceTypes.DocumentAccessRole,
  GovernanceTypes.DocumentLifecycleStatus,
  GovernanceTypes.DocumentSessionContext,
  GovernanceTypes.DocumentCommentMetadata,
  GovernanceTypes.DocumentComment,
  GovernanceTypes.CreateDocumentCommentRequest,
  GovernanceTypes.UpdateDocumentCommentRequest,
  GovernanceTypes.DocumentActivity,
  GovernanceTypes.RejectionTarget,
  GovernanceTypes.DocumentMember,
  GovernanceTypes.DocumentChatMessage,
]

const focusedHooks = {
  useGetDocumentsQuery: documentCore.useGetDocumentsQuery,
  useLazyGetDocumentsQuery: documentCore.useLazyGetDocumentsQuery,
  useGetDocumentQuery: documentCore.useGetDocumentQuery,
  useLazyGetDocumentQuery: documentCore.useLazyGetDocumentQuery,
  useCreateDocumentMutation: documentCore.useCreateDocumentMutation,
  useUpdateDocumentMutation: documentCore.useUpdateDocumentMutation,
  useDeleteDocumentMutation: documentCore.useDeleteDocumentMutation,
  useUploadDocumentMutation: documentCore.useUploadDocumentMutation,
  useDownloadDocumentsZipMutation: documentCore.useDownloadDocumentsZipMutation,
  useGetDocumentHtmlQuery: documentContent.useGetDocumentHtmlQuery,
  useLazyGetDocumentHtmlQuery: documentContent.useLazyGetDocumentHtmlQuery,
  useGetDocumentDisplayQuery: documentContent.useGetDocumentDisplayQuery,
  useLazyGetDocumentDisplayQuery: documentContent.useLazyGetDocumentDisplayQuery,
  useGetDocumentUrlQuery: documentContent.useGetDocumentUrlQuery,
  useLazyGetDocumentUrlQuery: documentContent.useLazyGetDocumentUrlQuery,
  useGetDocumentPreviewSummaryQuery: documentContent.useGetDocumentPreviewSummaryQuery,
  useLazyGetDocumentPreviewSummaryQuery: documentContent.useLazyGetDocumentPreviewSummaryQuery,
  useGetDocumentDocxQuery: documentContent.useGetDocumentDocxQuery,
  useLazyGetDocumentDocxQuery: documentContent.useLazyGetDocumentDocxQuery,
  useGetDocumentPlaceholdersQuery: documentContent.useGetDocumentPlaceholdersQuery,
  useLazyGetDocumentPlaceholdersQuery: documentContent.useLazyGetDocumentPlaceholdersQuery,
  useSaveDocumentPlaceholderValuesMutation:
    documentContent.useSaveDocumentPlaceholderValuesMutation,
  useApplyDocumentPlaceholdersMutation: documentContent.useApplyDocumentPlaceholdersMutation,
  useGetDocumentContextFilesQuery: documentContent.useGetDocumentContextFilesQuery,
  useAddDocumentContextFileMutation: documentContent.useAddDocumentContextFileMutation,
  useRemoveDocumentContextFileMutation: documentContent.useRemoveDocumentContextFileMutation,
  useGetDocumentInsightsQuery: documentContent.useGetDocumentInsightsQuery,
  useLazyGetDocumentInsightsQuery: documentContent.useLazyGetDocumentInsightsQuery,
  useGetDocumentVersionsQuery: documentVersions.useGetDocumentVersionsQuery,
  useGetDocumentEditsQuery: documentVersions.useGetDocumentEditsQuery,
  useUploadDocumentVersionMutation: documentVersions.useUploadDocumentVersionMutation,
  useSaveDocumentVersionFromHtmlMutation: documentVersions.useSaveDocumentVersionFromHtmlMutation,
  useRenameDocumentVersionMutation: documentVersions.useRenameDocumentVersionMutation,
  useGetTrackedChangeIdsQuery: documentVersions.useGetTrackedChangeIdsQuery,
  useLazyGetTrackedChangeIdsQuery: documentVersions.useLazyGetTrackedChangeIdsQuery,
  useAcceptDocumentEditMutation: documentVersions.useAcceptDocumentEditMutation,
  useRejectDocumentEditMutation: documentVersions.useRejectDocumentEditMutation,
  useGetDocumentSharesQuery: documentSharing.useGetDocumentSharesQuery,
  useCreateDocumentInvitationMutation: documentSharing.useCreateDocumentInvitationMutation,
  useUpdateDocumentShareMutation: documentSharing.useUpdateDocumentShareMutation,
  useRemoveDocumentShareMutation: documentSharing.useRemoveDocumentShareMutation,
  useGetDocumentSessionContextQuery: documentGovernance.useGetDocumentSessionContextQuery,
  useGetDocumentMembersQuery: documentGovernance.useGetDocumentMembersQuery,
  useGetDocumentChatMessagesQuery: documentGovernance.useGetDocumentChatMessagesQuery,
  useAssignDocumentMemberMutation: documentGovernance.useAssignDocumentMemberMutation,
  useTransitionDocumentLifecycleMutation: documentGovernance.useTransitionDocumentLifecycleMutation,
  useGetDocumentCommentsQuery: documentGovernance.useGetDocumentCommentsQuery,
  useCreateDocumentCommentMutation: documentGovernance.useCreateDocumentCommentMutation,
  useUpdateDocumentCommentMutation: documentGovernance.useUpdateDocumentCommentMutation,
  useDeleteDocumentCommentMutation: documentGovernance.useDeleteDocumentCommentMutation,
  useGetDocumentActivityQuery: documentGovernance.useGetDocumentActivityQuery,
}

const resourceSources = {
  core: coreSource,
  content: contentSource,
  versions: versionsSource,
  sharing: sharingSource,
  governance: governanceSource,
}

function endpointNames(source: string): string[] {
  return [...source.matchAll(/^\s{4}(\w+): builder\.(?:query|mutation)</gm)].map(([, name]) => name)
}

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

describe('document API module contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps one API instance and every focused hook export', () => {
    expect(documentCore.documentCoreApi).toBe(baseApi)
    expect(documentContent.documentContentApi).toBe(baseApi)
    expect(documentVersions.documentVersionsApi).toBe(baseApi)
    expect(documentSharing.documentSharingApi).toBe(baseApi)
    expect(documentGovernance.documentGovernanceApi).toBe(baseApi)
    expect(documentsPublic).toMatchObject(focusedHooks)
    expectTypeOf(documentsPublic).toMatchTypeOf(focusedHooks)
    expectTypeOf<StableDocumentTypes>().toEqualTypeOf<FocusedDocumentTypes>()
  })

  it('owns each endpoint in exactly one resource module', () => {
    expect(endpointNames(coreSource)).toEqual([
      'getDocuments',
      'getDocument',
      'createDocument',
      'updateDocument',
      'deleteDocument',
      'uploadDocument',
      'downloadDocumentsZip',
    ])
    expect(endpointNames(contentSource)).toEqual([
      'getDocumentHtml',
      'getDocumentDisplay',
      'getDocumentUrl',
      'getDocumentPreviewSummary',
      'getDocumentDocx',
      'getDocumentPlaceholders',
      'saveDocumentPlaceholderValues',
      'applyDocumentPlaceholders',
      'getDocumentContextFiles',
      'addDocumentContextFile',
      'removeDocumentContextFile',
      'getDocumentInsights',
    ])
    expect(endpointNames(versionsSource)).toEqual([
      'getDocumentVersions',
      'getDocumentEdits',
      'uploadDocumentVersion',
      'saveDocumentVersionFromHtml',
      'renameDocumentVersion',
      'getTrackedChangeIds',
      'acceptDocumentEdit',
      'rejectDocumentEdit',
    ])
    expect(endpointNames(sharingSource)).toEqual([
      'getDocumentShares',
      'createDocumentInvitation',
      'updateDocumentShare',
      'removeDocumentShare',
    ])
    expect(endpointNames(governanceSource)).toEqual([
      'getDocumentSessionContext',
      'getDocumentMembers',
      'getDocumentChatMessages',
      'assignDocumentMember',
      'transitionDocumentLifecycle',
      'getDocumentComments',
      'createDocumentComment',
      'updateDocumentComment',
      'deleteDocumentComment',
      'getDocumentActivity',
    ])
  })

  it('keeps resource implementations below 700 lines without exemptions', () => {
    for (const [resource, source] of Object.entries(resourceSources)) {
      expect(source.split(/\r?\n/).length, resource).toBeLessThan(700)
    }
    expect(publicIndexSource.split(/\r?\n/).length, 'public index').toBeLessThan(100)
  })

  it('preserves representative request contracts across every resource', async () => {
    const requests = captureRequests()
    const store = createApiStore()

    await store.dispatch(
      documentCore.documentCoreApi.endpoints.updateDocument.initiate({
        id: 'document-1',
        name: 'Agreement',
      }),
    )
    await store.dispatch(
      documentContent.documentContentApi.endpoints.getDocumentUrl.initiate({
        documentId: 'document-1',
        version_id: 'version-2',
        inline: true,
      }),
    )
    await store.dispatch(
      documentVersions.documentVersionsApi.endpoints.saveDocumentVersionFromHtml.initiate({
        documentId: 'document-1',
        html: '<p>Agreement</p>',
        displayName: 'Reviewed',
      }),
    )
    await store.dispatch(
      documentSharing.documentSharingApi.endpoints.createDocumentInvitation.initiate({
        documentId: 'document-1',
        email: 'reviewer@example.com',
        role: 'viewer',
      }),
    )
    await store.dispatch(
      documentGovernance.documentGovernanceApi.endpoints.transitionDocumentLifecycle.initiate({
        documentId: 'document-1',
        action: 'reject',
        note: 'Revise',
        rejection_target: { section_ref: '2.1' },
      }),
    )

    expect(requests).toHaveLength(5)
    expect([requests[0].method, new URL(requests[0].url).pathname]).toEqual([
      'PATCH',
      '/documents/document-1',
    ])
    expect(await requests[0].json()).toEqual({ name: 'Agreement' })

    const contentUrl = new URL(requests[1].url)
    expect([requests[1].method, contentUrl.pathname]).toEqual(['GET', '/documents/document-1/url'])
    expect(Object.fromEntries(contentUrl.searchParams)).toEqual({
      inline: 'true',
      version_id: 'version-2',
    })

    expect([requests[2].method, new URL(requests[2].url).pathname]).toEqual([
      'POST',
      '/documents/document-1/versions/from-html',
    ])
    expect(await requests[2].json()).toEqual({
      html: '<p>Agreement</p>',
      display_name: 'Reviewed',
    })

    expect([requests[3].method, new URL(requests[3].url).pathname]).toEqual([
      'POST',
      '/documents/document-1/invitations',
    ])
    expect(await requests[3].json()).toEqual({
      email: 'reviewer@example.com',
      role: 'viewer',
    })

    expect([requests[4].method, new URL(requests[4].url).pathname]).toEqual([
      'POST',
      '/documents/document-1/reject',
    ])
    expect(await requests[4].json()).toEqual({
      note: 'Revise',
      rejection_target: { section_ref: '2.1' },
    })

    store.dispatch(baseApi.util.resetApiState())
  })
})
