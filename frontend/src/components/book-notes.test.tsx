import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test, vi } from "vitest"
import { BookNotes } from "./book-notes"

const book = {
  title: "Book", author: "Author", bookmarks: [
    { id: "one", text: "First passage", annotation: "A thoughtful note", type: "highlight", created_at: "2026-09-15T12:00:00Z", chapter_progress: 0.3, color: 1 },
    { id: "two", text: "Second passage", annotation: null, type: "highlight", created_at: "2026-10-15T12:00:00Z", chapter_progress: 0.6, color: 2 },
    { id: "three", text: "Undated passage", annotation: null, type: "highlight", created_at: null, chapter_progress: 0, color: 1 },
  ],
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

test("searches annotations and combines color and month filters", async () => {
  const user = userEvent.setup()
  render(<BookNotes book={book} />)
  expect(screen.queryByText("3 of 3 shown")).not.toBeInTheDocument()
  await user.type(screen.getByRole("textbox", { name: "Search highlights and notes" }), "THOUGHTFUL")
  expect(screen.getByText("First passage")).toBeVisible()
  expect(screen.queryByText("Second passage")).not.toBeInTheDocument()
  expect(screen.getByText("1 of 3 shown")).toBeVisible()
  await user.click(screen.getByRole("button", { name: "Clear note filters" }))
  expect(screen.queryByText("3 of 3 shown")).not.toBeInTheDocument()
  expect(screen.getByText("Second passage")).toBeVisible()
  await user.click(screen.getByRole("combobox", { name: "Highlight color" }))
  await user.click(screen.getByRole("option", { name: "Color 1" }))
  expect(screen.getByText("2 of 3 shown")).toBeVisible()
  await user.click(screen.getByRole("combobox", { name: "Created month" }))
  await user.click(screen.getByRole("option", { name: "Undated" }))
  expect(screen.getByText("Undated passage")).toBeVisible()
  expect(screen.queryByText("First passage")).not.toBeInTheDocument()
  expect(screen.getByText("1 of 3 shown")).toBeVisible()
})

test("exports all notes even when the displayed result is filtered", async () => {
  const user = userEvent.setup()
  const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
  render(<BookNotes book={book} />)
  await user.type(screen.getByRole("textbox", { name: "Search highlights and notes" }), "no match")
  expect(screen.getByText("No highlights or notes match these filters.")).toBeVisible()
  await user.click(screen.getByRole("button", { name: "Copy all" }))
  expect(clipboard).toHaveBeenCalledWith(expect.stringContaining("First passage"))
  expect(clipboard).toHaveBeenCalledWith(expect.stringContaining("Second passage"))
  expect(screen.getByRole("button", { name: "Download all" })).toBeVisible()
})

test("keeps missing highlights distinct from an empty filtered result", () => {
  render(<BookNotes book={{ ...book, bookmarks: [] }} />)
  expect(screen.getByText("No highlights or notes are stored for this book.")).toBeVisible()
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
})
