export default defineNuxtRouteMiddleware(async () => {
  const { loadSession } = useCmsSession()
  const session = await loadSession()

  if (!session) {
    return navigateTo('/cms/login')
  }

  if (!session.user.roles.includes('admin')) {
    return abortNavigation({
      statusCode: 403,
      statusMessage: '该页面仅管理员可访问'
    })
  }
})
