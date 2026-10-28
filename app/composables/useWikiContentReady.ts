import { watch, type Ref } from 'vue'

// Markdown renderers can finish after the page's mounted hook or replace their
// hydrated DOM. Follow the actual content element rather than a fixed delay.
export const useWikiContentReady = (
  root: Ref<HTMLElement | null>,
  enhance: () => void
) => {
  watch(root, (element, _previous, onCleanup) => {
    if (!element) return

    let frame: number | null = null
    let disposed = false
    const observe = () => observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['id']
    })
    const schedule = () => {
      if (disposed || frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        // Number labels, copy buttons and table wrappers are our own changes.
        // Do not let them trigger another enhancement cycle.
        observer.disconnect()
        try {
          enhance()
        } finally {
          if (!disposed) observe()
        }
      })
    }
    const observer = new MutationObserver((records) => {
      const decoration = '.heading-number, .code-toolbar'
      const hasContentChange = records.some((record) => {
        const target = record.target instanceof Element
          ? record.target : record.target.parentElement
        if (target?.closest(decoration)) return false
        if (record.type !== 'childList') return true
        return [...record.addedNodes, ...record.removedNodes].some(node =>
          !(node instanceof Element && node.matches(decoration))
        )
      })
      if (hasContentChange) schedule()
    })

    observe()
    schedule()
    onCleanup(() => {
      disposed = true
      observer.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
    })
  }, { flush: 'post' })
}
