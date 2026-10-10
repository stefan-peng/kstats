import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test, vi } from "vitest"
import { ResumeReading } from "./resume-reading"
import type { Book } from "@/types"

afterEach(cleanup)

const book: Book = {
  content_id: "old", title: "Old Book", author: "Author", status: "reading",
  reading_seconds: 120, percent_read: 75, date_last_read: "2026-08-01T00:00:00Z", finished_at: null,
  current_chapter_estimate_seconds: 0, rest_of_book_estimate_seconds: 600,
  remaining_seconds: 600, remaining_estimate_source: "kobo", remaining_estimate_sessions: 0,
  remaining_estimate_reading_seconds: 0, remaining_estimate_progress: 0,
  downloaded: true, word_count: null, series: null, series_number: null, publisher: null,
  language: "en", isbn: null, description: null, mime_type: "application/epub+zip",
  source_type: "sideloaded", bookmark_count: 0, cover_url: null,
}

test("shows snapshot-relative inactivity and opens shortest-estimate books", async () => {
  const user = userEvent.setup()
  const onOpenBook = vi.fn()
  render(<ResumeReading data={{ as_of: "2026-10-10T12:00:00Z", books: [
    { ...book, days_since_read: 70 },
    { ...book, content_id: "unknown", title: "Unknown Book", days_since_read: null, remaining_seconds: 0 },
  ] }} onOpenBook={onOpenBook} />)
  expect(screen.getByText(/Days since last recorded reading do not establish abandonment/)).toBeVisible()
  const table = screen.getByRole("table")
  expect(screen.getByRole("region", { name: "Scrollable in-progress books" })).toHaveAttribute("tabindex", "0")
  expect(within(table).getByText("70")).toBeVisible()
  expect(within(table).getByText("Unknown")).toBeVisible()
  expect(screen.getByText("10m estimated · Kobo")).toBeVisible()
  await user.click(within(table).getByRole("button", { name: "Old Book" }))
  expect(onOpenBook).toHaveBeenCalledWith("old")
  expect(screen.getByRole("heading", { name: "Shortest remaining estimates" })).toBeVisible()
})

test("does not invent a snapshot date or remaining estimates", () => {
  render(<ResumeReading data={{ as_of: null, books: [] }} onOpenBook={vi.fn()} />)
  expect(screen.getByText(/unknown snapshot date/)).toBeVisible()
  expect(screen.queryByText("Shortest remaining estimates")).not.toBeInTheDocument()
})
