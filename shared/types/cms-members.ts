export interface CmsMember {
  id: string
  memberKey: string
  name: string
  avatarUrl: string | null
  sourcePath: string
  role: string | null
  memberType: string | null
  groupName: string | null
  positions: string[]
  seasons: string[]
  advisorSeasons: string[]
  grade: string | null
  affiliation: string | null
  links: Record<string, string | null>
  body: string
  sortOrder: number
  version: number
  currentRevisionId: string | null
  metadata: Record<string, unknown>
  linkedUserId: string | null
  linkedAccount: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CmsMemberInput {
  memberKey?: string
  name: string
  avatarUrl?: string | null
  directory?: string
  sourcePath?: string
  role?: string | null
  memberType?: string | null
  groupName?: string | null
  positions?: string[]
  seasons?: string[]
  advisorSeasons?: string[]
  grade?: string | null
  affiliation?: string | null
  links?: Record<string, string | null>
  body?: string
  sortOrder?: number
  metadata?: Record<string, unknown>
}
