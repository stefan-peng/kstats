import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime, formatNumber } from "@/lib/format"
import type { BookDetail } from "@/types"

export function ProgressPace({ pace }: { pace: BookDetail["progress_pace"] }) {
  if (!pace) return null
  return (
    <div className="mt-3 grid gap-1">
      <p>Observed progress pace: {formatNumber(Math.round(pace.seconds_per_percent))}s per percentage point.</p>
      <p>{pace.sample_count > 1
        ? `Accepted sample spread: ${formatNumber(Math.round(pace.sample_min))}–${formatNumber(Math.round(pace.sample_max))}s per percentage point. Not a confidence interval.`
        : "Only one usable sample; pace variability is unknown."}</p>
      <p>{pace.latest_sample_at ? `Latest accepted session: ${formatDateTime(pace.latest_sample_at)}.` : "Sample dates are unavailable for retained import intervals."}</p>
      <p>Rounded book progress can include navigation. This is not words or pages per minute.</p>
    </div>
  )
}

export function ProgressMilestones({ milestones }: { milestones: BookDetail["progress_milestones"] }) {
  if (milestones.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recorded progress milestones</CardTitle>
        <CardDescription>Retained 25%, 50%, and 75% crossings. Repeated crossings may reflect navigation or earlier readings; gaps are not active reading time.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3" aria-label="Progress milestone timeline">
          {milestones.map((milestone) => (
            <li key={`${milestone.recorded_at}-${milestone.percent}`} className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <Badge variant="outline">{milestone.percent}%</Badge>
              <time dateTime={milestone.recorded_at}>{formatDateTime(milestone.recorded_at)}</time>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

export function BookVocabulary({ words, lookups }: {
  words: BookDetail["saved_words"]
  lookups: BookDetail["dictionary_lookups"]
}) {
  return (
    <>
      {words.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Saved vocabulary ({words.length})</CardTitle><CardDescription>Words saved in Kobo's WordList. Saved entries are not counts of lookup actions.</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Word</TableHead><TableHead>Dictionary</TableHead><TableHead>Saved</TableHead></TableRow></TableHeader>
              <TableBody>{words.map((word) => (
                <TableRow key={`${word.word}-${word.dictionary}`}><TableCell>{word.word}</TableCell><TableCell>{word.dictionary ?? "Unknown"}</TableCell><TableCell>{word.saved_at ? formatDateTime(word.saved_at) : "Unknown"}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {lookups.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Dictionary lookups ({lookups.length})</CardTitle><CardDescription>Unique word/dictionary entries with retained interaction timestamps, not a complete lookup history.</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Word</TableHead><TableHead>Dictionary</TableHead><TableHead>Recorded interactions</TableHead></TableRow></TableHeader>
              <TableBody>{lookups.map((lookup) => (
                <TableRow key={`${lookup.word}-${lookup.dictionary}`}>
                  <TableCell>{lookup.word}</TableCell><TableCell>{lookup.dictionary ?? "Unknown"}</TableCell>
                  <TableCell>{lookup.recorded_at.length ? lookup.recorded_at.map((timestamp) => <p key={timestamp}><time dateTime={timestamp}>{formatDateTime(timestamp)}</time></p>) : "No retained timestamps"}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  )
}
