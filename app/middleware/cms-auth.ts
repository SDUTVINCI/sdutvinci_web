export default defineNuxtRouteMiddleware(async () => {
  const { loadSession } = useCmsSession()
  const session = await loadSession()

  if (!session) {
    return navigateTo('/cms/login')
  }
})
