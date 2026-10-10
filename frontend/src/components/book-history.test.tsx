import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"
import { BookVocabulary, ProgressMilestones, ProgressPace } from "./book-history"

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
  render(<BookVocabulary words={[{ word: "Saved", dictionary: "-en", saved_at: null }]} activity={{
    reported_words: [{ word: "Looked up", dictionary: "-fr-en" }, { word: "Undated", dictionary: null }],
    recorded_at: ["2026-10-01T12:00:00Z", "2026-10-02T12:00:00Z"],
  }} />)
  expect(screen.getByText("Saved vocabulary (1)")).toBeVisible()
  expect(screen.getByText("Dictionary activity")).toBeVisible()
  expect(screen.getByText("2 distinct retained dictionary timestamps for this book, not per-word counts.")).toBeVisible()
  expect(screen.getByText(/Earlier timestamps may refer to different words/)).toBeVisible()
  expect(screen.getAllByRole("table")).toHaveLength(2)
})

test("reports observed pace variability without claiming confidence bounds", () => {
  render(<ProgressPace pace={{ seconds_per_percent: 150, sample_min: 120, sample_max: 180, sample_count: 2, latest_sample_at: "2026-10-10T12:00:00Z" }} />)
  expect(screen.getByText("Observed progress pace: 150s per percentage point.")).toBeVisible()
  expect(screen.getByText(/120–180s per percentage point. Not a confidence interval/)).toBeVisible()
  expect(screen.getByText(/Latest accepted session:/)).toBeVisible()
})

test("identifies single samples and missing interval dates", () => {
  render(<ProgressPace pace={{ seconds_per_percent: 120, sample_min: 120, sample_max: 120, sample_count: 1, latest_sample_at: null }} />)
  expect(screen.getByText("Only one usable sample; pace variability is unknown.")).toBeVisible()
  expect(screen.getByText("Sample dates are unavailable for retained import intervals.")).toBeVisible()
})

test("does not fabricate empty histories", () => {
  const { container } = render(<><ProgressMilestones milestones={[]} /><BookVocabulary words={[]} activity={{ reported_words: [], recorded_at: [] }} /></>)
  expect(container).toBeEmptyDOMElement()
})
