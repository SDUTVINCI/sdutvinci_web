export interface CmsMember {
  id: string
  memberKey: string
  name: string
  avatarUrl: string | null
  sourcePath: string
  metadata: Record<string, unknown>
  linkedAccount: string | null
  createdAt: string
  updatedAt: string
}

export interface CmsMemberInput {
  memberKey?: string
  name: string
  avatarUrl?: string | null
  directory?: string
  metadata?: Record<string, unknown>
}
