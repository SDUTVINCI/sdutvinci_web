import { listMemberOptions } from '../services/member-options'

export default defineEventHandler(async () => listMemberOptions(false))
