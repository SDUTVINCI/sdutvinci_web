export const cmsRoleCodes = ['admin', 'member'] as const
export const cmsAccountPattern = /^[a-z][a-z0-9]{2,31}$/
export const cmsPasswordMinLength = 12

export type CmsRoleCode = typeof cmsRoleCodes[number]

export interface CmsSessionMember {
  id: string
  memberKey: string
  name: string
  avatarUrl: string | null
}

export interface CmsUser {
  id: string
  account: string
  status: 'active' | 'disabled'
  roles: CmsRoleCode[]
  memberId: string | null
  member: CmsSessionMember | null
}

export interface CmsSessionResponse {
  user: CmsUser
  csrfToken: string
}

export interface CmsManagedUser extends CmsUser {
  createdAt: string
  updatedAt: string
}
