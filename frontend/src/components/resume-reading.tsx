import { CartesianGrid, Scatter, ScatterChart, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate, formatDuration } from "@/lib/format"
import type { DashboardData } from "@/types"

function estimateSource(source: string | null) {
  return source === "sessions" ? "sessions" : source === "observations" ? "reading history" : "Kobo"
}

export function ResumeReading({ data, onOpenBook }: {
  data: DashboardData["resume_reading"]
  onOpenBook: (contentId: string) => void
}) {
  const dated = data.books.filter((book) => book.days_since_read !== null)
  const finishSoon = data.books.filter((book) => book.remaining_seconds > 0 && book.remaining_estimate_source !== null)
    .sort((a, b) => a.remaining_seconds - b.remaining_seconds).slice(0, 3)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pick up a book</CardTitle>
        <CardDescription>
          In-progress books as of {data.as_of ? formatDate(data.as_of) : "an unknown snapshot date"}. Days since last recorded reading do not establish abandonment.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          {dated.length > 0 && (
            <ChartContainer config={{ books: { label: "Books", color: "var(--chart-1)" } }} className="h-56 w-full aspect-auto" aria-label="Book progress versus days since last recorded reading">
              <ScatterChart accessibilityLayer margin={{ top: 12, right: 16, bottom: 22, left: 4 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="days_since_read" name="Days since last read" allowDecimals={false} label={{ value: "Days since last recorded reading", position: "bottom", offset: 4 }} />
                <YAxis type="number" dataKey="percent_read" name="Progress" domain={[0, 100]} unit="%" width={44} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => payload[0]?.payload.title} formatter={(value, name) => <span>{name}: {value}{name === "Progress" ? "%" : " days"}</span>} />} />
                <Scatter name="Books" data={dated} fill="var(--color-books)" isAnimationActive={false} />
              </ScatterChart>
            </ChartContainer>
          )}
          {finishSoon.length > 0 && (
            <div className="grid gap-2">
              <h3 className="text-sm font-medium">Shortest remaining estimates</h3>
              {finishSoon.map((book) => (
                <div key={book.content_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <Button variant="link" className="h-auto max-w-full justify-start whitespace-normal px-0 text-left" onClick={() => onOpenBook(book.content_id)}>{book.title}</Button>
                  <span className="text-muted-foreground">{formatDuration(book.remaining_seconds)} estimated · {estimateSource(book.remaining_estimate_source)}</span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">Estimates can be based on sparse or old records. Book details show sample coverage.</p>
            </div>
          )}
          {data.books.length === 0 && <p className="text-sm text-muted-foreground">No books are currently marked as in progress.</p>}
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Book</TableHead><TableHead className="text-right">Progress</TableHead><TableHead className="text-right">Days since last read</TableHead></TableRow></TableHeader>
          <TableBody>{data.books.map((book) => (
            <TableRow key={book.content_id}>
              <TableCell><Button variant="link" className="h-auto max-w-64 justify-start whitespace-normal px-0 text-left" onClick={() => onOpenBook(book.content_id)}>{book.title}</Button></TableCell>
              <TableCell className="text-right">{book.percent_read}%</TableCell>
              <TableCell className="text-right">{book.days_since_read ?? "Unknown"}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
