import { setResponseHeader } from 'h3'
import { listAccountRegistrationMembers } from '../../services/account-registrations'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return { members: await listAccountRegistrationMembers() }
})
