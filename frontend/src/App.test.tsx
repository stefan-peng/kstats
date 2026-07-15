import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import App from "./App"
import { BookDetailDialog } from "./components/book-detail-dialog"

const dashboard = {
  totals: { library: 3, finished: 1, reading: 1, reading_seconds: 10861 },
  status_counts: { unread: 1, reading: 1, finished: 1 },
  source_summary: {
    kept_kobo_store: 3,
    kept_sideloaded: 0,
    ignored_custom_catalog: 3375,
    removed_with_activity: 0,
    merged_removed_history: 0,
  },
  monthly_completions: [{ month: "2026-05", count: 1 }],
  reading_duration: {
    estimated: true,
    coverage_start: "2026-06-16",
    coverage_end: "2026-06-17",
    source_seconds: 1800,
    allocated_seconds: 1800,
    unallocated_seconds: 0,
    skipped_rows: 0,
    daily: [
      { date: "2026-06-16", seconds: 900 },
      { date: "2026-06-17", seconds: 900 },
    ],
  },
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
      language: "en",
      isbn: "9780000000001",
      description: null,
      mime_type: "application/epub+zip",
      source_type: "kobo_store",
      bookmark_count: 1,
      cover_url: "/api/covers/book-1-grid.jpg",
    },
  ],
  top_books: [
    {
      content_id: "book-top",
      title: "Most Read Book",
      author: "Time Keeper",
      status: "finished",
      reading_seconds: 7200,
      percent_read: 100,
      date_last_read: "2026-05-20T12:00:00Z",
      finished_at: "2026-05-20T12:00:00Z",
      current_chapter_estimate_seconds: 0,
      rest_of_book_estimate_seconds: 0,
      remaining_seconds: 0,
      downloaded: true,
      word_count: null,
      series: null,
      series_number: null,
      publisher: null,
      language: "en",
      isbn: null,
      description: null,
      mime_type: "application/epub+zip",
      source_type: "kobo_store",
      bookmark_count: 0,
      cover_url: null,
    },
  ],
}

function bookDetail(overrides = {}) {
  return {
    ...dashboard.continue_reading[0],
    bookmarks: [],
    dictionary_lookups: [],
    reading_duration: {
      estimated: true,
      coverage_start: "2026-06-16",
      coverage_end: "2026-06-17",
      source_seconds: 1800,
      allocated_seconds: 1800,
      unallocated_seconds: 0,
      skipped_rows: 0,
      daily: [
        { date: "2026-06-16", seconds: 900 },
        { date: "2026-06-17", seconds: 900 },
      ],
    },
    data_source: {
      snapshot_path: ".data/KoboReader.sqlite",
      read_only: true,
    },
    ...overrides,
  }
}

const filterOptions = {
  series: ["Series"],
  publishers: ["Press"],
  languages: ["en"],
}

let localStorageDescriptor: PropertyDescriptor | undefined

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
          filter_options: filterOptions,
          source_summary: dashboard.source_summary,
        })
      }
      if (url.includes("/api/book?")) {
        if (url.includes("content_id=book-top")) {
          return Response.json(bookDetail({
            ...dashboard.top_books[0],
            bookmarks: [],
            dictionary_lookups: [],
          }))
        }
        return Response.json(bookDetail({
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
        }))
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

beforeEach(() => {
  localStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage")
  mockFetch()
})
afterEach(() => {
  cleanup()
  if (localStorageDescriptor) {
    Object.defineProperty(window, "localStorage", localStorageDescriptor)
  }
  localStorageDescriptor = undefined
  vi.unstubAllGlobals()
})

test("renders overview metrics from the imported snapshot", async () => {
  render(<App />)
  expect(await screen.findByRole("heading", { name: "Reading overview" })).toBeVisible()
  const importedAt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date("2026-06-18T12:00:00Z"))
  expect(screen.getByText(`Snapshot from ${importedAt}`)).toBeVisible()
  expect(screen.getByText("3h 1m")).toBeVisible()
  expect(await screen.findByText("4h 19m")).toBeVisible()
  expect(screen.getAllByText("Current Book")).toHaveLength(2)
  expect(screen.getByRole("heading", { name: "Most read" })).toBeVisible()
  expect(screen.getByText("Most Read Book")).toBeVisible()
  expect(
    screen.queryByText("Local Kobo snapshot data, filtered to reliable reader fields."),
  ).not.toBeInTheDocument()
  expect(await screen.findByRole("heading", { name: "Library" })).toBeVisible()
  expect(
    screen.queryByText("Search, filter, and sort the books in your local Kobo snapshot."),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument()
  await waitFor(() => {
    const sectors = document.querySelectorAll(".recharts-pie-sector path")
    expect(sectors).toHaveLength(3)
    sectors.forEach((sector) => {
      expect(sector).toHaveAttribute("stroke", "var(--card)")
    })
  })
})

test("switches the reading duration chart granularity without refetching", async () => {
  const user = userEvent.setup()
  render(<App />)

  expect(await screen.findByText("Reading duration")).toBeVisible()
  expect(
    screen.getByText(/Estimated from Kobo session telemetry/),
  ).toBeVisible()
  expect(screen.getByRole("img", { name: "Estimated reading duration by week" })).toBeVisible()
  expect(screen.getByRole("button", { name: "Weekly" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )

  await user.click(screen.getByRole("button", { name: "Daily" }))

  expect(screen.getByRole("img", { name: "Estimated reading duration by day" })).toBeVisible()
  expect(screen.getByRole("button", { name: "Daily" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  expect(fetch).toHaveBeenCalledTimes(3)
})

test("switches the reading duration chart to a calendar heatmap", async () => {
  const user = userEvent.setup()
  render(<App />)

  expect(await screen.findByRole("img", { name: "Estimated reading duration by week" })).toBeVisible()
  await user.click(screen.getByRole("button", { name: "Heatmap" }))

  expect(
    screen.getByRole("region", { name: "Estimated reading duration as a calendar heatmap" }),
  ).toBeVisible()
  expect(screen.getByRole("button", { name: "Heatmap" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  expect(screen.getAllByRole("gridcell").length).toBeGreaterThan(365)
  expect(fetch).toHaveBeenCalledTimes(3)
})

test("persists the selected reading duration option", async () => {
  const storedOptions = new Map<string, string>()
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storedOptions.get(key) ?? null,
      setItem: (key: string, value: string) => storedOptions.set(key, value),
      clear: () => storedOptions.clear(),
    },
  })
  window.localStorage.clear()
  const user = userEvent.setup()
  const firstRender = render(<App />)

  await user.click(await screen.findByRole("button", { name: "Heatmap" }))
  expect(window.localStorage.getItem("kstats.reading-duration-option")).toBe("heatmap")

  firstRender.unmount()
  render(<App />)

  expect(await screen.findByRole("button", { name: "Heatmap" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
})

test("shows an empty state when detailed reading telemetry is unavailable", async () => {
  const defaultFetch = fetch
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/dashboard")) {
        return Response.json({
          ...dashboard,
          reading_duration: {
            estimated: true,
            coverage_start: null,
            coverage_end: null,
            source_seconds: 0,
            allocated_seconds: 0,
            unallocated_seconds: 0,
            skipped_rows: 0,
            daily: [],
          },
        })
      }
      return defaultFetch(input, init)
    }),
  )

  render(<App />)

  expect(
    await screen.findByText("No detailed reading telemetry is available."),
  ).toBeVisible()
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
  expect(await screen.findByText("Kobo disconnected")).toBeVisible()
  expect(screen.queryByText("Using snapshot")).not.toBeInTheDocument()
})

test("updates Kobo connection status when a disconnected Kobo is rechecked", async () => {
  let statusCalls = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/device/status")) {
        statusCalls += 1
        return Response.json({
          connected: statusCalls === 1,
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
          filter_options: filterOptions,
          source_summary: dashboard.source_summary,
        })
      }
      throw new Error(`Unhandled request: ${url}`)
    }),
  )

  render(<App />)
  expect((await screen.findAllByText("Kobo connected")).length).toBeGreaterThan(0)

  await act(async () => {
    window.dispatchEvent(new Event("focus"))
  })

  expect(await screen.findByText("Kobo disconnected")).toBeVisible()
  expect(screen.queryAllByText("Kobo connected")).toHaveLength(0)
})

test("imports Kobo data when a disconnected Kobo reconnects", async () => {
  let statusCalls = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/device/status")) {
        statusCalls += 1
        return Response.json({
          connected: statusCalls > 1,
          snapshot_available: statusCalls > 1,
          imported_at: statusCalls > 1 ? "2026-06-18T13:00:00Z" : null,
          source: statusCalls > 1 ? "/Volumes/KOBOeReader/.kobo/KoboReader.sqlite" : null,
        })
      }
      if (url.includes("/api/import")) {
        expect(init).toEqual({ method: "POST" })
        return Response.json({
          connected: true,
          snapshot_available: true,
          imported_at: "2026-06-18T13:00:00Z",
          source: "/Volumes/KOBOeReader/.kobo/KoboReader.sqlite",
        })
      }
      if (url.includes("/api/dashboard")) return Response.json(dashboard)
      throw new Error(`Unhandled request: ${url}`)
    }),
  )

  render(<App />)
  expect(await screen.findByText("Kobo disconnected")).toBeVisible()

  await act(async () => {
    window.dispatchEvent(new Event("focus"))
  })

  await waitFor(() => {
    expect(fetch).toHaveBeenCalledWith("/api/import", { method: "POST" })
  })
  expect(await screen.findByText("Kobo connected")).toBeVisible()
  expect(await screen.findByRole("heading", { name: "Reading overview" })).toBeVisible()
})

test("retries a reconnect import that fails while the Kobo is becoming available", async () => {
  let statusCalls = 0
  let importCalls = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/device/status")) {
        statusCalls += 1
        return Response.json({
          connected: statusCalls > 1,
          snapshot_available: true,
          imported_at: "2026-06-18T12:00:00Z",
          source: "/Volumes/KOBOeReader/.kobo/KoboReader.sqlite",
        })
      }
      if (url.includes("/api/import")) {
        importCalls += 1
        if (importCalls === 1) {
          return Response.json({ detail: "Kobo database is not ready" }, { status: 503 })
        }
        return Response.json({
          connected: true,
          snapshot_available: true,
          imported_at: "2026-06-18T13:00:00Z",
          source: "/Volumes/KOBOeReader/.kobo/KoboReader.sqlite",
        })
      }
      if (url.includes("/api/dashboard")) return Response.json(dashboard)
      throw new Error(`Unhandled request: ${url}`)
    }),
  )

  render(<App />)
  expect(await screen.findByText("Kobo disconnected")).toBeVisible()

  await act(async () => {
    window.dispatchEvent(new Event("focus"))
  })
  await waitFor(() => expect(importCalls).toBe(1))

  await act(async () => {
    window.dispatchEvent(new Event("focus"))
  })
  await waitFor(() => expect(importCalls).toBe(2))
})

test("serializes overlapping reconnect status checks", async () => {
  let statusCalls = 0
  let importCalls = 0
  let resolveReconnectStatus!: (response: Response) => void
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/device/status")) {
        statusCalls += 1
        if (statusCalls === 1) {
          return Promise.resolve(
            Response.json({
              connected: false,
              snapshot_available: true,
              imported_at: "2026-06-18T12:00:00Z",
              source: "/Volumes/KOBOeReader/.kobo/KoboReader.sqlite",
            }),
          )
        }
        return new Promise((resolve) => {
          resolveReconnectStatus = resolve
        })
      }
      if (url.includes("/api/import")) {
        importCalls += 1
        return Promise.resolve(
          Response.json({
            connected: true,
            snapshot_available: true,
            imported_at: "2026-06-18T13:00:00Z",
            source: "/Volumes/KOBOeReader/.kobo/KoboReader.sqlite",
          }),
        )
      }
      if (url.includes("/api/dashboard")) return Promise.resolve(Response.json(dashboard))
      return Promise.reject(new Error(`Unhandled request: ${url}`))
    }),
  )

  render(<App />)
  expect(await screen.findByText("Kobo disconnected")).toBeVisible()

  window.dispatchEvent(new Event("focus"))
  await waitFor(() => expect(statusCalls).toBe(2))
  window.dispatchEvent(new Event("focus"))

  resolveReconnectStatus(
    Response.json({
      connected: true,
      snapshot_available: true,
      imported_at: "2026-06-18T13:00:00Z",
      source: "/Volumes/KOBOeReader/.kobo/KoboReader.sqlite",
    }),
  )
  await waitFor(() => expect(importCalls).toBe(1))
})

test("does not let an initial dashboard response overwrite refreshed data", async () => {
  let statusCalls = 0
  let dashboardCalls = 0
  let resolveInitialDashboard!: (response: Response) => void
  const initialDashboard = new Promise<Response>((resolve) => {
    resolveInitialDashboard = resolve
  })
  const refreshedDashboard = {
    ...dashboard,
    totals: { ...dashboard.totals, library: 99 },
    continue_reading: [{ ...dashboard.continue_reading[0], title: "Refreshed Book" }],
  }

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/device/status")) {
        statusCalls += 1
        return Response.json({
          connected: statusCalls > 1,
          snapshot_available: true,
          imported_at: "2026-06-18T12:00:00Z",
          source: "/Volumes/KOBOeReader/.kobo/KoboReader.sqlite",
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
      if (url.includes("/api/dashboard")) {
        dashboardCalls += 1
        return dashboardCalls === 1 ? initialDashboard : Response.json(refreshedDashboard)
      }
      throw new Error(`Unhandled request: ${url}`)
    }),
  )

  render(<App />)
  expect(await screen.findByText("Kobo disconnected")).toBeVisible()

  await act(async () => {
    window.dispatchEvent(new Event("focus"))
  })
  await waitFor(() => expect(dashboardCalls).toBe(2))

  resolveInitialDashboard(Response.json(dashboard))
  await act(async () => {
    await initialDashboard
  })

  expect(await screen.findByText("Refreshed Book")).toBeVisible()
  expect(screen.queryByText("Current Book")).not.toBeInTheDocument()
})

test("supports library search and sortable headers on the dashboard", async () => {
  const user = userEvent.setup()
  render(<App />)
  const bookHeader = (await screen.findAllByRole("columnheader", { name: /Book/ }))[0]
  expect(bookHeader).toHaveAttribute("aria-sort", "none")
  expect(bookHeader.closest("tr")).not.toHaveClass("hover:bg-muted/50")
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
  expect(await screen.findByText(/1 book; 3,375 custom\/catalog rows ignored/)).toBeVisible()
  const row = await screen.findByRole("row", { name: /Current Book Ada Reader/ })
  expect(row).toHaveClass("hover:bg-muted/50")
  expect(row).toHaveAttribute("data-interactive", "true")
  expect(within(row).getByLabelText("Current Book cover")).toBeVisible()
  expect(screen.getByRole("combobox", { name: "Reading status" })).toBeVisible()
  expect(screen.getByRole("combobox", { name: "Availability" })).toBeVisible()
})

test("shows active filters and requests Kobo-backed highlight filters", async () => {
  const user = userEvent.setup()
  render(<App />)

  const highlights = await screen.findByRole("combobox", { name: "Highlights" })
  await user.click(highlights)
  await user.click(screen.getByRole("option", { name: "With highlights" }))

  expect(screen.getAllByText("With highlights").length).toBeGreaterThan(0)
  await waitFor(() => {
    const bookRequests = vi.mocked(fetch).mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/api/books"))
    expect(bookRequests.at(-1)).toContain("has_highlights=true")
  })

  await user.click(screen.getByRole("button", { name: "Clear With highlights" }))
  await waitFor(() => {
    const bookRequests = vi.mocked(fetch).mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/api/books"))
    expect(bookRequests.at(-1)).not.toContain("has_highlights")
  })

  await user.click(screen.getByRole("combobox", { name: "Source" }))
  await user.click(screen.getByRole("option", { name: "Sideloaded" }))
  await waitFor(() => {
    const bookRequests = vi.mocked(fetch).mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/api/books"))
    expect(bookRequests.at(-1)).toContain("source=sideloaded")
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

  await waitFor(() => {
    const selectedMonth = screen.getByRole("button", {
      name: "May 2026, 1 book completed",
    })
    expect(selectedMonth).toHaveAttribute("stroke", "var(--foreground)")
    expect(selectedMonth).toHaveAttribute("stroke-width", "2")
  })

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
  await user.click(within(row).getByRole("button", { name: "Open Current Book" }))
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByRole("heading", { name: "Current Book" })).toBeVisible()
  expect(within(dialog).getByText("Formatted introduction").tagName).toBe("STRONG")
  expect(within(dialog).getByText("emphasis").tagName).toBe("EM")
  expect(within(dialog).getByText("unsafe link")).not.toHaveAttribute("href")
  expect(within(dialog).queryByText("unsafe text")).not.toBeInTheDocument()
  expect(within(dialog).getByText("Highlighted text")).toBeVisible()
  expect(within(dialog).getByLabelText("Current Book cover")).toBeVisible()
  expect(within(dialog).queryByText("Summary")).not.toBeInTheDocument()
  expect(within(dialog).queryByText("Snapshot file")).not.toBeInTheDocument()
  expect(within(dialog).queryByText("Times opened")).not.toBeInTheDocument()
  expect(within(dialog).getByText("Estimated time remaining")).toBeVisible()
  expect(within(dialog).getByText("4h 19m")).toBeVisible()
  expect(within(dialog).getByText("1h 7m")).toBeVisible()
  expect(within(dialog).getByText("3h 11m")).toBeVisible()
  expect(within(dialog).getByText("Reading sessions")).toBeVisible()
  expect(
    within(dialog).getByRole("img", { name: "Estimated reading time by day" }),
  ).toBeVisible()
  expect(within(dialog).getByText("Dictionary lookups (1)")).toBeVisible()
  expect(within(dialog).getByText("perspicacious")).toBeVisible()
})

test("opens overview book cards with the keyboard", async () => {
  const user = userEvent.setup()
  render(<App />)

  const card = (await screen.findAllByRole("button", { name: /Open Current Book/ })).find(
    (element) => element.getAttribute("data-slot") === "card",
  )
  expect(card).toBeDefined()
  expect(card).toHaveAccessibleName(/Ada Reader.*42% complete.*1h 1m read/)

  card?.focus()
  await user.keyboard("{Enter}")

  expect(await screen.findByRole("dialog")).toBeVisible()
})

test("opens book details from the most-read section", async () => {
  const user = userEvent.setup()
  render(<App />)
  const book = await screen.findByText("Most Read Book")
  await user.click(book)
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByRole("heading", { name: "Most Read Book" })).toBeVisible()
  expect(within(dialog).getByText("Reading progress")).toBeVisible()
  expect(within(dialog).getByText("100%")).toBeVisible()
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
          filter_options: filterOptions,
          source_summary: dashboard.source_summary,
        })
      }
      if (url.includes("/api/book?")) {
        return Response.json(bookDetail({
          ...dashboard.continue_reading[0],
          status: "finished",
          remaining_seconds: 0,
          current_chapter_estimate_seconds: 0,
          rest_of_book_estimate_seconds: 0,
          bookmarks: [],
          dictionary_lookups: [],
        }))
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
          filter_options: filterOptions,
          source_summary: dashboard.source_summary,
        })
      }
      if (url.includes("/api/book?")) {
        return Response.json(bookDetail({
          ...dashboard.continue_reading[0],
          current_chapter_estimate_seconds: 0,
          rest_of_book_estimate_seconds: 11507,
          remaining_seconds: 11507,
          bookmarks: [],
          dictionary_lookups: [],
        }))
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

test("keeps showing the previous snapshot when an import is corrupted", async () => {
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
      if (url.includes("/api/import")) {
        return Response.json(
          { detail: "Imported database failed its integrity check" },
          { status: 409 },
        )
      }
      if (url.includes("/api/dashboard")) return Response.json(dashboard)
      if (url.includes("/api/books")) {
        return Response.json({
          items: dashboard.continue_reading,
          page: 1,
          page_size: 20,
          total: 1,
          pages: 1,
          filter_options: filterOptions,
          source_summary: dashboard.source_summary,
        })
      }
      throw new Error(`Unhandled request: ${url}`)
    }),
  )

  const user = userEvent.setup()
  render(<App />)
  await user.click(await screen.findByRole("button", { name: "Refresh from Kobo" }))

  expect(await screen.findByText("Using the previous snapshot")).toBeVisible()
  expect(screen.getByText(/failed its integrity check/)).toBeVisible()
  expect(screen.getByRole("heading", { name: "Reading overview" })).toBeVisible()
  expect(screen.getAllByText("Current Book")).toHaveLength(2)
  expect(screen.queryByText("Reading data is unavailable")).not.toBeInTheDocument()
})

test("does not claim fallback when the first import fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/device/status")) {
        return Response.json({
          connected: true,
          snapshot_available: false,
          imported_at: null,
          source: null,
        })
      }
      if (url.includes("/api/import")) {
        return Response.json(
          { detail: "Imported database failed its integrity check" },
          { status: 409 },
        )
      }
      throw new Error(`Unhandled request: ${url}`)
    }),
  )

  const user = userEvent.setup()
  render(<App />)
  await user.click(await screen.findByRole("button", { name: "Import from Kobo" }))

  const alert = await screen.findByRole("alert")
  expect(within(alert).getByText("Imported database failed its integrity check")).toBeVisible()
  expect(screen.queryByText(/using the previous snapshot/i)).not.toBeInTheDocument()
})

test("does not claim fallback when the import succeeds but reloading fails", async () => {
  let dashboardCalls = 0
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
      if (url.includes("/api/import")) {
        return Response.json({
          connected: true,
          snapshot_available: true,
          imported_at: "2026-06-18T13:00:00Z",
          source: "/Volumes/KOBOeReader/.kobo/KoboReader.sqlite",
        })
      }
      if (url.includes("/api/dashboard")) {
        dashboardCalls += 1
        if (dashboardCalls === 1) return Response.json(dashboard)
        return Response.json({ detail: "Unable to query imported database" }, { status: 500 })
      }
      if (url.includes("/api/books")) {
        return Response.json({
          items: dashboard.continue_reading,
          page: 1,
          page_size: 20,
          total: 1,
          pages: 1,
          filter_options: filterOptions,
          source_summary: dashboard.source_summary,
        })
      }
      throw new Error(`Unhandled request: ${url}`)
    }),
  )

  const user = userEvent.setup()
  render(<App />)
  await user.click(await screen.findByRole("button", { name: "Refresh from Kobo" }))

  expect(await screen.findByText("Reading data is unavailable")).toBeVisible()
  expect(
    screen.getByText(
      "Kobo snapshot imported, but reading data could not be loaded. Unable to query imported database",
    ),
  ).toBeVisible()
  expect(screen.queryByText("Using the previous snapshot")).not.toBeInTheDocument()
})
