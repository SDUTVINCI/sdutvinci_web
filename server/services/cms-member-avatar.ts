import {
  deleteMemberAvatarObject,
  prepareMemberAvatar,
  uploadMemberAvatarObject
} from './member-avatar-storage'
import { CmsMemberVersionConflictError, getCmsMember, updateCmsMember } from './cms-members'

export const uploadCmsMemberAvatar = async (input: {
  memberId: string
  expectedVersion: number
  data: Buffer
  mimeType: string
  actorUserId: string
}) => {
  const current = await getCmsMember(input.memberId)
  if (!current) throw new Error('MEMBER_NOT_FOUND')
  if (current.version !== input.expectedVersion) throw new CmsMemberVersionConflictError()
  const { output, filename } = await prepareMemberAvatar({
    name: current.name,
    data: input.data,
    mimeType: input.mimeType
  })
  const key = `site-assets/images/member_photo/${filename}`
  const { url } = await uploadMemberAvatarObject({
    key,
    output,
    metadata: { 'member-id': current.id }
  })
  try {
    const member = await updateCmsMember(current.id, {
      name: current.name,
      avatarUrl: url,
      expectedVersion: input.expectedVersion
    }, input.actorUserId)
    return { member, url, filename }
  } catch (error) {
    await deleteMemberAvatarObject(key).catch(() => undefined)
    throw error
  }
}
