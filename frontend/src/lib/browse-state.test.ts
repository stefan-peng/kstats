import { expect, test } from "vitest"
import { parseBrowseState } from "./browse-state"

test("normalizes invalid bookmarked filters and pagination", () => {
  const state = parseBrowseState("?page=-3&status=invalid&month=2026-99&direction=no&sort=missing")
  expect(state).toMatchObject({ page: 1, status: "all", month: "", direction: "desc", sort: "last_read" })
  expect(parseBrowseState("?page=1.5").page).toBe(1)
  expect(parseBrowseState("?page=Infinity").page).toBe(1)
})

test("decodes book IDs and lets a completion month override reading status", () => {
  expect(parseBrowseState("?book=file%3A%2F%2F%2Fbook%20%26%20notes.epub&month=2026-05&status=reading&page=3")).toMatchObject({
    book: "file:///book & notes.epub", month: "2026-05", status: "all", page: 3,
  })
})
