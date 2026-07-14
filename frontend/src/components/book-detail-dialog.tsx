import { useEffect, useMemo, useState } from "react"
import {
  CalendarDays,
  Clock3,
  Highlighter,
  Languages,
  Timer,
} from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import {
  formatDate,
  formatDuration,
  formatNumber,
} from "@/lib/format"
import { prepareDailyDurationSeries } from "@/lib/reading-duration"
import type { BookDetail } from "@/types"
import { BookCover } from "./book-cover"
import { FormattedText } from "./formatted-text"
import { StatusBadge } from "./status-badge"

const readingChartConfig = {
  seconds: {
    label: "Reading time",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

function formatChartDate(value: number, long = false) {
  if (!Number.isFinite(value)) return "Unknown date"
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: long ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(value))
}

export function BookDetailDialog({
  contentId,
  onOpenChange,
}: {
  contentId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const [bookResult, setBookResult] = useState<{
    contentId: string
    book: BookDetail
  } | null>(null)
  const [errorResult, setErrorResult] = useState<{
    contentId: string
    message: string
  } | null>(null)
  const book = bookResult?.contentId === contentId ? bookResult.book : null
  const error = errorResult?.contentId === contentId ? errorResult.message : null
  const readingDurationSeries = useMemo(
    () => prepareDailyDurationSeries(book?.reading_duration.daily ?? []),
    [book],
  )

  useEffect(() => {
    if (!contentId) {
      setBookResult(null)
      setErrorResult(null)
      return
    }
    let active = true
    setBookResult(null)
    setErrorResult(null)
    api
      .book(contentId)
      .then((data) => {
        if (!active) return
        setBookResult({ contentId, book: data })
        setErrorResult(null)
      })
      .catch((reason: Error) => {
        if (!active) return
        setBookResult(null)
        setErrorResult({ contentId, message: reason.message })
      })
    return () => {
      active = false
    }
  }, [contentId])

  return (
    <Dialog open={Boolean(contentId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to load book</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : !book ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="grid gap-5 sm:grid-cols-[112px_1fr]">
                <BookCover
                  title={book.title}
                  coverUrl={book.cover_url}
                  className="w-28"
                />
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={book.status} />
                    <Badge variant="outline">{sourceLabel(book.source_type)}</Badge>
                    {book.downloaded && <Badge variant="outline">Downloaded</Badge>}
                    {book.bookmark_count > 0 && (
                      <Badge variant="secondary">
                        {formatNumber(book.bookmark_count)} highlights
                      </Badge>
                    )}
                  </div>
                  <DialogTitle className="font-serif text-3xl">
                    {book.title}
                  </DialogTitle>
                  <DialogDescription>{book.author}</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Reading progress</span>
                  <span className="font-medium">{book.percent_read}%</span>
                </div>
                <Progress value={book.percent_read} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-start gap-3 rounded-lg border p-3">
                  <Clock3 className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Reading time</p>
                    <p className="font-medium">{formatDuration(book.reading_seconds)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border p-3">
                  <CalendarDays className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Last read</p>
                    <p className="font-medium">{formatDate(book.date_last_read)}</p>
                  </div>
                </div>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Reading sessions</CardTitle>
                  <CardDescription>
                    Estimated daily distribution from Kobo session telemetry
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {readingDurationSeries.length === 0 ? (
                    <p className="flex h-44 items-center justify-center text-sm text-muted-foreground">
                      No detailed reading telemetry is available for this book.
                    </p>
                  ) : (
                    <ChartContainer
                      config={readingChartConfig}
                      className="h-52 min-h-0 w-full min-w-0 aspect-auto"
                      role="img"
                      aria-label="Estimated reading time by day"
                    >
                      <BarChart
                        accessibilityLayer
                        data={readingDurationSeries}
                        margin={{ left: 8, right: 8 }}
                      >
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="timestamp"
                          type="number"
                          scale="time"
                          domain={[
                            (minimum: number) => minimum - DAY_MILLISECONDS / 2,
                            (maximum: number) => maximum + DAY_MILLISECONDS / 2,
                          ]}
                          tickLine={false}
                          axisLine={false}
                          minTickGap={16}
                          tickFormatter={(value) => formatChartDate(Number(value))}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          width={52}
                          tickFormatter={(value) =>
                            Number(value) === 0 ? "" : formatDuration(Number(value))
                          }
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(_value, payload) =>
                                formatChartDate(
                                  Number(payload[0]?.payload?.timestamp),
                                  true,
                                )
                              }
                              formatter={(value) => (
                                <div className="flex min-w-32 items-center justify-between gap-4">
                                  <span className="text-muted-foreground">
                                    Reading time
                                  </span>
                                  <span className="font-mono font-medium tabular-nums">
                                    {formatDuration(Number(value))}
                                  </span>
                                </div>
                              )}
                            />
                          }
                        />
                        <Bar
                          dataKey="seconds"
                          fill="var(--color-seconds)"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={28}
                          isAnimationActive={false}
                        />
                      </BarChart>
                    </ChartContainer>
                  )}
                  {book.reading_duration.unallocated_seconds > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatDuration(book.reading_duration.unallocated_seconds)} could
                      not be assigned to a calendar date.
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              {book.status === "reading" && book.remaining_seconds > 0 ? (
                <Card>
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <Timer className="mt-0.5 size-5 text-primary" />
                      <div>
                        <CardDescription>Estimated time remaining</CardDescription>
                        <CardTitle className="mt-1 font-serif text-2xl">
                          {formatDuration(book.remaining_seconds)}
                        </CardTitle>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-muted-foreground">Current chapter</p>
                      <p className="font-medium">
                        {book.current_chapter_estimate_seconds > 0
                          ? formatDuration(book.current_chapter_estimate_seconds)
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">After this chapter</p>
                      <p className="font-medium">
                        {book.rest_of_book_estimate_seconds > 0
                          ? formatDuration(book.rest_of_book_estimate_seconds)
                          : "—"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {(book.series || book.publisher || book.word_count || book.language || book.isbn) && (
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  {book.series && (
                    <div>
                      <p className="text-muted-foreground">Series</p>
                      <p>
                        {book.series}
                        {book.series_number ? ` · ${book.series_number}` : ""}
                      </p>
                    </div>
                  )}
                  {book.publisher && (
                    <div>
                      <p className="text-muted-foreground">Publisher</p>
                      <p>{book.publisher}</p>
                    </div>
                  )}
                  {book.language && (
                    <div>
                      <p className="text-muted-foreground">Language</p>
                      <p>{book.language}</p>
                    </div>
                  )}
                  {book.isbn && (
                    <div>
                      <p className="text-muted-foreground">ISBN</p>
                      <p>{book.isbn}</p>
                    </div>
                  )}
                  {book.word_count && (
                    <div>
                      <p className="text-muted-foreground">Word count</p>
                      <p>{formatNumber(book.word_count)}</p>
                    </div>
                  )}
                </div>
              )}

              {book.description && (
                <>
                  <Separator />
                  <FormattedText>{book.description}</FormattedText>
                </>
              )}

              {book.dictionary_lookups.length > 0 && (
                <>
                  <Separator />
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Languages className="size-4 text-primary" />
                      <h3 className="font-medium">
                        Dictionary lookups ({book.dictionary_lookups.length})
                      </h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {book.dictionary_lookups.map((lookup) => (
                        <Badge
                          key={`${lookup.word}-${lookup.dictionary ?? ""}`}
                          variant="secondary"
                          className="gap-1.5"
                        >
                          {lookup.word}
                          {lookup.dictionary && (
                            <span className="text-muted-foreground">
                              {lookup.dictionary}
                            </span>
                          )}
                        </Badge>
                      ))}
                    </div>
                  </section>
                </>
              )}

              <Separator />
              <section className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Highlighter className="size-4 text-primary" />
                  <h3 className="font-medium">
                    Highlights and notes ({book.bookmarks.length})
                  </h3>
                </div>
                {book.bookmarks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No highlights or notes are stored for this book.
                  </p>
                ) : (
                  book.bookmarks.map((bookmark) => (
                    <blockquote
                      key={bookmark.id}
                      className="flex flex-col gap-2 border-l-2 border-primary pl-4"
                    >
                      {bookmark.text && <p className="text-sm">{bookmark.text}</p>}
                      {bookmark.annotation && (
                        <p className="text-sm italic text-muted-foreground">
                          {bookmark.annotation}
                        </p>
                      )}
                      <footer className="text-xs text-muted-foreground">
                        {formatDate(bookmark.created_at)}
                      </footer>
                    </blockquote>
                  ))
                )}
              </section>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function sourceLabel(source: BookDetail["source_type"]) {
  return source === "sideloaded" ? "Sideloaded" : "Kobo store"
}
