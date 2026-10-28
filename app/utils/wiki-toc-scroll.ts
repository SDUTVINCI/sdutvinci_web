export const getActiveWikiHeadingId = (
  headings: readonly HTMLElement[],
  scrollOffset: number
) => {
  let active = ''
  for (const heading of headings) {
    // Viewport coordinates also work when the renderer has a positioned parent.
    // Allow fractional pixels at the scroll-margin boundary.
    if (heading.getBoundingClientRect().top > scrollOffset + 1) break
    active = heading.id
  }
  return active
}

export const getWikiTocScrollTop = (
  viewport: { top: number, height: number, scrollTop: number },
  item: { top: number, bottom: number },
  padding = 16
) => {
  if (viewport.height <= 0) return viewport.scrollTop
  const top = viewport.top + padding
  const bottom = viewport.top + viewport.height - padding
  if (item.top < top || item.bottom - item.top > bottom - top) {
    return Math.max(0, viewport.scrollTop + item.top - top)
  }
  if (item.bottom > bottom) {
    return viewport.scrollTop + item.bottom - bottom
  }
  return viewport.scrollTop
}
