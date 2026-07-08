import { useEffect, useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  X,
  Search,
} from "lucide-react"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { api } from "@/lib/api"
import {
  formatDate,
  formatDuration,
  formatMonthYear,
  formatNumber,
} from "@/lib/format"
import type { Book, BooksResponse } from "@/types"
import { StatusBadge } from "./status-badge"
import { BookCover } from "./book-cover"

const helper = createColumnHelper<Book>()

export function LibrarySection({
  onOpenBook,
  snapshotVersion,
  finishedMonth,
  onClearFinishedMonth,
}: {
  onOpenBook: (contentId: string) => void
  snapshotVersion: string | null | undefined
  finishedMonth: string | null
  onClearFinishedMonth: () => void
}) {
  const [data, setData] = useState<BooksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [status, setStatus] = useState("all")
  const [availability, setAvailability] = useState("all")
  const [highlightFilter, setHighlightFilter] = useState("all")
  const [series, setSeries] = useState("all")
  const [publisher, setPublisher] = useState("all")
  const [language, setLanguage] = useState("all")
  const [page, setPage] = useState(1)
  const [sorting, setSorting] = useState<SortingState>([
    { id: "last_read", desc: true },
  ])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [search])

  useEffect(() => {
    setPage(1)
    if (finishedMonth) setStatus("all")
  }, [finishedMonth])

  useEffect(() => {
    const query = new URLSearchParams({
      page: String(page),
      page_size: "20",
      status: finishedMonth ? "all" : status,
      sort: sorting[0]?.id ?? "last_read",
      direction: sorting[0]?.desc ? "desc" : "asc",
    })
    if (debouncedSearch) query.set("search", debouncedSearch)
    if (availability !== "all") {
      query.set("downloaded", availability === "downloaded" ? "true" : "false")
    }
    if (highlightFilter !== "all") {
      query.set("has_highlights", highlightFilter === "with" ? "true" : "false")
    }
    if (finishedMonth) query.set("finished_month", finishedMonth)
    if (series !== "all") query.set("series", series)
    if (publisher !== "all") query.set("publisher", publisher)
    if (language !== "all") query.set("language", language)
    let active = true
    setLoading(true)
    setError(null)
    api
      .books(query)
      .then((response) => active && setData(response))
      .catch((reason: Error) => active && setError(reason.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [
    availability,
    debouncedSearch,
    finishedMonth,
    highlightFilter,
    language,
    page,
    publisher,
    snapshotVersion,
    sorting,
    status,
    series,
  ])

  const columns = useMemo(
    () => [
      helper.accessor("title", {
        id: "title",
        header: "Book",
        cell: ({ row }) => (
          <div className="flex min-w-72 items-center gap-3">
            <BookCover
              title={row.original.title}
              coverUrl={row.original.cover_url}
              className="w-10"
            />
            <div className="min-w-0">
              <p className="max-w-80 truncate font-medium">{row.original.title}</p>
              <p className="max-w-80 truncate text-xs text-muted-foreground">
                {row.original.author}
              </p>
              <p className="max-w-80 truncate text-xs text-muted-foreground">
                {[row.original.series, row.original.publisher].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
        ),
      }),
      helper.accessor("status", {
        id: "status",
        header: "Status",
        cell: ({ getValue }) => <StatusBadge status={getValue()} />,
      }),
      helper.accessor("percent_read", {
        id: "progress",
        header: "Progress",
        cell: ({ getValue }) => (
          <div className="flex min-w-28 items-center gap-3">
            <Progress value={getValue()} className="h-1.5" />
            <span className="w-9 text-right text-xs">{getValue()}%</span>
          </div>
        ),
      }),
      helper.accessor("reading_seconds", {
        id: "reading_time",
        header: "Reading time",
        cell: ({ getValue }) => formatDuration(getValue()),
      }),
      helper.accessor("remaining_seconds", {
        id: "remaining_time",
        header: "Time remaining",
        cell: ({ getValue, row }) =>
          row.original.status === "reading" && getValue() > 0
            ? formatDuration(getValue())
            : "—",
      }),
      helper.accessor("date_last_read", {
        id: "last_read",
        header: "Last read",
        cell: ({ getValue }) => formatDate(getValue()),
      }),
      helper.accessor("bookmark_count", {
        id: "highlights",
        header: "Highlights",
        cell: ({ getValue }) => (
          <div className="flex items-center gap-2">
            <Highlighter className="size-4 text-muted-foreground" />
            <span>{formatNumber(getValue())}</span>
          </div>
        ),
      }),
    ],
    [],
  )

  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      setSorting((current) =>
        typeof updater === "function" ? updater(current) : updater,
      )
      setPage(1)
    },
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  })

  const options = data?.filter_options ?? {
    series: [],
    publishers: [],
    languages: [],
  }
  const activeFilters = [
    finishedMonth
      ? {
          label: `Finished in ${formatMonthYear(finishedMonth)}`,
          clear: onClearFinishedMonth,
        }
      : null,
    availability !== "all"
      ? {
          label: availability === "downloaded" ? "Downloaded" : "Cloud only",
          clear: () => {
            setAvailability("all")
            setPage(1)
          },
        }
      : null,
    highlightFilter !== "all"
      ? {
          label: highlightFilter === "with" ? "With highlights" : "No highlights",
          clear: () => {
            setHighlightFilter("all")
            setPage(1)
          },
        }
      : null,
    series !== "all"
      ? {
          label: `Series: ${series}`,
          clear: () => {
            setSeries("all")
            setPage(1)
          },
        }
      : null,
    publisher !== "all"
      ? {
          label: `Publisher: ${publisher}`,
          clear: () => {
            setPublisher("all")
            setPage(1)
          },
        }
      : null,
    language !== "all"
      ? {
          label: `Language: ${language}`,
          clear: () => {
            setLanguage("all")
            setPage(1)
          },
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>

  return (
    <section className="flex flex-col gap-5" aria-labelledby="library-heading">
      <header>
        <h2 id="library-heading" className="font-serif text-2xl font-semibold">
          Library
        </h2>
      </header>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[minmax(18rem,1.7fr)_repeat(6,minmax(8.5rem,1fr))]">
        <div className="relative sm:col-span-2 xl:col-span-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search library"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title or author"
            className="h-9 pl-9"
          />
        </div>
        <Select value={status} onValueChange={(value) => {
          if (finishedMonth) onClearFinishedMonth()
          setStatus(value)
          setPage(1)
        }}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder="Reading status" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="reading">In progress</SelectItem>
              <SelectItem value="finished">Finished</SelectItem>
              <SelectItem value="unread">Unread</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={availability} onValueChange={(value) => {
          setAvailability(value)
          setPage(1)
        }}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder="Availability" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All books</SelectItem>
              <SelectItem value="downloaded">Downloaded</SelectItem>
              <SelectItem value="cloud">Cloud only</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={highlightFilter} onValueChange={(value) => {
          setHighlightFilter(value)
          setPage(1)
        }}>
          <SelectTrigger aria-label="Highlights" className="h-9 w-full">
            <SelectValue placeholder="Highlights" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All highlights</SelectItem>
              <SelectItem value="with">With highlights</SelectItem>
              <SelectItem value="without">No highlights</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <FilterSelect
          label="Series"
          value={series}
          options={options.series}
          allLabel="All series"
          onValueChange={(value) => {
            setSeries(value)
            setPage(1)
          }}
        />
        <FilterSelect
          label="Publisher"
          value={publisher}
          options={options.publishers}
          allLabel="All publishers"
          onValueChange={(value) => {
            setPublisher(value)
            setPage(1)
          }}
        />
        <FilterSelect
          label="Language"
          value={language}
          options={options.languages}
          allLabel="All languages"
          onValueChange={(value) => {
            setLanguage(value)
            setPage(1)
          }}
        />
      </div>

      {activeFilters.length > 0 ? (
        <div className="-mt-1 flex flex-wrap items-center gap-2">
          {activeFilters.map((filter) => (
            <Badge key={filter.label} variant="secondary" className="gap-1">
              {filter.label}
              <button
                type="button"
                aria-label={`Clear ${filter.label}`}
                onClick={filter.clear}
                className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to load library</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => {
                    const sorted = header.column.getIsSorted()
                    return (
                      <TableHead
                        key={header.id}
                        className={
                          ["progress", "reading_time", "remaining_time"].includes(
                            header.column.id,
                          )
                            ? "hidden md:table-cell"
                            : header.column.id === "last_read"
                              ? "hidden sm:table-cell"
                              : undefined
                        }
                        aria-sort={
                          sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                        }
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-ml-3"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp data-icon="inline-end" />
                          ) : sorted === "desc" ? (
                            <ArrowDown data-icon="inline-end" />
                          ) : (
                            <ArrowUpDown data-icon="inline-end" />
                          )}
                        </Button>
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    No books match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => onOpenBook(row.original.content_id)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={
                          ["progress", "reading_time", "remaining_time"].includes(
                            cell.column.id,
                          )
                            ? "hidden md:table-cell"
                            : ["last_read", "highlights"].includes(cell.column.id)
                              ? "hidden sm:table-cell"
                              : undefined
                        }
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <footer className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground">
          {data
            ? `${formatNumber(data.total)} ${data.total === 1 ? "book" : "books"}`
            : "Loading books…"}
        </p>
        <div className="flex items-center gap-2">
          <span className="mr-2 text-muted-foreground">
            Page {data?.page ?? page} of {data?.pages ?? 1}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous page"
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next page"
            disabled={!data || page >= data.pages || loading}
            onClick={() => setPage((value) => value + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </footer>
    </section>
  )
}

function FilterSelect({
  label,
  value,
  options,
  allLabel,
  onValueChange,
}: {
  label: string
  value: string
  options: string[]
  allLabel: string
  onValueChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={label} className="h-9 w-full">
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="all">{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
