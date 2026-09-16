import type { BookDetail } from "@/types"

type HighlightBook = Pick<BookDetail, "title" | "author" | "bookmarks">

export function formatHighlights(book: HighlightBook): string {
  const entries = book.bookmarks.map((bookmark, index) => [
    `${index + 1}. ${bookmark.created_at ?? "Undated"}`,
    bookmark.text,
    bookmark.annotation ? `Note: ${bookmark.annotation}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n\n"))
  return [book.title, book.author, "Highlights and notes", ...entries].join("\n\n") + "\n"
}

export function highlightsFilename(title: string): string {
  const safeTitle = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 100)
  return `${safeTitle || "book"}-highlights.txt`
}

export function downloadHighlights(book: HighlightBook) {
  const url = URL.createObjectURL(new Blob([formatHighlights(book)], { type: "text/plain;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = highlightsFilename(book.title)
  try {
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    // Give the browser time to begin reading the download before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }
}
