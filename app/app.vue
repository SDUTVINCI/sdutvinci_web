<script setup lang="ts">
import { resolveBaiduSiteVerification, resolveSiteOrigin } from '~~/shared/utils/site-seo'

const config = useRuntimeConfig()
const requestUrl = useRequestURL()
useHead(() => ({
  meta: [{
    name: 'baidu-site-verification',
    content: resolveBaiduSiteVerification(
      config.public.baiduSiteVerification,
      resolveSiteOrigin(config.public.siteUrl, requestUrl.origin)
    )
  }].filter(tag => tag.content)
}))
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
