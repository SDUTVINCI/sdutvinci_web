import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { getActiveWikiHeadingId, getWikiTocScrollTop } from '../app/utils/wiki-toc-scroll'

const heading = (id: string, top: number) => ({
  id,
  offsetTop: 0,
  getBoundingClientRect: () => ({ top })
}) as HTMLElement

describe('Wiki active heading and directory scrolling', () => {
  it('uses viewport positions and accepts fractional scroll-margin alignment', () => {
    const headings = [heading('first', -100), heading('second', 108.5), heading('third', 450)]
    assert.equal(getActiveWikiHeadingId(headings, 108), 'second')
    assert.equal(getActiveWikiHeadingId([heading('first', 200)], 108), '')
    assert.equal(getActiveWikiHeadingId([], 108), '')
  })

  it('follows scrolling upward and downward through the article', () => {
    assert.equal(getActiveWikiHeadingId([heading('first', -200), heading('second', 80)], 108), 'second')
    assert.equal(getActiveWikiHeadingId([heading('first', 50), heading('second', 300)], 108), 'first')
  })

  it('leaves an already visible entry and the user directory position alone', () => {
    assert.equal(getWikiTocScrollTop({ top: 100, height: 400, scrollTop: 200 }, { top: 150, bottom: 190 }), 200)
  })

  it('reveals entries below and above the directory viewport with padding', () => {
    const viewport = { top: 100, height: 400, scrollTop: 200 }
    assert.equal(getWikiTocScrollTop(viewport, { top: 520, bottom: 560 }), 276)
    assert.equal(getWikiTocScrollTop(viewport, { top: 60, bottom: 100 }), 144)
  })

  it('handles hidden directories, the first entry and unusually tall entries', () => {
    assert.equal(getWikiTocScrollTop({ top: 100, height: 0, scrollTop: 200 }, { top: 500, bottom: 540 }), 200)
    assert.equal(getWikiTocScrollTop({ top: 100, height: 400, scrollTop: 0 }, { top: 100, bottom: 140 }), 0)
    assert.equal(getWikiTocScrollTop({ top: 100, height: 100, scrollTop: 200 }, { top: 140, bottom: 300 }), 224)
  })
})
