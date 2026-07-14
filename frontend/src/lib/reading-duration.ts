export type DurationGranularity = "day" | "week" | "month"

export interface DurationPoint {
  period: string
  seconds: number
}

export interface DurationHeatmapCell {
  date: string
  seconds: number
  level: 0 | 1 | 2 | 3 | 4
}

export interface DurationHeatmap {
  cells: DurationHeatmapCell[]
  weeks: number
  monthLabels: Array<{ week: number; label: string }>
  startDate: string
  endDate: string
  maxSeconds: number
  totalDays: number
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

function heatmapLevel(seconds: number, maxSeconds: number): DurationHeatmapCell["level"] {
  if (seconds <= 0 || maxSeconds <= 0) return 0
  const ratio = seconds / maxSeconds
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

export function buildDurationHeatmap(
  daily: Array<{ date: string; seconds: number }>,
): DurationHeatmap | null {
  const series = prepareDailyDurationSeries(daily)
  if (series.length === 0) return null

  const end = parseDateKey(series[series.length - 1].date)
  const visibleStart = addDays(end, -364)
  const start = addDays(visibleStart, -visibleStart.getDay())
  const visibleDays = series.filter((entry) => {
    const date = parseDateKey(entry.date)
    return date >= visibleStart && date <= end
  })
  const maxSeconds = Math.max(0, ...visibleDays.map((entry) => entry.seconds))
  const dayMap = new Map(
    visibleDays.map((entry) => [
      entry.date,
      { ...entry, level: heatmapLevel(entry.seconds, maxSeconds) },
    ]),
  )
  const cells: DurationHeatmapCell[] = []
  const paddedEnd = addDays(end, 6 - end.getDay())

  for (let date = start; date <= paddedEnd; date = addDays(date, 1)) {
    const key = dateKey(date)
    const entry = dayMap.get(key)
    cells.push({
      date: key,
      seconds: entry?.seconds ?? 0,
      level: entry?.level ?? 0,
    })
  }

  const weeks = Math.ceil(cells.length / 7)
  const monthLabels: Array<{ week: number; label: string }> = []
  let lastMonth = ""
  for (let week = 0; week < weeks; week += 1) {
    const weekCells = cells.slice(week * 7, week * 7 + 7)
    const monthCell =
      week === 0
        ? weekCells[0]
        : weekCells.find((cell) => parseDateKey(cell.date).getDate() <= 7)
    if (!monthCell) continue
    const month = monthCell.date.slice(0, 7)
    if (month === lastMonth) continue
    lastMonth = month
    monthLabels.push({
      week,
      label: parseDateKey(monthCell.date).toLocaleDateString(undefined, {
        month: "short",
      }),
    })
  }

  return {
    cells,
    weeks,
    monthLabels,
    startDate: dateKey(start),
    endDate: dateKey(end),
    maxSeconds,
    totalDays: visibleDays.filter((entry) => entry.seconds > 0).length,
  }
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
