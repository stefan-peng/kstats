import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test } from "vitest"
import { ReadingInsights } from "./reading-insights"
import type { LibraryInsights } from "@/types"

afterEach(cleanup)

const row = { label: "Ada Reader", books: 2, seconds: 7200, unread_seconds: 0, reading_seconds: 3600, finished_seconds: 3600 }
const insights: LibraryInsights = {
  quality: { dated_finished: 38, undated_finished: 10, active_without_recorded_time: 14, event_time_books: 1, books_with_word_count: 12 },
  composition: { author: [row], source: [{ ...row, label: "Kobo store" }], format: [], language: [] },
}

test("exposes provenance and changes time grouping with accessible tabular values", async () => {
  const user = userEvent.setup()
  render(<ReadingInsights insights={insights} telemetryScope={{ library_seconds: 1800, unmatched_seconds: 3600 }} />)
  expect(screen.getByText("38 dated · 10 missing or unusable")).toBeVisible()
  expect(screen.getByText(/1 books · retained coverage/)).toBeVisible()
  const table = screen.getByRole("table")
  expect(within(table).getByText("Ada Reader")).toBeVisible()
  expect(within(table).getByText("2h")).toBeVisible()
  await user.click(screen.getByRole("combobox", { name: "Group reading time by" }))
  await user.click(screen.getByRole("option", { name: "Source" }))
  expect(within(table).getByText("Kobo store")).toBeVisible()
  expect(within(table).queryByText("Ada Reader")).not.toBeInTheDocument()
})

test("handles an empty library without fabricating reading time", () => {
  render(<ReadingInsights insights={{ ...insights, composition: { author: [], source: [], format: [], language: [] } }} telemetryScope={{ library_seconds: 0, unmatched_seconds: 0 }} />)
  expect(screen.getByText("No positive recorded reading time.")).toBeVisible()
})
