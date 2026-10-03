import { baseApi } from '../baseApi'

export interface DriveFile {
  id: string
  user_id: string
  workspace_id: string | null
  folder_id: string | null
  name: string
  description: string | null
  storage_path: string
  size_bytes: number
  mime_type: string
  extension: string | null
  checksum: string | null
  version: number
  is_primary: boolean
  created_at: string
  updated_at: string
  last_accessed_at: string | null
}

export interface DriveFilesListResponse {
  files: DriveFile[]
  total: number
  limit: number
  offset: number
  has_more: boolean
}

export interface ListFilesRequest {
  workspace_id?: string | null
  folder_id?: string | null
  search?: string
  limit?: number
  offset?: number
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}

export interface CopyFilesRequest {
  file_ids: string[]
  target_workspace_id?: string | null
  target_folder_id?: string | null
}

export interface CopyFilesResponse {
  copied_files: DriveFile[]
  copied_count: number
  total_requested: number
}

export interface UpdateDriveFileRequest {
  fileId: string
  name?: string
  description?: string | null
  folder_id?: string | null
}

export interface DriveFileUrlResponse {
  url: string
  file_id: string
  filename: string
  expires_in: number
}

export interface DrivePreviewSummaryResponse {
  id: string
  source_type: 'document' | 'drive'
  filename: string
  summary: string[]
  status: 'ready' | 'empty' | 'error'
  detail?: string
}

export const driveFileApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getDriveFiles: builder.query<DriveFilesListResponse, ListFilesRequest | void>({
      query: (params) => ({
        url: '/drive/files',
        params: params ?? undefined,
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.files.map(({ id }) => ({ type: 'DriveFiles' as const, id })),
              { type: 'DriveFiles', id: 'LIST' },
            ]
          : [{ type: 'DriveFiles', id: 'LIST' }],
    }),
    uploadDriveFile: builder.mutation<DriveFile, FormData>({
      query: (formData) => ({
        url: '/drive/files',
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: [
        { type: 'DriveFiles', id: 'LIST' },
        { type: 'DriveWorkspaces', id: 'LIST' },
      ],
    }),
    copyDriveFiles: builder.mutation<CopyFilesResponse, CopyFilesRequest>({
      query: (body) => ({
        url: '/drive/files/copy',
        method: 'POST',
        body,
      }),
      invalidatesTags: [
        { type: 'DriveFiles', id: 'LIST' },
        { type: 'DriveWorkspaces', id: 'LIST' },
      ],
    }),
    getDriveFile: builder.query<DriveFile, string>({
      query: (fileId) => `/drive/files/${fileId}`,
      providesTags: (_result, _error, fileId) => [{ type: 'DriveFiles', id: fileId }],
    }),
    updateDriveFile: builder.mutation<DriveFile, UpdateDriveFileRequest>({
      query: ({ fileId, ...body }) => ({
        url: `/drive/files/${fileId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { fileId }) => [
        { type: 'DriveFiles', id: fileId },
        { type: 'DriveFiles', id: 'LIST' },
      ],
    }),
    deleteDriveFile: builder.mutation<void, string>({
      query: (fileId) => ({
        url: `/drive/files/${fileId}`,
        method: 'DELETE',
      }),
      invalidatesTags: [
        { type: 'DriveFiles', id: 'LIST' },
        { type: 'DriveWorkspaces', id: 'LIST' },
      ],
    }),
    getDriveFileUrl: builder.query<
      DriveFileUrlResponse,
      string | { fileId: string; inline?: boolean }
    >({
      query: (arg) => {
        const fileId = typeof arg === 'string' ? arg : arg.fileId
        const inline = typeof arg === 'string' ? false : arg.inline
        return {
          url: `/drive/files/${fileId}/url`,
          params: inline ? { inline: 'true' } : undefined,
        }
      },
    }),
    getDriveFilePreviewSummary: builder.query<DrivePreviewSummaryResponse, string>({
      query: (fileId) => `/drive/files/${fileId}/preview-summary`,
      providesTags: (_result, _error, fileId) => [
        { type: 'DriveFiles', id: `${fileId}-preview-summary` },
      ],
    }),
  }),
})

export const {
  useGetDriveFilesQuery,
  useLazyGetDriveFilesQuery,
  useUploadDriveFileMutation,
  useCopyDriveFilesMutation,
  useGetDriveFileQuery,
  useLazyGetDriveFileQuery,
  useUpdateDriveFileMutation,
  useDeleteDriveFileMutation,
  useGetDriveFileUrlQuery,
  useLazyGetDriveFileUrlQuery,
  useGetDriveFilePreviewSummaryQuery,
  useLazyGetDriveFilePreviewSummaryQuery,
} = driveFileApi
