export interface PublicArticleCreditIdentity {
  memberKey: string
  name: string
  image: string | null
  path: string | null
}

export interface CmsArticleCreditIdentity {
  creditKey: string
  displayName: string
  memberId: string | null
  linkedMemberKey: string | null
  linkedMemberName: string | null
  usageCount: number
  version: number
  createdAt: string
  updatedAt: string
}

export interface CmsArticleCreditIdentityInput {
  creditKey?: string
  displayName: string
  memberId?: string | null
}
