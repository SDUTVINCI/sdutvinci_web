import { cleanupExpiredMemberApplications } from '../services/member-applications'

export default defineNitroPlugin((nitroApp) => {
  const cleanup = () => cleanupExpiredMemberApplications().catch(() => undefined)
  const timer = setInterval(cleanup, 60 * 60_000)
  timer.unref()
  void cleanup()
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
