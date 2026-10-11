import { trackUsage } from "@/lib/usage"
import { useId, useState } from "react"
import { Copy, Download, Highlighter } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate, formatMonthYear } from "@/lib/format"
import { downloadHighlights, formatHighlights } from "@/lib/highlights"
import type { BookDetail, Bookmark } from "@/types"

function monthOf(bookmark: Bookmark): string {
  if (!bookmark.created_at) return "undated"
  const date = new Date(bookmark.created_at)
  if (!Number.isFinite(date.getTime())) return "undated"
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

export function BookNotes({ book }: { book: Pick<BookDetail, "title" | "author" | "bookmarks"> }) {
  const id = useId()
  const [search, setSearch] = useState("")
  const [color, setColor] = useState("all")
  const [month, setMonth] = useState("all")
  const colors = [...new Set(book.bookmarks.map((bookmark) => bookmark.color))].sort((a, b) => a - b)
  const months = [...new Set(book.bookmarks.map(monthOf))].sort().reverse()
  const term = search.trim().toLocaleLowerCase()
  const filtersActive = Boolean(search || color !== "all" || month !== "all")
  const visible = book.bookmarks.filter((bookmark) =>
    (color === "all" || String(bookmark.color) === color) &&
    (month === "all" || monthOf(bookmark) === month) &&
    (!term || `${bookmark.text ?? ""}\n${bookmark.annotation ?? ""}`.toLocaleLowerCase().includes(term)),
  )
  return (
    <section className="flex flex-col gap-3" aria-label="Highlights and notes">
      <div className="flex items-center gap-2"><Highlighter className="size-4 text-primary" /><h3 data-usage-view="notes" className="font-medium">Highlights and notes ({book.bookmarks.length})</h3></div>
      {book.bookmarks.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={async () => {
              try {
                await navigator.clipboard.writeText(formatHighlights(book))
                trackUsage("notes.copy")
                toast.success("Highlights and notes copied")
              } catch {
                toast.error("Unable to copy. Try downloading instead.")
              }
            }}><Copy data-icon="inline-start" />Copy all</Button>
            <Button variant="outline" size="sm" onClick={() => {
              try { downloadHighlights(book); trackUsage("notes.download") } catch {
                toast.error("Unable to download highlights.")
              }
            }}><Download data-icon="inline-start" />Download all</Button>
          </div>
          <FieldGroup className="grid gap-3 sm:grid-cols-[1.5fr_1fr_1fr]">
            <Field><FieldLabel htmlFor={`${id}-search`}>Search highlights and notes</FieldLabel><Input data-usage-search="notes.search" id={`${id}-search`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Text or annotation" /></Field>
            <Field><FieldLabel htmlFor={`${id}-color`}>Highlight color</FieldLabel>
              <Select value={color} onValueChange={(value) => { setColor(value); trackUsage("notes.color") }}><SelectTrigger id={`${id}-color`} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>
                <SelectItem value="all">All colors</SelectItem>{colors.map((value) => <SelectItem key={value} value={String(value)}>Color {value}</SelectItem>)}
              </SelectGroup></SelectContent></Select>
            </Field>
            <Field><FieldLabel htmlFor={`${id}-month`}>Created month</FieldLabel>
              <Select value={month} onValueChange={(value) => { setMonth(value); trackUsage("notes.month") }}><SelectTrigger id={`${id}-month`} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>
                <SelectItem value="all">All months</SelectItem>{months.map((value) => <SelectItem key={value} value={value}>{value === "undated" ? "Undated" : formatMonthYear(value)}</SelectItem>)}
              </SelectGroup></SelectContent></Select>
            </Field>
          </FieldGroup>
          {filtersActive && <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground" aria-live="polite">
            <span>{visible.length} of {book.bookmarks.length} shown</span>
            <Button data-usage-action="notes.clear" variant="ghost" size="sm" onClick={() => { setSearch(""); setColor("all"); setMonth("all") }}>Clear note filters</Button>
          </div>}
        </>
      )}
      {book.bookmarks.length === 0 ? <p className="text-sm text-muted-foreground">No highlights or notes are stored for this book.</p> : visible.length === 0 ? <p className="text-sm text-muted-foreground">No highlights or notes match these filters.</p> : visible.map((bookmark) => (
        <blockquote key={bookmark.id} className="flex flex-col gap-2 border-l-2 border-primary pl-4">
          {bookmark.text && <p className="whitespace-pre-wrap break-words text-sm">{bookmark.text}</p>}
          {bookmark.annotation && <div className="flex flex-col gap-1"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Note</p><p className="whitespace-pre-wrap break-words text-sm italic text-muted-foreground">{bookmark.annotation}</p></div>}
          <footer className="flex items-center gap-2 text-xs text-muted-foreground">{monthOf(bookmark) === "undated" ? "Undated" : formatDate(bookmark.created_at)}<Badge variant="outline">Color {bookmark.color}</Badge></footer>
        </blockquote>
      ))}
    </section>
  )
}
