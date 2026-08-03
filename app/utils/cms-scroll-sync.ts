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
