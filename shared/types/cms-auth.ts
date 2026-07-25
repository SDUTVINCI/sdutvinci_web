export const cmsRoleCodes = ['admin', 'member'] as const
export const cmsAccountPattern = /^[a-z][a-z0-9]{2,31}$/

export type CmsRoleCode = typeof cmsRoleCodes[number]

export interface CmsUser {
  id: string
  account: string
  status: 'active' | 'disabled'
  roles: CmsRoleCode[]
  memberId: string | null
}

export interface CmsSessionResponse {
  user: CmsUser
  csrfToken: string
}

export interface CmsManagedUser extends CmsUser {
  createdAt: string
  updatedAt: string
}
