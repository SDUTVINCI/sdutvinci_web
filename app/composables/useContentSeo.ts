import { computed, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

interface ContentSeoInput {
  title: MaybeRefOrGetter<string>
  description: MaybeRefOrGetter<string>
  path: MaybeRefOrGetter<string>
  image?: MaybeRefOrGetter<string | undefined>
  type?: 'website' | 'article' | 'profile'
}

export const useContentSeo = (input: ContentSeoInput) => {
  const runtimeConfig = useRuntimeConfig()
  const requestUrl = useRequestURL()
  const canonical = computed(() => {
    const configured = String(runtimeConfig.public.siteUrl || '').trim()
    const base = configured || requestUrl.origin
    try {
      return new URL(toValue(input.path), `${base.replace(/\/+$/, '')}/`).toString()
    } catch {
      return `${requestUrl.origin}${toValue(input.path)}`
    }
  })

  useSeoMeta({
    title: () => toValue(input.title),
    description: () => toValue(input.description),
    ogTitle: () => toValue(input.title),
    ogDescription: () => toValue(input.description),
    ogType: input.type || 'website',
    ogUrl: () => canonical.value,
    ogImage: () => input.image ? toValue(input.image) : undefined
  })
  useHead(() => ({
    link: [
      { rel: 'canonical', href: canonical.value }
    ]
  }))
  return { canonical }
}
