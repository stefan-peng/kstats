import { expect, test } from "vitest"
import { aggregateDurationSeries } from "./reading-duration"

const daily = [
  { date: "2026-06-16", seconds: 900 },
  { date: "2026-06-17", seconds: 900 },
]

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
