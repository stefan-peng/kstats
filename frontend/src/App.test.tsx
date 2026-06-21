import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
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
      if (url.includes("/api/book?")) {
        return Response.json({
          ...dashboard.continue_reading[0],
          description:
            '<p><strong>Formatted introduction</strong> with <em>emphasis</em>.</p><a href="//evil.example">unsafe link</a><script>unsafe text</script>',
          bookmarks: [
            {
              id: "highlight-1",
              text: "Highlighted text",
              annotation: "A note",
              type: "highlight",
              created_at: "2026-06-16T11:30:00Z",
              chapter_progress: 0.4,
              color: 0,
            },
          ],
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
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test("renders overview metrics from the imported snapshot", async () => {
  render(<App />)
  expect(await screen.findByRole("heading", { name: "Reading overview" })).toBeVisible()
  expect(screen.getByText("3h 1m")).toBeVisible()
  expect(screen.getAllByText("Current Book")).toHaveLength(2)
  expect(await screen.findByRole("heading", { name: "Library" })).toBeVisible()
  expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument()
  await waitFor(() => {
    const sectors = document.querySelectorAll(".recharts-pie-sector path")
    expect(sectors).toHaveLength(3)
    sectors.forEach((sector) => {
      expect(sector).toHaveAttribute("stroke", "var(--card)")
    })
  })
})

test("shows an explicit device status while loading", () => {
  render(<App />)
  expect(screen.getByText("Checking Kobo")).toBeVisible()
})

test("does not claim to use a snapshot when none is available", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/device/status")) {
        return Response.json({
          connected: false,
          snapshot_available: false,
          imported_at: null,
          source: null,
        })
      }
      throw new Error(`Unhandled request: ${input}`)
    }),
  )
  render(<App />)
  expect(await screen.findByText("No snapshot")).toBeVisible()
  expect(screen.queryByText("Using snapshot")).not.toBeInTheDocument()
})

test("supports library search and sortable headers on the dashboard", async () => {
  const user = userEvent.setup()
  render(<App />)
  const bookHeader = (await screen.findAllByRole("columnheader", { name: /Book/ }))[0]
  expect(bookHeader).toHaveAttribute("aria-sort", "none")
  await user.click(within(bookHeader).getByRole("button"))
  await waitFor(() => {
    expect(bookHeader).toHaveAttribute("aria-sort", "ascending")
  })

  await user.type(screen.getByRole("textbox", { name: "Search library" }), "Current")
  await waitFor(() => {
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("search=Current"),
      undefined,
    )
  })
})

test("opens book details from the embedded library", async () => {
  const user = userEvent.setup()
  render(<App />)
  const row = await screen.findByRole("row", { name: /Current Book Ada Reader/ })
  await user.click(row)
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByRole("heading", { name: "Current Book" })).toBeVisible()
  expect(within(dialog).getByText("Formatted introduction").tagName).toBe("STRONG")
  expect(within(dialog).getByText("emphasis").tagName).toBe("EM")
  expect(within(dialog).getByText("unsafe link")).not.toHaveAttribute("href")
  expect(within(dialog).queryByText("unsafe text")).not.toBeInTheDocument()
  expect(within(dialog).getByText("Highlighted text")).toBeVisible()
})

test("refreshes the device snapshot", async () => {
  const user = userEvent.setup()
  render(<App />)
  const button = await screen.findByRole("button", { name: "Refresh from Kobo" })
  await user.click(button)
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/import", { method: "POST" }))
})
