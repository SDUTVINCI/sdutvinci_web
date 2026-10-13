import { getResponseStatus, setResponseHeader } from 'h3'

export default defineNitroPlugin((nitroApp) => {
  // Error handlers can send directly, bypassing the normal response hook.
  nitroApp.hooks.hook('error', (_error, { event }) => {
    if (event && !event.node.res.headersSent) {
      setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
    }
  })
  nitroApp.hooks.hook('beforeResponse', (event) => {
    if (getResponseStatus(event) >= 400) {
      setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
    }
  })
})
