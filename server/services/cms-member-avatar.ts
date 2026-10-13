import { getCmsMember } from './cms-members'
import { uploadMemberProfileAvatar } from './member-self-profile'

export const uploadCmsMemberAvatar = async (input: {
  memberId: string, expectedVersion: number, data: Buffer, mimeType: string, actorUserId: string, name?: string
}) => {
  const member = await getCmsMember(input.memberId)
  if (!member || member.deletedAt) throw new Error('MEMBER_NOT_FOUND')
  return uploadMemberProfileAvatar(input.actorUserId, input.memberId, { ...input, name: input.name || member.name })
}
