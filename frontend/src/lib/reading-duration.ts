export type DurationGranularity = "day" | "week" | "month"

export interface DurationPoint {
  period: string
  seconds: number
}

export function prepareDailyDurationSeries(
  daily: Array<{ date: string; seconds: number }>,
): Array<{ date: string; timestamp: number; seconds: number }> {
  const totals = new Map<string, number>()
  for (const entry of daily) {
    totals.set(entry.date, (totals.get(entry.date) ?? 0) + entry.seconds)
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, seconds]) => {
      const [year, month, day] = date.split("-").map(Number)
      return {
        date,
        timestamp: Date.UTC(year, month - 1, day),
        seconds,
      }
    })
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day)
}

function dateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function addDays(value: Date, amount: number): Date {
  const next = new Date(value)
  next.setDate(next.getDate() + amount)
  return next
}

function startOfWeek(value: Date): Date {
  const start = new Date(value)
  const daysSinceMonday = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - daysSinceMonday)
  return start
}

function addMonths(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1)
}

function monthKey(value: Date): string {
  return dateKey(value).slice(0, 7)
}

export function aggregateDurationSeries(
  daily: Array<{ date: string; seconds: number }>,
  granularity: DurationGranularity,
): DurationPoint[] {
  if (daily.length === 0) return []

  const end = parseDateKey(daily[daily.length - 1].date)
  let periods: string[]
  let bucketForDate: (date: Date) => string

  if (granularity === "day") {
    const start = addDays(end, -29)
    periods = Array.from({ length: 30 }, (_, index) => dateKey(addDays(start, index)))
    bucketForDate = dateKey
  } else if (granularity === "week") {
    const endWeek = startOfWeek(end)
    const start = addDays(endWeek, -11 * 7)
    periods = Array.from({ length: 12 }, (_, index) => dateKey(addDays(start, index * 7)))
    bucketForDate = (date) => dateKey(startOfWeek(date))
  } else {
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1)
    const start = addMonths(endMonth, -11)
    periods = Array.from({ length: 12 }, (_, index) => monthKey(addMonths(start, index)))
    bucketForDate = monthKey
  }

  const totals = new Map(periods.map((period) => [period, 0]))
  for (const entry of daily) {
    const period = bucketForDate(parseDateKey(entry.date))
    if (totals.has(period)) totals.set(period, (totals.get(period) ?? 0) + entry.seconds)
  }
  return periods.map((period) => ({ period, seconds: totals.get(period) ?? 0 }))
}

export function formatDurationPeriod(
  period: string,
  granularity: DurationGranularity,
  long = false,
): string {
  const date = parseDateKey(granularity === "month" ? `${period}-01` : period)
  if (granularity === "month") {
    return new Intl.DateTimeFormat(undefined, {
      month: long ? "long" : "short",
      year: long ? "numeric" : undefined,
    }).format(date)
  }
  const formatted = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: long ? "numeric" : undefined,
  }).format(date)
  return granularity === "week" && long ? `Week of ${formatted}` : formatted
}
