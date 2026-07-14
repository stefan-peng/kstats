import { expect, test } from "vitest"
import {
  aggregateDurationSeries,
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
