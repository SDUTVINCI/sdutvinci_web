<script setup lang="ts">
const { confirmation, settle } = useSiteConfirm()
const route = useRoute()
const panel = ref<HTMLElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null
watch(confirmation, async value => {
  if (!import.meta.client) return
  if (value) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    cancelButton.value?.focus()
  } else { previousFocus?.focus(); previousFocus = null }
})
watch(() => route.fullPath, () => settle(false))
const trapFocus = (event: KeyboardEvent) => {
  if (event.key !== 'Tab') return
  const buttons = [...(panel.value?.querySelectorAll<HTMLButtonElement>('button') || [])]
  if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus() }
}
</script>
<template>
  <Teleport to="body">
    <Transition name="site-confirm">
      <div v-if="confirmation" class="site-confirm-overlay" @click.self="settle(false)">
        <section ref="panel" class="site-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="site-confirm-title" aria-describedby="site-confirm-description" @keydown.esc.prevent="settle(false)" @keydown="trapFocus">
          <button class="site-confirm-close" type="button" aria-label="关闭确认框" @click="settle(false)">×</button>
          <span class="site-confirm-icon" aria-hidden="true">?</span>
          <h2 id="site-confirm-title">{{ confirmation.title }}</h2><p id="site-confirm-description">{{ confirmation.message }}</p>
          <div class="site-confirm-actions"><button ref="cancelButton" type="button" @click="settle(false)">取消</button><button class="site-confirm-primary" type="button" @click="settle(true)">确认继续</button></div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
<style scoped>
.site-confirm-overlay { position: fixed; inset: 0; z-index: 11000; display: grid; place-items: center; padding: 24px; background: rgba(8, 20, 29, .45); backdrop-filter: blur(5px); }
.site-confirm-panel { position: relative; width: min(460px, 100%); padding: 32px; border: 1px solid var(--line); border-radius: 20px; background: var(--surface); box-shadow: 0 28px 90px rgba(0, 0, 0, .25); color: var(--ink); }
.site-confirm-icon { width: 46px; height: 46px; display: grid; place-items: center; background: color-mix(in srgb, var(--cyan) 12%, var(--surface)); color: var(--cyan); border-radius: 14px; font-size: 25px; font-weight: 800; }
h2 { margin: 20px 0 12px; font-size: 1.25rem; } p { color: var(--ink-soft); line-height: 1.8; margin: 0; }
.site-confirm-close { position: absolute; top: 16px; right: 18px; border: 0; background: transparent; color: var(--ink-soft); cursor: pointer; font-size: 26px; }
.site-confirm-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 28px; }.site-confirm-actions button { padding: 11px 20px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-soft); color: var(--ink); font: inherit; font-weight: 700; cursor: pointer; }.site-confirm-actions .site-confirm-primary { color: #fff; background: var(--cyan); border-color: var(--cyan); }.site-confirm-actions button:focus-visible { outline: 3px solid color-mix(in srgb, var(--cyan) 30%, transparent); outline-offset: 3px; }
.site-confirm-enter-active,.site-confirm-leave-active { transition: opacity .18s ease; }.site-confirm-enter-from,.site-confirm-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .site-confirm-enter-active,.site-confirm-leave-active { transition: none; } }
</style>
