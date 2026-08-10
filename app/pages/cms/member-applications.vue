<script setup lang="ts">
definePageMeta({ middleware: ['cms-auth', 'cms-admin'] })
await navigateTo('/cms/reviews', { replace: true })
</script>

<template><span /></template>
