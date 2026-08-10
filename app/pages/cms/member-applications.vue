<script setup lang="ts">
definePageMeta({ layout: 'cms', middleware: ['cms-auth', 'cms-admin'] })
await navigateTo('/cms/reviews', { replace: true })
</script>

<template><span /></template>
