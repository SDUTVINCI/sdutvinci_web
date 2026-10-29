<script setup lang="ts">
const props = defineProps<{ open: boolean; labelledby: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let unlockScroll: (() => void) | undefined
let notified = false
function restoreScroll() {
  unlockScroll?.()
  unlockScroll = undefined
}
function lockScroll() {
  if (unlockScroll) return
  const { scrollX, scrollY } = window
  const body = document.body, root = document.documentElement
  const saved = ['position', 'top', 'left', 'width', 'overflow', 'padding-right'].map(name =>
    [name, body.style.getPropertyValue(name), body.style.getPropertyPriority(name)] as const)
  const rootOverflow = root.style.overflow
  const scrollbar = window.innerWidth - root.clientWidth
  if (scrollbar > 0) body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbar}px`
  Object.assign(body.style, { position: 'fixed', top: `${-scrollY}px`, left: `${-scrollX}px`, width: '100%', overflow: 'hidden' })
  root.style.overflow = 'hidden'
  let touchY = 0
  const canScroll = (target: EventTarget | null, delta: number, x: number, y: number) => {
    if (!(target instanceof Element) || !dialog.value?.contains(target)) return false
    // 原生 dialog 会把遮罩事件也定向到自身，需按坐标排除遮罩。
    const box = dialog.value.getBoundingClientRect()
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return false
    for (let node: Element | null = target; node; node = node.parentElement) {
      if (node instanceof HTMLElement && /auto|scroll/.test(getComputedStyle(node).overflowY)) {
        if (delta < 0 && node.scrollTop > 0 || delta > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true
      }
      if (node === dialog.value) break
    }
    return false
  }
  const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? 0 }
  const touchMove = (event: TouchEvent) => {
    // 保留双指缩放；单指在遮罩或滚动边界时不得传递给背景。
    if (event.touches.length !== 1) return
    const y = event.touches[0]!.clientY, delta = touchY - y
    touchY = y
    if (!canScroll(event.target, delta, event.touches[0]!.clientX, y) && event.cancelable) event.preventDefault()
  }
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !canScroll(event.target, event.deltaY, event.clientX, event.clientY) && event.cancelable) event.preventDefault()
  }
  document.addEventListener('touchstart', touchStart, { passive: true })
  document.addEventListener('touchmove', touchMove, { passive: false })
  document.addEventListener('wheel', wheel, { passive: false })
  unlockScroll = () => {
    document.removeEventListener('touchstart', touchStart)
    document.removeEventListener('touchmove', touchMove)
    document.removeEventListener('wheel', wheel)
    for (const [name, value, priority] of saved) {
      if (value) body.style.setProperty(name, value, priority)
      else body.style.removeProperty(name)
    }
    root.style.overflow = rootOverflow
    window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' })
  }
}
function closed() {
  restoreScroll()
  if (!notified) { notified = true; emit('close') }
}
function dismiss() { dialog.value?.close(); closed() }
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !dialog.value) return
  const controls = [...dialog.value.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0)
  const first = controls[0], last = controls.at(-1)
  if (!first) { event.preventDefault(); dialog.value.focus(); return }
  if (event.shiftKey && (document.activeElement === first || !dialog.value.contains(document.activeElement))) {
    event.preventDefault(); last?.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !dialog.value.contains(document.activeElement))) {
    event.preventDefault(); first.focus()
  }
}
function backdrop(event: MouseEvent) {
  if (event.target !== dialog.value || !dialog.value) return
  const box = dialog.value.getBoundingClientRect()
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dismiss()
}
watch(() => props.open, async open => {
  await nextTick()
  if (!dialog.value) return
  if (open && !dialog.value.open) {
    notified = false
    lockScroll()
    try { dialog.value.showModal() } catch (error) { restoreScroll(); throw error }
  } else if (!open && dialog.value.open) dismiss()
}, { immediate: true, flush: 'post' })
onBeforeUnmount(() => { notified = true; dialog.value?.close(); restoreScroll() })
</script>

<template>
  <dialog ref="dialog" class="dashboard-dialog" :aria-labelledby="labelledby" @close="closed" @cancel.prevent="dismiss" @click="backdrop" @keydown="trapFocus">
    <slot />
  </dialog>
</template>
