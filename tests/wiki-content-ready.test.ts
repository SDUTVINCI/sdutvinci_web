import { afterEach, beforeEach, describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { effectScope, nextTick, shallowRef } from 'vue'
import { useWikiContentReady } from '../app/composables/useWikiContentReady'

// Exercise the Vue lifecycle and browser scheduling without requiring a DOM
// dependency. The renderer can mount or replace content after the page mounts.
class TestElement {
  constructor(public decoration = false) {}
  closest() { return this.decoration ? this : null }
  matches() { return this.decoration }
}
class TestObserver {
  static instances: TestObserver[] = []
  connected = false
  constructor(public callback: (records: unknown[]) => void) {
    TestObserver.instances.push(this)
  }
  observe() { this.connected = true }
  disconnect() { this.connected = false }
  notify(record: unknown) { if (this.connected) this.callback([record]) }
}

let frames: Map<number, () => void>
let sequence = 0
let restore: () => void
let scope: ReturnType<typeof effectScope>
const flushFrames = () => {
  const queued = [...frames.values()]
  frames.clear()
  queued.forEach(callback => callback())
}
const mutation = (decoration = false, type = 'childList') => ({
  type,
  target: new TestElement(),
  addedNodes: [new TestElement(decoration)],
  removedNodes: []
})
const setup = () => {
  const root = shallowRef<HTMLElement | null>(null)
  let count = 0
  scope.run(() => useWikiContentReady(root, () => {
    assert.equal(TestObserver.instances.at(-1)?.connected, false)
    count++
  }))
  return { root, count: () => count }
}

beforeEach(() => {
  frames = new Map()
  TestObserver.instances = []
  scope = effectScope()
  const originals = Object.fromEntries(
    ['window', 'Element', 'MutationObserver'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  )
  Object.assign(globalThis, {
    Element: TestElement,
    MutationObserver: TestObserver,
    window: {
      requestAnimationFrame(callback: () => void) { frames.set(++sequence, callback); return sequence },
      cancelAnimationFrame(id: number) { frames.delete(id) }
    }
  })
  restore = () => {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
afterEach(() => { scope.stop(); restore() })

describe('Wiki content readiness', () => {
  it('initializes when a loading page finally mounts its content element', async () => {
    const test = setup()
    await nextTick()
    assert.equal(frames.size, 0)
    test.root.value = new TestElement() as unknown as HTMLElement
    await nextTick()
    flushFrames()
    assert.equal(test.count(), 1)
    assert.equal(TestObserver.instances[0]?.connected, true)
  })

  it('refreshes late renderer output once per frame and ignores generated decorations', async () => {
    const test = setup()
    test.root.value = new TestElement() as unknown as HTMLElement
    await nextTick()
    flushFrames()
    const observer = TestObserver.instances[0]!
    observer.notify(mutation(true))
    assert.equal(frames.size, 0)
    observer.notify(mutation())
    observer.notify(mutation())
    assert.equal(frames.size, 1)
    flushFrames()
    assert.equal(test.count(), 2)
  })

  it('refreshes changed heading IDs and text nodes', async () => {
    const test = setup()
    test.root.value = new TestElement() as unknown as HTMLElement
    await nextTick()
    flushFrames()
    for (const type of ['attributes', 'characterData']) {
      TestObserver.instances[0]!.notify({ ...mutation(false, type), addedNodes: [] })
      flushFrames()
    }
    assert.equal(test.count(), 3)
  })

  it('disconnects replaced content and cancels pending work on unmount', async () => {
    const test = setup()
    test.root.value = new TestElement() as unknown as HTMLElement
    await nextTick()
    const previous = TestObserver.instances[0]!
    test.root.value = new TestElement() as unknown as HTMLElement
    await nextTick()
    assert.equal(previous.connected, false)
    assert.equal(frames.size, 1)
    scope.stop()
    assert.equal(frames.size, 0)
    assert.equal(TestObserver.instances[1]?.connected, false)
    flushFrames()
    assert.equal(test.count(), 0)
  })
})
