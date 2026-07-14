import { expect, test } from "vitest"
import {
  aggregateDurationSeries,
  buildDurationHeatmap,
  prepareDailyDurationSeries,
} from "./reading-duration"

const daily = [
  { date: "2026-06-16", seconds: 900 },
  { date: "2026-06-17", seconds: 900 },
]

test("preserves elapsed date spacing without materializing missing days", () => {
  const result = prepareDailyDurationSeries([
      { date: "2026-06-16", seconds: 900 },
      { date: "2026-06-19", seconds: 600 },
    ])

  expect(result).toHaveLength(2)
  expect(result.map(({ date, seconds }) => ({ date, seconds }))).toEqual([
    { date: "2026-06-16", seconds: 900 },
    { date: "2026-06-19", seconds: 600 },
  ])
  expect(result[1].timestamp - result[0].timestamp).toBe(3 * 24 * 60 * 60 * 1000)
})

test("zero-fills the last 30 daily buckets", () => {
  const result = aggregateDurationSeries(daily, "day")

  expect(result).toHaveLength(30)
  expect(result.slice(-2)).toEqual([
    { period: "2026-06-16", seconds: 900 },
    { period: "2026-06-17", seconds: 900 },
  ])
})

test("aggregates daily duration into Monday-based weeks", () => {
  const result = aggregateDurationSeries(daily, "week")

  expect(result).toHaveLength(12)
  expect(result.at(-1)).toEqual({ period: "2026-06-15", seconds: 1800 })
})

test("aggregates daily duration into calendar months", () => {
  const result = aggregateDurationSeries(daily, "month")

  expect(result).toHaveLength(12)
  expect(result.at(-1)).toEqual({ period: "2026-06", seconds: 1800 })
})

test("builds a trailing calendar heatmap with intensity levels", () => {
  const result = buildDurationHeatmap([
    { date: "2026-06-15", seconds: 600 },
    { date: "2026-06-17", seconds: 1200 },
    { date: "2026-06-17", seconds: 600 },
  ])

  expect(result).not.toBeNull()
  expect(result?.endDate).toBe("2026-06-17")
  expect(result?.totalDays).toBe(2)
  expect(result?.cells.find(({ date }) => date === "2026-06-15")).toEqual({
    date: "2026-06-15",
    seconds: 600,
    level: 2,
  })
  expect(result?.cells.find(({ date }) => date === "2026-06-17")).toEqual({
    date: "2026-06-17",
    seconds: 1800,
    level: 4,
  })
})

test("pads the trailing heatmap range across a leap day", () => {
  const result = buildDurationHeatmap([
    { date: "2024-03-01", seconds: 100 },
    { date: "2023-03-03", seconds: 25 },
  ])

  expect(result).not.toBeNull()
  expect(result?.startDate).toBe("2023-02-26")
  expect(result?.endDate).toBe("2024-03-01")
  expect(result?.cells).toHaveLength(371)
  expect(result?.cells[0].date).toBe("2023-02-26")
  expect(result?.cells.at(-1)?.date).toBe("2024-03-02")
  expect(result?.cells.find(({ date }) => date === "2024-02-29")).toEqual({
    date: "2024-02-29",
    seconds: 0,
    level: 0,
  })
})
