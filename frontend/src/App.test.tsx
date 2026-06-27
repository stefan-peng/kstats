import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import App from "./App"
import { BookDetailDialog } from "./components/book-detail-dialog"

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
      date_last_read: "2026-06-16T12:00:00Z",
      finished_at: null,
      current_chapter_estimate_seconds: 4060,
      rest_of_book_estimate_seconds: 11507,
      remaining_seconds: 15567,
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

function bookDetail(overrides = {}) {
  return {
    ...dashboard.continue_reading[0],
    bookmarks: [],
    dictionary_lookups: [],
    ...overrides,
  }
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
          dictionary_lookups: [
            {
              word: "perspicacious",
              dictionary: "en",
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
  expect(await screen.findByText("4h 19m")).toBeVisible()
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

  const remainingHeader = screen.getByRole("columnheader", {
    name: "Time remaining",
  })
  await user.click(within(remainingHeader).getByRole("button"))
  await waitFor(() => {
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("sort=remaining_time"),
      undefined,
    )
  })

  await user.type(screen.getByRole("textbox", { name: "Search library" }), "Current")
  await waitFor(() => {
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("search=Current"),
      undefined,
    )
  })
})

test("filters the embedded library from a selected completion month", async () => {
  const user = userEvent.setup()
  render(<App />)

  const [statusFilter] = await screen.findAllByRole("combobox")
  await user.click(statusFilter)
  await user.click(screen.getByRole("option", { name: "In progress" }))
  await waitFor(() => {
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("status=reading"),
      undefined,
    )
  })

  const month = await screen.findByRole("button", {
    name: "May 2026, 1 book completed",
  })
  await user.click(month)

  expect(screen.getByText("Finished in May 2026")).toBeVisible()
  expect(statusFilter).toHaveTextContent("All statuses")
  await waitFor(() => {
    const bookRequests = vi.mocked(fetch).mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/api/books"))
    expect(bookRequests.at(-1)).toContain("finished_month=2026-05")
    expect(bookRequests.at(-1)).toContain("status=all")
  })

  await user.click(statusFilter)
  await user.click(screen.getByRole("option", { name: "Unread" }))
  expect(screen.queryByText("Finished in May 2026")).not.toBeInTheDocument()
  expect(statusFilter).toHaveTextContent("Unread")
  await waitFor(() => {
    const bookRequests = vi.mocked(fetch).mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/api/books"))
    expect(bookRequests.at(-1)).not.toContain("finished_month")
    expect(bookRequests.at(-1)).toContain("status=unread")
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
  expect(within(dialog).queryByText("Times opened")).not.toBeInTheDocument()
  expect(within(dialog).getByText("Estimated time remaining")).toBeVisible()
  expect(within(dialog).getByText("4h 19m")).toBeVisible()
  expect(within(dialog).getByText("1h 7m")).toBeVisible()
  expect(within(dialog).getByText("3h 11m")).toBeVisible()
  expect(within(dialog).queryByText(/Reading sessions/)).not.toBeInTheDocument()
  expect(within(dialog).getByText("Dictionary lookups (1)")).toBeVisible()
  expect(within(dialog).getByText("perspicacious")).toBeVisible()
})

test("clears stale book details when opening a different book", async () => {
  let resolveSecondBook: (response: Response) => void = () => {}
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("content_id=book-1")) {
        return Promise.resolve(
          Response.json(bookDetail({ content_id: "book-1", title: "First Book" })),
        )
      }
      if (url.includes("content_id=book-2")) {
        return new Promise<Response>((resolve) => {
          resolveSecondBook = resolve
        })
      }
      throw new Error(`Unhandled request: ${url}`)
    }),
  )

  const onOpenChange = vi.fn()
  const { rerender } = render(
    <BookDetailDialog contentId="book-1" onOpenChange={onOpenChange} />,
  )

  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByRole("heading", { name: "First Book" })).toBeVisible()

  rerender(<BookDetailDialog contentId="book-2" onOpenChange={onOpenChange} />)
  expect(
    within(screen.getByRole("dialog")).queryByRole("heading", { name: "First Book" }),
  ).not.toBeInTheDocument()

  resolveSecondBook(
    Response.json(bookDetail({ content_id: "book-2", title: "Second Book" })),
  )
  expect(
    await within(screen.getByRole("dialog")).findByRole("heading", {
      name: "Second Book",
    }),
  ).toBeVisible()
})

test("clears stale book detail errors before retry content loads", async () => {
  let resolveRetry: (response: Response) => void = () => {}
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("content_id=failed-book")) {
        return Promise.resolve(
          Response.json({ detail: "Backend down" }, { status: 500 }),
        )
      }
      if (url.includes("content_id=recovered-book")) {
        return new Promise<Response>((resolve) => {
          resolveRetry = resolve
        })
      }
      throw new Error(`Unhandled request: ${url}`)
    }),
  )

  const onOpenChange = vi.fn()
  const { rerender } = render(
    <BookDetailDialog contentId="failed-book" onOpenChange={onOpenChange} />,
  )

  expect(await screen.findByText("Backend down")).toBeVisible()

  rerender(
    <BookDetailDialog contentId="recovered-book" onOpenChange={onOpenChange} />,
  )
  expect(screen.queryByText("Backend down")).not.toBeInTheDocument()

  resolveRetry(
    Response.json(
      bookDetail({ content_id: "recovered-book", title: "Recovered Book" }),
    ),
  )
  expect(
    await within(screen.getByRole("dialog")).findByRole("heading", {
      name: "Recovered Book",
    }),
  ).toBeVisible()
})

test("suppresses unavailable remaining time", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/device/status")) {
        return Response.json({
          connected: false,
          snapshot_available: true,
          imported_at: "2026-06-18T12:00:00Z",
          source: null,
        })
      }
      if (url.includes("/api/dashboard")) {
        return Response.json({
          ...dashboard,
          continue_reading: [],
        })
      }
      if (url.includes("/api/books")) {
        return Response.json({
          items: [
            {
              ...dashboard.continue_reading[0],
              status: "finished",
              remaining_seconds: 0,
              current_chapter_estimate_seconds: 0,
              rest_of_book_estimate_seconds: 0,
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          pages: 1,
        })
      }
      if (url.includes("/api/book?")) {
        return Response.json({
          ...dashboard.continue_reading[0],
          status: "finished",
          remaining_seconds: 0,
          current_chapter_estimate_seconds: 0,
          rest_of_book_estimate_seconds: 0,
          bookmarks: [],
          dictionary_lookups: [],
        })
      }
      throw new Error(`Unhandled request: ${url}`)
    }),
  )

  const user = userEvent.setup()
  render(<App />)
  const row = await screen.findByRole("row", { name: /Current Book Ada Reader/ })
  expect(within(row).getByText("—")).toBeVisible()
  await user.click(row)
  const dialog = await screen.findByRole("dialog")
  expect(
    within(dialog).queryByText("Estimated time remaining"),
  ).not.toBeInTheDocument()
})

test("shows unavailable chapter estimate as a dash", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/device/status")) {
        return Response.json({
          connected: false,
          snapshot_available: true,
          imported_at: "2026-06-18T12:00:00Z",
          source: null,
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
          current_chapter_estimate_seconds: 0,
          rest_of_book_estimate_seconds: 11507,
          remaining_seconds: 11507,
          bookmarks: [],
          dictionary_lookups: [],
        })
      }
      throw new Error(`Unhandled request: ${url}`)
    }),
  )

  const user = userEvent.setup()
  render(<App />)
  const row = await screen.findByRole("row", { name: /Current Book Ada Reader/ })
  await user.click(row)
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByText("Estimated time remaining")).toBeVisible()
  const chapterLabel = within(dialog).getByText("Current chapter")
  expect(chapterLabel.nextElementSibling).toHaveTextContent("—")
  expect(within(dialog).queryByText("0s")).not.toBeInTheDocument()
})

test("refreshes the device snapshot", async () => {
  const user = userEvent.setup()
  render(<App />)
  const button = await screen.findByRole("button", { name: "Refresh from Kobo" })
  await user.click(button)
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/import", { method: "POST" }))
})
