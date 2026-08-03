export const getScrollProgress = (
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number
) => {
  const maximum = Math.max(0, scrollHeight - clientHeight)
  if (maximum === 0) return 0
  return Math.min(1, Math.max(0, scrollTop / maximum))
}

export const getScrollTopForProgress = (
  progress: number,
  scrollHeight: number,
  clientHeight: number
) => Math.max(0, scrollHeight - clientHeight)
  * Math.min(1, Math.max(0, progress))

export const createProgrammaticScrollGuard = (timeoutMs = 150) => {
  let target: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const clear = () => {
    target = null
    clearTimeout(timer)
    timer = undefined
  }

  return {
    mark(nextTarget: number) {
      target = nextTarget
      clearTimeout(timer)
      timer = setTimeout(clear, timeoutMs)
    },
    consume(actualScrollTop: number, tolerance = 1) {
      if (target === null) return false
      const matches = Math.abs(actualScrollTop - target) <= tolerance
      clear()
      return matches
    },
    clear
  }
}
