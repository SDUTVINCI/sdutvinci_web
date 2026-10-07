<script setup lang="ts">
const config = useRuntimeConfig()
useHead(() => ({
  meta: config.public.baiduSiteVerification
    ? [{ name: 'baidu-site-verification', content: String(config.public.baiduSiteVerification).trim() }]
    : []
}))
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
