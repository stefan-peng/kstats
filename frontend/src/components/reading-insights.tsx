import { useState } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDuration, formatNumber } from "@/lib/format"
import type { DashboardData, LibraryInsights } from "@/types"

const dimensions = { author: "Author", source: "Source", format: "Format", language: "Language" } as const
const config = {
  unread_seconds: { label: "Unread", color: "var(--chart-4)" },
  reading_seconds: { label: "In progress", color: "var(--chart-1)" },
  finished_seconds: { label: "Finished", color: "var(--chart-2)" },
} satisfies ChartConfig

export function ReadingInsights({ insights, telemetryScope }: {
  insights: LibraryInsights
  telemetryScope: DashboardData["telemetry_scope"]
}) {
  const [dimension, setDimension] = useState<keyof typeof dimensions>("author")
  const allRows = insights.composition[dimension]
  const rows = allRows.filter((row) => row.seconds > 0).slice(0, 10)
  const quality = insights.quality
  return (
    <section className="grid gap-5 xl:grid-cols-[1.5fr_0.9fr]" aria-label="Reading insights">
      <Card>
        <CardHeader>
          <CardTitle>Library reading time</CardTitle>
          <CardDescription>
            Top 10 groups, split by current status.
          </CardDescription>
          <CardAction>
            <Select value={dimension} onValueChange={(value) => setDimension(value as keyof typeof dimensions)}>
              <SelectTrigger aria-label="Group reading time by"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {Object.entries(dimensions).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4">
          {rows.length > 0 && (
            <ChartContainer config={config} className="h-80 w-full aspect-auto" initialDimension={{ width: 640, height: 320 }} aria-label={`Recorded reading time by ${dimension}`}>
              <BarChart accessibilityLayer data={rows} layout="vertical" margin={{ left: 0, right: 12 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" tickFormatter={(value) => formatDuration(Number(value))} />
                <YAxis type="category" dataKey="label" interval={0} width={110} tickLine={false} axisLine={false} tickFormatter={(label: string) => label.length > 18 ? `${label.slice(0, 17)}…` : label} />
                <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => <span>{config[name as keyof typeof config]?.label}: {formatDuration(Number(value))}</span>} />} />
                <ChartLegend content={<ChartLegendContent />} />
                {Object.keys(config).map((key) => <Bar key={key} dataKey={key} stackId="time" fill={`var(--color-${key})`} isAnimationActive={false} />)}
              </BarChart>
            </ChartContainer>
          )}
          <Table className="table-fixed">
            {rows.length === 0 && <TableCaption>No recorded time.</TableCaption>}
            <TableHeader><TableRow><TableHead className="w-1/2">{dimensions[dimension]}</TableHead><TableHead className="w-1/5 text-right">Books</TableHead><TableHead className="whitespace-normal text-right">Recorded time</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((row) => <TableRow key={row.label}><TableCell className="whitespace-normal break-words">{row.label}</TableCell><TableCell className="text-right">{formatNumber(row.books)}</TableCell><TableCell className="text-right">{formatDuration(row.seconds)}</TableCell></TableRow>)}</TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Data coverage</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm">
            <div><dt className="text-muted-foreground">Completion dates</dt><dd>{formatNumber(quality.dated_finished)} dated · {formatNumber(quality.undated_finished)} undated</dd></div>
            <div><dt className="text-muted-foreground">In progress / finished without recorded time</dt><dd>{formatNumber(quality.active_without_recorded_time)} books</dd></div>
            <div><dt className="text-muted-foreground">Totals from telemetry</dt><dd>{formatNumber(quality.event_time_books)} {quality.event_time_books === 1 ? "book" : "books"}</dd></div>
            <div><dt className="text-muted-foreground">Books with word counts</dt><dd>{formatNumber(quality.books_with_word_count)}</dd></div>
            <div><dt className="text-muted-foreground">Matched reading telemetry</dt><dd>{formatDuration(telemetryScope.library_seconds)}</dd></div>
            <div><dt className="text-muted-foreground">Unmatched reading telemetry</dt><dd>{formatDuration(telemetryScope.unmatched_seconds)}</dd></div>
          </dl>
        </CardContent>
      </Card>
    </section>
  )
}
