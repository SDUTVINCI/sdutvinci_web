export default defineNuxtRouteMiddleware(async to => {
  const { loadSession } = useCmsSession()
  if (!await loadSession()) return navigateTo({ path: '/cms/login', query: { redirect: to.fullPath } })
})
