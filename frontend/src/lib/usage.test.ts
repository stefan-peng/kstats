import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startUsage, trackUsage } from "./usage"

let stop: (() => void) | undefined
let intersect: IntersectionObserverCallback
const fetchMock = vi.fn()
const counts = () => fetchMock.mock.calls.map((call) => JSON.parse(call[1].body))

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset().mockResolvedValue({ ok: true })
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback }
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  document.body.innerHTML = ''
})
afterEach(() => {
  stop?.()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function show(element: Element, visible = true) {
  intersect([{ target: element, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 } as IntersectionObserverEntry], {} as IntersectionObserver)
}

describe("background usage", () => {
  it("records activation once, handles keyboard, ignores disabled controls and sends no content", () => {
    document.body.innerHTML = `<div role="button" data-usage-action="book.open.continue"><span>Private title</span></div><button disabled data-usage-action="import.refresh">Refresh</button>`
    stop = startUsage()
    startUsage() // Accidental duplicate start must not install listeners twice.
    document.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.querySelector('div')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(counts()).toEqual(['app.open', 'book.open.continue', 'book.open.continue'].map(name => ({ name, revision: 'baseline-v1' })))
  })

  it("counts a search edit on blur, never its text or individual keystrokes", () => {
    document.body.innerHTML = '<input data-usage-search="library.search" />'
    stop = startUsage()
    const input = document.querySelector('input')!
    input.value = 'private search'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(counts()).toHaveLength(1)
    input.dispatchEvent(new Event('blur'))
    input.dispatchEvent(new Event('blur'))
    expect(counts().map(row => row.name)).toEqual(['app.open', 'library.search'])
  })

  it("requires one continuous second of visibility and counts each section once per load", () => {
    document.body.innerHTML = '<h2 data-usage-view="notes">Notes</h2>'
    stop = startUsage()
    const heading = document.querySelector('h2')!
    show(heading)
    vi.advanceTimersByTime(600)
    show(heading, false)
    vi.advanceTimersByTime(1000)
    expect(counts()).toHaveLength(1)
    show(heading)
    vi.advanceTimersByTime(1000)
    show(heading)
    vi.advanceTimersByTime(1000)
    expect(counts().map(row => row.name)).toEqual(['app.open', 'seen.notes'])
  })

  it("does not count background sections behind a dialog or in a hidden tab", () => {
    document.body.innerHTML = '<h2 data-usage-view="library">Library</h2><div role="dialog"></div>'
    stop = startUsage()
    show(document.querySelector('h2')!)
    vi.advanceTimersByTime(1000)
    expect(counts()).toHaveLength(1)
    document.querySelector('[role="dialog"]')!.remove()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(1000)
    expect(counts()).toHaveLength(1)
    vi.restoreAllMocks()
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(1000)
    expect(counts().map(row => row.name)).toEqual(['app.open', 'seen.library'])
  })

  it("does not break app actions when logging fails and stops on cleanup", async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    stop = startUsage()
    expect(() => trackUsage('theme.toggle')).not.toThrow()
    await Promise.resolve()
    stop()
    trackUsage('theme.toggle')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
