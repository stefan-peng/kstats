import { useState } from "react"
import {
  BookCheck,
  BookOpenText,
  Clock3,
  Library,
  RefreshCw,
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
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  formatDate,
  formatDuration,
  formatMonth,
  formatMonthYear,
  formatNumber,
} from "@/lib/format"
import type { DashboardData, DeviceStatus } from "@/types"
import { LibrarySection } from "./library-page"

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

  if (loading) {
    return <OverviewSkeleton />
  }

  if (error || !dashboard) {
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
              ? `Snapshot from ${formatDate(device.imported_at)}`
              : "No snapshot imported"}
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
              <ResponsiveContainer width="100%" height="100%">
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
                <ResponsiveContainer width="100%" height="100%">
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
                className="cursor-pointer transition-colors hover:bg-accent/30"
                onClick={() => onOpenBook(book.content_id)}
              >
                <CardHeader>
                  <CardTitle className="line-clamp-2 font-serif text-xl">
                    {book.title}
                  </CardTitle>
                  <CardDescription>{book.author}</CardDescription>
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
                className="cursor-pointer transition-colors hover:bg-accent/30"
                onClick={() => onOpenBook(book.content_id)}
              >
                <CardHeader>
                  <CardTitle className="line-clamp-2 font-serif text-lg">
                    {book.title}
                  </CardTitle>
                  <CardDescription className="line-clamp-1">
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
