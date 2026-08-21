import { getPublicOrganization } from '../services/organization'

export default defineEventHandler(() => getPublicOrganization())
