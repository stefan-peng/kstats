import { useEffect, useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
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
import { api } from "@/lib/api"
import { formatDate, formatDuration, formatNumber } from "@/lib/format"
import type { Book, BooksResponse } from "@/types"
import { StatusBadge } from "./status-badge"

const helper = createColumnHelper<Book>()

export function LibraryPage({
  onOpenBook,
}: {
  onOpenBook: (contentId: string) => void
}) {
  const [data, setData] = useState<BooksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [status, setStatus] = useState("all")
  const [availability, setAvailability] = useState("all")
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
    const query = new URLSearchParams({
      page: String(page),
      page_size: "20",
      status,
      sort: sorting[0]?.id ?? "last_read",
      direction: sorting[0]?.desc ? "desc" : "asc",
    })
    if (debouncedSearch) query.set("search", debouncedSearch)
    if (availability !== "all") {
      query.set("downloaded", availability === "downloaded" ? "true" : "false")
    }
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
  }, [availability, debouncedSearch, page, sorting, status])

  const columns = useMemo(
    () => [
      helper.accessor("title", {
        id: "title",
        header: "Book",
        cell: ({ row }) => (
          <div>
            <p className="max-w-80 truncate font-medium">{row.original.title}</p>
            <p className="max-w-80 truncate text-xs text-muted-foreground">
              {row.original.author}
            </p>
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
      helper.accessor("date_last_read", {
        id: "last_read",
        header: "Last read",
        cell: ({ getValue }) => formatDate(getValue()),
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

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-7 p-5 md:p-8 lg:p-10">
      <header>
        <h1 className="font-serif text-4xl font-semibold tracking-tight">Library</h1>
        <p className="mt-2 text-muted-foreground">
          Search and sort every book in your native Kobo library.
        </p>
      </header>

      <div className="flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search library"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title or author"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(value) => {
          setStatus(value)
          setPage(1)
        }}>
          <SelectTrigger className="w-full md:w-44">
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
          <SelectTrigger className="w-full md:w-44">
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
      </div>

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
                          ["progress", "reading_time"].includes(header.column.id)
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
                    <TableCell colSpan={5}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
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
                          ["progress", "reading_time"].includes(cell.column.id)
                            ? "hidden md:table-cell"
                            : cell.column.id === "last_read"
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
          {data ? `${formatNumber(data.total)} books` : "Loading books…"}
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
    </main>
  )
}

