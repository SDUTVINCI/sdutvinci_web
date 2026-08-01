export default defineNuxtRouteMiddleware(async () => {
  const { session, loadSession } = useCmsSession()
  if (!session.value) await loadSession()
  const roles = session.value?.user.roles || []
  if (!roles.includes('admin') && !roles.includes('content_importer')) {
    return navigateTo('/cms')
  }
})
