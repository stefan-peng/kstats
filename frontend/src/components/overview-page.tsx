import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react"
import {
  BookCheck,
  BookOpenText,
  Clock3,
  Library,
  RefreshCw,
  TriangleAlert,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMonth,
  formatMonthYear,
  formatNumber,
} from "@/lib/format"
import {
  aggregateDurationSeries,
  buildDurationHeatmap,
  formatDurationPeriod,
  type DurationHeatmap,
  type DurationGranularity,
} from "@/lib/reading-duration"
import { cn } from "@/lib/utils"
import type { DashboardData, DeviceStatus } from "@/types"
import { LibrarySection } from "./library-page"

type DurationOption = DurationGranularity | "heatmap"

const DURATION_OPTION_STORAGE_KEY = "kstats.reading-duration-option"

function readDurationOption(): DurationOption {
  if (typeof window === "undefined") return "week"
  try {
    const stored = window.localStorage?.getItem(DURATION_OPTION_STORAGE_KEY)
    return stored === "day" || stored === "week" || stored === "month" || stored === "heatmap"
      ? stored
      : "week"
  } catch {
    return "week"
  }
}

export function OverviewPage({
  dashboard,
  device,
  loading,
  refreshing,
  error,
  onRefresh,
  onOpenBook,
}: {
  dashboard: DashboardData | null
  device: DeviceStatus | null
  loading: boolean
  refreshing: boolean
  error: string | null
  onRefresh: () => void
  onOpenBook: (contentId: string) => void
}) {
  const [finishedMonth, setFinishedMonth] = useState<string | null>(null)
  const [durationOption, setDurationOption] = useState<DurationOption>(readDurationOption)
  const durationGranularity: DurationGranularity =
    durationOption === "heatmap" ? "week" : durationOption

  useEffect(() => {
    try {
      window.localStorage?.setItem(DURATION_OPTION_STORAGE_KEY, durationOption)
    } catch {
      // Storage is optional; the selected view still works for the current session.
    }
  }, [durationOption])
  const durationSeries = useMemo(
    () =>
      aggregateDurationSeries(
        dashboard?.reading_duration.daily ?? [],
        durationGranularity,
      ),
    [dashboard, durationGranularity],
  )
  const durationHeatmap = useMemo(
    () => buildDurationHeatmap(dashboard?.reading_duration.daily ?? []),
    [dashboard],
  )
  const activateBook = (
    contentId: string,
    event: KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    onOpenBook(contentId)
  }

  if (loading) {
    return <OverviewSkeleton />
  }

  if (!dashboard) {
    return (
      <main className="mx-auto max-w-7xl p-5 md:p-8">
        <Alert variant="destructive">
          <AlertTitle>Reading data is unavailable</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{error ?? "Connect your Kobo and import its database."}</span>
            <Button size="sm" onClick={onRefresh} disabled={!device?.connected}>
              <RefreshCw data-icon="inline-start" />
              Import from Kobo
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  const statusData = [
    { name: "Unread", value: dashboard.status_counts.unread, color: "var(--chart-4)" },
    { name: "In progress", value: dashboard.status_counts.reading, color: "var(--chart-1)" },
    { name: "Finished", value: dashboard.status_counts.finished, color: "var(--chart-2)" },
  ]

  const metrics = [
    {
      label: "Reading time",
      value: formatDuration(dashboard.totals.reading_seconds),
      icon: Clock3,
    },
    {
      label: "Finished",
      value: formatNumber(dashboard.totals.finished),
      icon: BookCheck,
    },
    {
      label: "In progress",
      value: formatNumber(dashboard.totals.reading),
      icon: BookOpenText,
    },
    {
      label: "Library",
      value: formatNumber(dashboard.totals.library),
      icon: Library,
    },
  ]

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-8 p-5 md:p-8 lg:p-10">
      {error && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Using the previous snapshot</AlertTitle>
          <AlertDescription>
            The latest Kobo import failed, so your existing reading data was kept. {error}
          </AlertDescription>
        </Alert>
      )}
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <h1 className="font-serif text-4xl font-semibold tracking-tight">
            Reading overview
          </h1>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Button onClick={onRefresh} disabled={refreshing || !device?.connected}>
            <RefreshCw
              data-icon="inline-start"
              className={refreshing ? "animate-spin" : undefined}
            />
            {refreshing ? "Refreshing…" : "Refresh from Kobo"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {device?.imported_at
              ? `Snapshot from ${formatDateTime(device.imported_at)}`
              : "No snapshot imported"}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatNumber(dashboard.totals.library)} books shown; {formatNumber(dashboard.source_summary.ignored_custom_catalog)} custom/catalog rows ignored
          </p>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardDescription>{metric.label}</CardDescription>
                <CardTitle className="mt-2 font-serif text-3xl">
                  {metric.value}
                </CardTitle>
              </div>
              <metric.icon className="size-5 text-primary" />
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.5fr]">
        <Card>
          <CardHeader>
            <CardTitle>Reading status</CardTitle>
          </CardHeader>
          <CardContent className="grid items-center gap-4 sm:grid-cols-[180px_1fr] xl:grid-cols-1 2xl:grid-cols-[180px_1fr]">
            <div className="h-44">
              <ResponsiveContainer
                width="100%"
                height="100%"
                initialDimension={{ width: 800, height: 176 }}
              >
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={74}
                    paddingAngle={3}
                    isAnimationActive={false}
                  >
                    {statusData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={entry.color}
                        stroke="var(--card)"
                      />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{
                      background: "var(--popover)",
                      borderColor: "var(--border)",
                      borderRadius: "var(--radius)",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col gap-3">
              {statusData.map((item) => (
                <div key={item.name} className="flex items-center justify-between gap-6">
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    {item.name}
                  </div>
                  <span className="font-medium">{formatNumber(item.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monthly completions</CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.monthly_completions.length === 0 ? (
              <div className="flex h-52 items-center justify-center text-sm text-muted-foreground">
                No completion timestamps are available.
              </div>
            ) : (
              <div className="h-52">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  initialDimension={{ width: 800, height: 208 }}
                >
                  <BarChart data={dashboard.monthly_completions}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="month"
                      tickFormatter={formatMonth}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                      width={24}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    />
                    <RechartsTooltip
                      labelFormatter={(value) => formatMonth(String(value))}
                      contentStyle={{
                        background: "var(--popover)",
                        borderColor: "var(--border)",
                        borderRadius: "var(--radius)",
                      }}
                    />
                    <Bar
                      dataKey="count"
                      fill="var(--chart-1)"
                      radius={[5, 5, 0, 0]}
                      maxBarSize={24}
                      isAnimationActive={false}
                    >
                      {dashboard.monthly_completions.map((entry) => (
                        <Cell
                          key={entry.month}
                          role="button"
                          tabIndex={0}
                          aria-label={`${formatMonthYear(entry.month)}, ${formatNumber(entry.count)} ${entry.count === 1 ? "book" : "books"} completed`}
                          aria-pressed={finishedMonth === entry.month}
                          className="cursor-pointer outline-none focus-visible:stroke-ring focus-visible:stroke-2"
                          fill={
                            finishedMonth === entry.month
                              ? "var(--primary)"
                              : "var(--chart-1)"
                          }
                          stroke={
                            finishedMonth === entry.month
                              ? "var(--foreground)"
                              : "transparent"
                          }
                          strokeWidth={finishedMonth === entry.month ? 2 : 0}
                          onClick={() => setFinishedMonth(entry.month)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              setFinishedMonth(entry.month)
                            }
                          }}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Reading duration</CardTitle>
            <CardDescription className="mt-1">
              {dashboard.reading_duration.coverage_start &&
              dashboard.reading_duration.coverage_end
                ? `Estimated from Kobo session telemetry · ${formatDurationPeriod(dashboard.reading_duration.coverage_start, "day", true)}–${formatDurationPeriod(dashboard.reading_duration.coverage_end, "day", true)}`
                : "Estimated from Kobo session telemetry"}
            </CardDescription>
          </div>
          <CardAction className="flex flex-wrap justify-end gap-2 max-sm:col-span-full max-sm:col-start-1 max-sm:row-start-3">
            <div
              role="group"
              aria-label="Reading duration view"
              className="flex gap-1"
            >
              {(
                [
                  ["day", "Daily"],
                  ["week", "Weekly"],
                  ["month", "Monthly"],
                  ["heatmap", "Heatmap"],
                ] as const
              ).map(([option, label]) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={durationOption === option ? "default" : "outline"}
                  aria-pressed={durationOption === option}
                  onClick={() => setDurationOption(option)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {durationSeries.length === 0 || !durationHeatmap ? (
            <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
              No detailed reading telemetry is available.
            </div>
          ) : durationOption === "heatmap" ? (
            <DurationHeatmapView heatmap={durationHeatmap} />
          ) : (
            <div
              className="h-64"
              role="img"
              aria-label={`Estimated reading duration by ${durationGranularity}`}
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                initialDimension={{ width: 800, height: 256 }}
              >
                <BarChart data={durationSeries}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="period"
                    tickFormatter={(value) =>
                      formatDurationPeriod(String(value), durationGranularity)
                    }
                    axisLine={false}
                    tickLine={false}
                    minTickGap={16}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={52}
                    tickFormatter={(value) => formatDuration(Number(value))}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  />
                  <RechartsTooltip
                    labelFormatter={(value) =>
                      formatDurationPeriod(
                        String(value),
                        durationGranularity,
                        true,
                      )
                    }
                    formatter={(value) => [
                      formatDuration(Number(value)),
                      "Reading time",
                    ]}
                    contentStyle={{
                      background: "var(--popover)",
                      borderColor: "var(--border)",
                      borderRadius: "var(--radius)",
                    }}
                  />
                  <Bar
                    dataKey="seconds"
                    fill="var(--chart-2)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {dashboard.reading_duration.unallocated_seconds > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {formatDuration(dashboard.reading_duration.unallocated_seconds)} could
              not be assigned to a calendar date.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="font-serif text-2xl font-semibold">Continue reading</h2>
        {dashboard.continue_reading.length === 0 ? (
          <p className="rounded-lg border p-6 text-sm text-muted-foreground">
            No books are currently marked as in progress.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {dashboard.continue_reading.slice(0, 3).map((book) => (
              <Card
                key={book.content_id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${book.title} by ${book.author}, ${book.percent_read}% complete, ${formatDuration(book.reading_seconds)} read`}
                className="cursor-pointer transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => onOpenBook(book.content_id)}
                onKeyDown={(event) => activateBook(book.content_id, event)}
              >
                <CardHeader>
                  <CardTitle className="min-h-[3.5rem] line-clamp-2 font-serif text-xl">
                    {book.title}
                  </CardTitle>
                  <CardDescription className="min-h-5 line-clamp-1">
                    {book.author}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Progress value={book.percent_read} />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{book.percent_read}% complete</span>
                    <span>{formatDuration(book.reading_seconds)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-serif text-2xl font-semibold">Most read</h2>
        {dashboard.top_books.length === 0 ? (
          <p className="rounded-lg border p-6 text-sm text-muted-foreground">
            No reading time has been tracked yet.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {dashboard.top_books.map((book) => (
              <Card
                key={book.content_id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${book.title} by ${book.author}, ${formatDuration(book.reading_seconds)} read, ${book.percent_read}% complete`}
                className="cursor-pointer transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => onOpenBook(book.content_id)}
                onKeyDown={(event) => activateBook(book.content_id, event)}
              >
                <CardHeader>
                  <CardTitle className="min-h-[3.125rem] line-clamp-2 font-serif text-lg">
                    {book.title}
                  </CardTitle>
                  <CardDescription className="min-h-5 line-clamp-1">
                    {book.author}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Reading time</span>
                    <span className="font-medium">
                      {formatDuration(book.reading_seconds)}
                    </span>
                  </div>
                  <Progress value={book.percent_read} />
                  <div className="text-xs text-muted-foreground">
                    {book.percent_read}% complete
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Separator />

      <LibrarySection
        onOpenBook={onOpenBook}
        snapshotVersion={device?.imported_at}
        finishedMonth={finishedMonth}
        onClearFinishedMonth={() => setFinishedMonth(null)}
      />
    </main>
  )
}

function DurationHeatmapView({ heatmap }: { heatmap: DurationHeatmap }) {
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
  const dateRange = `${formatDurationPeriod(heatmap.startDate, "day", true)}–${formatDurationPeriod(heatmap.endDate, "day", true)}`

  return (
    <div
      className="flex flex-col gap-3"
      role="region"
      aria-label="Estimated reading duration as a calendar heatmap"
    >
      <div className="duration-heatmap-scroll" tabIndex={0} aria-label="Scrollable reading duration heatmap">
        <div
          className="duration-heatmap"
          style={{ "--duration-heatmap-weeks": heatmap.weeks } as CSSProperties}
        >
          <div className="duration-heatmap-months" aria-hidden="true">
            {heatmap.monthLabels.map((month, index) => {
              const nextWeek = heatmap.monthLabels[index + 1]?.week ?? heatmap.weeks
              const span = Math.max(1, Math.min(4, nextWeek - month.week))
              return (
                <span
                  key={`${month.week}-${month.label}`}
                  style={{ gridColumn: `${month.week + 1} / span ${span}` }}
                >
                  {month.label}
                </span>
              )
            })}
          </div>
          <div className="duration-heatmap-body">
            <div className="duration-heatmap-weekdays" aria-hidden="true">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <span key={day}>{["Mon", "Wed", "Fri"].includes(day) ? day : ""}</span>
              ))}
            </div>
            <div className="duration-heatmap-days" role="grid" aria-label="Reading duration by day">
              {heatmap.cells.map((cell) => {
                const date = dateFormatter.format(new Date(`${cell.date}T00:00:00`))
                const label = cell.seconds
                  ? `${date}: ${formatDuration(cell.seconds)} read, intensity ${cell.level} of 4`
                  : `${date}: no reading`
                return (
                  <Tooltip key={cell.date}>
                    <TooltipTrigger asChild>
                      {cell.seconds ? (
                        <button
                          type="button"
                          role="gridcell"
                          aria-label={label}
                          className={cn(
                            "duration-heatmap-cell",
                            `level-${cell.level}`,
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          )}
                        />
                      ) : (
                        <span
                          role="gridcell"
                          aria-label={label}
                          tabIndex={-1}
                          className="duration-heatmap-cell level-0"
                        />
                      )}
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="grid gap-1">
                        <span>{date}</span>
                        <strong>{cell.seconds ? `${formatDuration(cell.seconds)} read` : "No reading"}</strong>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </div>
          <div className="duration-heatmap-footer">
            <span>{heatmap.totalDays} reading {heatmap.totalDays === 1 ? "day" : "days"}</span>
            <span aria-label="Reading duration intensity legend" className="duration-heatmap-legend">
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <i key={level} className={cn("duration-heatmap-cell", `level-${level}`)} />
              ))}
              <span>More</span>
            </span>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{dateRange}</p>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-8 p-5 md:p-8 lg:p-10">
      <div className="flex justify-between">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-36" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </main>
  )
}
