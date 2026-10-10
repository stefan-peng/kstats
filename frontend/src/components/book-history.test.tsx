import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"
import { BookVocabulary, ProgressMilestones } from "./book-history"

afterEach(cleanup)

test("shows repeated milestones as observations without inventing continuous progress", () => {
  render(<ProgressMilestones milestones={[
    { percent: 25, recorded_at: "2026-10-01T12:00:00Z" },
    { percent: 50, recorded_at: "2026-10-02T12:00:00Z" },
    { percent: 25, recorded_at: "2026-10-03T12:00:00Z" },
  ]} />)
  const timeline = screen.getByRole("list", { name: "Progress milestone timeline" })
  expect(within(timeline).getAllByRole("listitem")).toHaveLength(3)
  expect(within(timeline).getAllByText("25%")).toHaveLength(2)
  expect(screen.getByText(/gaps are not active reading time/)).toBeVisible()
})

test("distinguishes saved vocabulary from retained lookup interactions", () => {
  render(<BookVocabulary words={[{ word: "Saved", dictionary: "-en", saved_at: null }]} lookups={[
    { word: "Looked up", dictionary: "-fr-en", recorded_at: ["2026-10-01T12:00:00Z", "2026-10-02T12:00:00Z"] },
    { word: "Undated", dictionary: null, recorded_at: [] },
  ]} />)
  expect(screen.getByText("Saved vocabulary (1)")).toBeVisible()
  expect(screen.getByText("Dictionary lookups (2)")).toBeVisible()
  expect(screen.getByText("No retained timestamps")).toBeVisible()
  expect(screen.getByText(/not a complete lookup history/)).toBeVisible()
  expect(screen.getAllByRole("table")).toHaveLength(2)
})

test("does not fabricate empty histories", () => {
  const { container } = render(<><ProgressMilestones milestones={[]} /><BookVocabulary words={[]} lookups={[]} /></>)
  expect(container).toBeEmptyDOMElement()
})
