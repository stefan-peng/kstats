import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import App from "./App"

const dashboard = {
  totals: { library: 3, finished: 1, reading: 1, reading_seconds: 10861 },
  status_counts: { unread: 1, reading: 1, finished: 1 },
  monthly_completions: [{ month: "2026-05", count: 1 }],
  continue_reading: [
    {
      content_id: "book-1",
      title: "Current Book",
      author: "Ada Reader",
      status: "reading",
      reading_seconds: 3661,
      percent_read: 42,
      times_started: 3,
      date_last_read: "2026-06-16T12:00:00Z",
      last_started_at: null,
      finished_at: null,
      downloaded: true,
      word_count: 80000,
      series: null,
      series_number: null,
      publisher: null,
      description: null,
      mime_type: "application/epub+zip",
    },
  ],
  recent_books: [],
  top_books: [],
}

function mockFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/device/status")) {
        return Response.json({
          connected: true,
          snapshot_available: true,
          imported_at: "2026-06-18T12:00:00Z",
          source: "/Volumes/KOBOeReader/.kobo/KoboReader.sqlite",
        })
      }
      if (url.includes("/api/dashboard")) return Response.json(dashboard)
      if (url.includes("/api/books")) {
        return Response.json({
          items: dashboard.continue_reading,
          page: 1,
          page_size: 20,
          total: 1,
          pages: 1,
        })
      }
      if (url.includes("/api/import")) {
        return Response.json({
          connected: true,
          snapshot_available: true,
          imported_at: "2026-06-18T13:00:00Z",
          source: "/Volumes/KOBOeReader/.kobo/KoboReader.sqlite",
        })
      }
      throw new Error(`Unhandled request: ${url}`)
    }),
  )
}

beforeEach(mockFetch)
afterEach(() => vi.unstubAllGlobals())

test("renders overview metrics from the imported snapshot", async () => {
  render(<App />)
  expect(await screen.findByRole("heading", { name: "Reading overview" })).toBeVisible()
  expect(screen.getByText("3h 1m")).toBeVisible()
  expect(screen.getByText("Current Book")).toBeVisible()
})

test("opens the library and exposes sortable headers", async () => {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole("heading", { name: "Reading overview" })
  await user.click(screen.getAllByRole("button", { name: "Library" })[0])
  expect(await screen.findByRole("heading", { name: "Library" })).toBeVisible()
  await waitFor(() => {
    expect(screen.getAllByRole("columnheader", { name: /Book/ })[0]).toHaveAttribute(
      "aria-sort",
      "none",
    )
  })
})

test("refreshes the device snapshot", async () => {
  const user = userEvent.setup()
  render(<App />)
  const button = await screen.findByRole("button", { name: "Refresh from Kobo" })
  await user.click(button)
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/import", { method: "POST" }))
})
