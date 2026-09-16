import { afterEach, expect, test, vi } from "vitest"
import { downloadHighlights, formatHighlights, highlightsFilename } from "./highlights"

const book = {
  title: 'A Book: "雪" / Notes',
  author: "An Author",
  bookmarks: [{
    id: "1", text: "First line\nSecond line", annotation: "Remember this",
    created_at: "2026-09-16T12:00:00Z", type: "highlight", chapter_progress: 0, color: 0,
  }, {
    id: "2", text: null, annotation: "A note without a highlight",
    created_at: null, type: "note", chapter_progress: 0, color: 0,
  }],
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test("exports readable plain text, preserving notes, Unicode, and line breaks", () => {
  expect(formatHighlights(book)).toBe('A Book: "雪" / Notes\n\nAn Author\n\nHighlights and notes\n\n1. 2026-09-16T12:00:00Z\n\nFirst line\nSecond line\n\nNote: Remember this\n\n2. Undated\n\nNote: A note without a highlight\n')
  expect(highlightsFilename(book.title)).toBe("A Book_ _雪_ _ Notes-highlights.txt")
  expect(highlightsFilename("  ")).toBe("book-highlights.txt")
})

test("downloads a text file and releases the temporary URL", () => {
  vi.useFakeTimers()
  const createObjectURL = vi.fn((_blob: Blob) => "blob:highlights")
  const revokeObjectURL = vi.fn()
  const NativeURL = URL
  vi.stubGlobal("URL", class extends NativeURL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  })
  let filename = ""
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    filename = this.download
    expect(this.href).toBe("blob:highlights")
    expect(this.isConnected).toBe(true)
  })
  downloadHighlights(book)
  expect(filename).toBe(highlightsFilename(book.title))
  expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
  expect(createObjectURL.mock.calls[0][0].type).toBe("text/plain;charset=utf-8")
  expect(document.querySelector("a[download]")).toBeNull()
  expect(revokeObjectURL).not.toHaveBeenCalled()
  vi.runAllTimers()
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:highlights")
})
