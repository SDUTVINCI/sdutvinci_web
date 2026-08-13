export type AccountRegistrationStatus = 'pending' | 'approved' | 'rejected'
export type AccountRegistrationMemberStatus = 'available' | 'pending' | 'registered'

export interface AccountRegistrationMemberOption {
  id: string
  memberKey: string
  name: string
  avatarUrl: string | null
  account: string
  registrationStatus: AccountRegistrationMemberStatus
}

export interface CmsAccountRegistrationApplication {
  id: string
  account: string
  status: AccountRegistrationStatus
  member: {
    id: string
    memberKey: string
    name: string
    avatarUrl: string | null
  }
  submittedAt: string
  createdAt: string
  updatedAt: string
}
