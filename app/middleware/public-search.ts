export default defineNuxtRouteMiddleware(async () => {
  // Resolve identity before rendering the header and choosing the search cache key.
  await useCmsSession().loadSession()
})
