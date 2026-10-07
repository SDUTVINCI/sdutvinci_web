import { setResponseHeader } from 'h3'
import { buildSiteRobots } from '../services/site-robots'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'public, max-age=300')
  return buildSiteRobots(useRuntimeConfig(event).public.siteUrl)
})
