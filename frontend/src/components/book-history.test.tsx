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
  expect(screen.getByText("Progress milestones")).toBeVisible()
})

test("distinguishes saved vocabulary from retained lookup interactions", () => {
  render(<BookVocabulary words={[{ word: "Saved", dictionary: "-en", saved_at: null }]} activity={{
    reported_words: [{ word: "Looked up", dictionary: "-fr-en" }, { word: "Undated", dictionary: null }],
    recorded_at: ["2026-10-01T12:00:00Z", "2026-10-02T12:00:00Z"],
  }} />)
  expect(screen.getByText("Saved vocabulary (1)")).toBeVisible()
  expect(screen.getByText("Dictionary activity")).toBeVisible()
  expect(screen.getByText("2 distinct timestamps")).toBeVisible()
  expect(screen.getByText("Timestamps are book-level, not per word.")).toBeVisible()
  expect(screen.getAllByRole("table")).toHaveLength(2)
})

test("reports observed pace variability without claiming confidence bounds", () => {
  render(<ProgressPace pace={{ seconds_per_percent: 150, sample_min: 120, sample_max: 180, sample_count: 2, latest_sample_at: "2026-10-10T12:00:00Z" }} />)
  expect(screen.getByText("Observed pace: 150s per 1% progress.")).toBeVisible()
  expect(screen.getByText("Sample range: 120–180s per 1% progress.")).toBeVisible()
  expect(screen.getByText(/Last sample:/)).toBeVisible()
})

test("omits a range for single samples and does not invent missing dates", () => {
  render(<ProgressPace pace={{ seconds_per_percent: 120, sample_min: 120, sample_max: 120, sample_count: 1, latest_sample_at: null }} />)
  expect(screen.getByText("Observed pace: 120s per 1% progress.")).toBeVisible()
  expect(screen.queryByText(/Sample range:/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Last sample:/)).not.toBeInTheDocument()
})

test("does not fabricate empty histories", () => {
  const { container } = render(<><ProgressMilestones milestones={[]} /><BookVocabulary words={[]} activity={{ reported_words: [], recorded_at: [] }} /></>)
  expect(container).toBeEmptyDOMElement()
})
