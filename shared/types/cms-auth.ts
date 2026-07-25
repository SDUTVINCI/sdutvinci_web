export const cmsRoleCodes = ['admin', 'member'] as const

export type CmsRoleCode = typeof cmsRoleCodes[number]

export interface CmsUser {
  id: string
  email: string
  displayName: string
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
