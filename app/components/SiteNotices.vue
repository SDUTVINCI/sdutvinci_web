<script setup lang="ts">
const { notices, dismiss } = useSiteNotice()
</script>
<template>
  <Teleport to="body">
    <TransitionGroup name="site-notice" tag="div" class="site-notices" aria-label="操作提示">
      <div v-for="notice in notices" :key="notice.id" class="site-notice" :class="`site-notice--${notice.kind}`" :role="notice.kind === 'error' ? 'alert' : 'status'" aria-atomic="true">
        <span class="site-notice-icon" aria-hidden="true">{{ notice.kind === 'success' ? '✓' : '!' }}</span>
        <div class="site-notice-content"><strong>{{ notice.title }}</strong><p>{{ notice.message }}</p></div>
        <button type="button" aria-label="关闭提示" @click="dismiss(notice.id)">×</button>
      </div>
    </TransitionGroup>
  </Teleport>
</template>
<style scoped>
.site-notices { position: fixed; top: 94px; right: 24px; z-index: 10000; width: min(420px, calc(100vw - 32px)); display: grid; gap: 12px; pointer-events: none; }
.site-notice { --notice-color: #16866d; display: grid; grid-template-columns: 34px minmax(0, 1fr) 24px; gap: 12px; align-items: start; padding: 18px; border: 1px solid color-mix(in srgb, var(--notice-color) 30%, var(--line)); border-left: 4px solid var(--notice-color); border-radius: 14px; background: var(--surface); box-shadow: 0 14px 48px rgba(12, 32, 42, .18); pointer-events: auto; }
.site-notice--error { --notice-color: #c14d45; }
.site-notice-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: color-mix(in srgb, var(--notice-color) 12%, var(--surface)); color: var(--notice-color); font-size: 21px; font-weight: 800; }
.site-notice-content strong { color: var(--ink); font-size: .98rem; }.site-notice-content p { margin: 6px 0 0; color: var(--ink-soft); font-size: .9rem; line-height: 1.6; overflow-wrap: anywhere; }
.site-notice button { border: 0; background: transparent; color: var(--ink-soft); font-size: 24px; line-height: 1; cursor: pointer; padding: 0; }.site-notice button:focus-visible { outline: 2px solid var(--cyan); outline-offset: 3px; }
.site-notice-enter-active,.site-notice-leave-active { transition: opacity .2s ease, transform .2s ease; }.site-notice-enter-from,.site-notice-leave-to { opacity: 0; transform: translateY(-12px); }
@media(max-width: 640px) { .site-notices { top: 78px; right: 16px; }.site-notice { padding: 14px; } }
@media(prefers-reduced-motion: reduce) { .site-notice-enter-active,.site-notice-leave-active { transition: none; } }
</style>
