import { useEffect, useState } from "react"
import { BookOpenText, CalendarDays, Clock3, Highlighter } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
import { formatDate, formatDuration, formatNumber } from "@/lib/format"
import type { BookDetail } from "@/types"
import { FormattedText } from "./formatted-text"
import { StatusBadge } from "./status-badge"

export function BookDetailDialog({
  contentId,
  onOpenChange,
}: {
  contentId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const [book, setBook] = useState<BookDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!contentId) {
      setBook(null)
      setError(null)
      return
    }
    let active = true
    api
      .book(contentId)
      .then((data) => active && setBook(data))
      .catch((reason: Error) => active && setError(reason.message))
    return () => {
      active = false
    }
  }, [contentId])

  return (
    <Dialog open={Boolean(contentId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
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
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={book.status} />
                {book.downloaded && <Badge variant="outline">Downloaded</Badge>}
              </div>
              <DialogTitle className="font-serif text-3xl">{book.title}</DialogTitle>
              <DialogDescription>{book.author}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Reading progress</span>
                  <span className="font-medium">{book.percent_read}%</span>
                </div>
                <Progress value={book.percent_read} />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex items-start gap-3 rounded-lg border p-3">
                  <Clock3 className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Reading time</p>
                    <p className="font-medium">{formatDuration(book.reading_seconds)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border p-3">
                  <BookOpenText className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Times opened</p>
                    <p className="font-medium">{formatNumber(book.times_started)}</p>
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

              {(book.series || book.publisher || book.word_count) && (
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
