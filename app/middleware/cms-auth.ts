export default defineNuxtRouteMiddleware(async (to) => {
  const { loadSession } = useCmsSession()
  const session = await loadSession()

  if (session && !session.user.roles.some(role => role === 'admin' || role === 'member')) {
    return navigateTo('/account')
  }

  if (!session) {
    return navigateTo({
      path: '/cms/login',
      query: { redirect: to.fullPath }
    })
  }
})
