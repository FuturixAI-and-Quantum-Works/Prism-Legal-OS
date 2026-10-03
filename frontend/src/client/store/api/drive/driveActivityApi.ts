import { baseApi } from '../baseApi'

export interface DriveActivity {
  id: string
  file_id?: string | null
  workspace_id?: string | null
  user_id: string | null
  user_email: string | null
  user_name: string | null
  action: string
  target_type?: string | null
  target_id?: string | null
  target_name?: string | null
  details: unknown
  created_at: string
}

export const driveActivityApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getWorkspaceActivity: builder.query<DriveActivity[], string>({
      query: (workspaceId) => `/drive/workspaces/${workspaceId}/activity`,
      providesTags: (_result, _error, workspaceId) => [
        { type: 'DriveActivity', id: `workspace:${workspaceId}` },
      ],
    }),
  }),
})

export const { useGetWorkspaceActivityQuery } = driveActivityApi
