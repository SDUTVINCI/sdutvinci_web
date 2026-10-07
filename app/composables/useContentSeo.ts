import { computed, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import {
  SITE_NAME, SITE_SHARE_IMAGE, buildSeoGraph, canonicalSiteUrl,
  resolveSiteOrigin, seoDescription, serializeSeoJson,
  type SeoBreadcrumb
} from '~~/shared/utils/site-seo'

interface ContentSeoInput {
  title: MaybeRefOrGetter<string>
  description: MaybeRefOrGetter<string>
  path: MaybeRefOrGetter<string>
  image?: MaybeRefOrGetter<string | undefined>
  type?: 'website' | 'article' | 'profile'
  noindex?: MaybeRefOrGetter<boolean>
  breadcrumbs?: MaybeRefOrGetter<SeoBreadcrumb[]>
  articleKind?: 'NewsArticle' | 'TechArticle'
  headline?: MaybeRefOrGetter<string>
  publishedAt?: MaybeRefOrGetter<string | undefined>
  modifiedAt?: MaybeRefOrGetter<string | undefined>
  author?: MaybeRefOrGetter<string | undefined>
}

export const useContentSeo = (input: ContentSeoInput) => {
  const runtimeConfig = useRuntimeConfig()
  const requestUrl = useRequestURL()
  const origin = computed(() => resolveSiteOrigin(runtimeConfig.public.siteUrl, requestUrl.origin))
  const canonical = computed(() => canonicalSiteUrl(origin.value, toValue(input.path)))
  const description = computed(() => seoDescription(toValue(input.description)))
  if (import.meta.server && toValue(input.noindex)) {
    useResponseHeader('X-Robots-Tag').value = 'noindex, follow'
  }
  const image = computed(() => {
    try {
      const url = new URL((input.image && toValue(input.image)) || SITE_SHARE_IMAGE, `${origin.value}/`)
      return ['https:', 'http:'].includes(url.protocol) ? url.toString() : SITE_SHARE_IMAGE
    } catch { return SITE_SHARE_IMAGE }
  })

  useSeoMeta({
    title: () => toValue(input.title),
    description: () => description.value,
    ogTitle: () => toValue(input.title),
    ogDescription: () => description.value,
    ogSiteName: SITE_NAME,
    ogLocale: 'zh_CN',
    ogType: input.type || 'website',
    ogUrl: () => canonical.value,
    ogImage: () => image.value,
    twitterCard: 'summary_large_image',
    twitterTitle: () => toValue(input.title),
    twitterDescription: () => description.value,
    twitterImage: () => image.value,
    robots: () => toValue(input.noindex) ? 'noindex, follow' : 'index, follow'
  })
  useHead(() => ({
    link: [
      { rel: 'canonical', href: canonical.value }
    ],
    script: toValue(input.noindex) ? [] : [{
      key: 'vinci-seo', type: 'application/ld+json',
      innerHTML: serializeSeoJson(buildSeoGraph({
        origin: origin.value, path: toValue(input.path), title: toValue(input.title),
        description: description.value, image: image.value,
        breadcrumbs: toValue(input.breadcrumbs), articleKind: input.articleKind,
        headline: toValue(input.headline), publishedAt: toValue(input.publishedAt),
        modifiedAt: toValue(input.modifiedAt), author: toValue(input.author)
      }))
    }]
  }))
  return { canonical }
}
