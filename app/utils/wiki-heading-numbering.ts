export interface WikiHeadingNumberInput {
  id: string
  text: string
  depth: number
}

export interface NumberedWikiHeading extends WikiHeadingNumberInput {
  level: number
  number: string
}

export const numberWikiHeadings = (
  headings: readonly WikiHeadingNumberInput[]
): NumberedWikiHeading[] => {
  const counters: number[] = []
  let previousDepth = 0
  let previousLogicalLevel = 1

  return headings.map((heading) => {
    let logicalLevel = 1
    if (previousDepth === 0) {
      logicalLevel = 1
    } else if (heading.depth > previousDepth) {
      logicalLevel = Math.min(previousLogicalLevel + 1, 5)
    } else if (heading.depth === previousDepth) {
      logicalLevel = previousLogicalLevel
    } else {
      logicalLevel = Math.max(
        1,
        previousLogicalLevel - (previousDepth - heading.depth)
      )
    }

    counters[logicalLevel - 1] = (counters[logicalLevel - 1] || 0) + 1
    counters.length = logicalLevel
    previousDepth = heading.depth
    previousLogicalLevel = logicalLevel

    return {
      ...heading,
      level: logicalLevel,
      number: counters.join('.')
    }
  })
}

export const collectNumberedWikiHeadings = (root: ParentNode) => {
  const elements = Array.from(
    root.querySelectorAll('h2, h3, h4, h5, h6')
  ) as HTMLElement[]
  const numbered = numberWikiHeadings(elements.flatMap((heading) => {
    if (!heading.id) return []
    const depth = Number(heading.tagName.slice(1))
    if (!Number.isFinite(depth)) return []
    const cloned = heading.cloneNode(true) as HTMLElement
    cloned.querySelectorAll('.heading-number').forEach(node => node.remove())
    return [{
      id: heading.id,
      text: (cloned.textContent || '').trim(),
      depth
    }]
  }))
  const numberedIds = new Set(numbered.map(item => item.id))

  return {
    elements: elements.filter(element => numberedIds.has(element.id)),
    numbered
  }
}

export const applyWikiHeadingNumbers = (
  elements: readonly HTMLElement[],
  headings: readonly NumberedWikiHeading[]
) => {
  const headingMap = new Map(headings.map(item => [item.id, item.number]))

  for (const element of elements) {
    const number = headingMap.get(element.id)
    const existing = element.querySelector(':scope > .heading-number')
    if (!number) {
      existing?.remove()
      continue
    }

    const label = `${number} `
    if (existing?.textContent === label) continue
    existing?.remove()
    const numberSpan = document.createElement('span')
    numberSpan.className = 'heading-number'
    numberSpan.textContent = label
    numberSpan.setAttribute('aria-hidden', 'true')
    element.prepend(numberSpan)
  }
}
