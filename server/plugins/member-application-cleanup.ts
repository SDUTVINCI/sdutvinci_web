import { cleanupUnusedMemberProfileUploads } from '../services/member-self-profile'
import { cleanupExpiredMemberApplications } from '../services/member-applications'

export default defineNitroPlugin((nitroApp) => {
  const cleanup = () => Promise.allSettled([cleanupExpiredMemberApplications(), cleanupUnusedMemberProfileUploads()])
  const timer = setInterval(cleanup, 60 * 60_000)
  timer.unref()
  void cleanup()
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
