export default defineNuxtRouteMiddleware(async (to) => {
  const { loadSession } = useCmsSession()
  const session = await loadSession()

  if (!session) {
    return navigateTo({
      path: '/cms/login',
      query: { redirect: to.fullPath }
    })
  }
})
