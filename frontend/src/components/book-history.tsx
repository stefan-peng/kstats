import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime, formatNumber } from "@/lib/format"
import type { BookDetail } from "@/types"

export function ProgressPace({ pace }: { pace: BookDetail["progress_pace"] }) {
  if (!pace) return null
  return (
    <div className="mt-3 grid gap-1">
      <p>Observed pace: {formatNumber(Math.round(pace.seconds_per_percent))}s per 1% progress.</p>
      {pace.sample_count > 1 && <p>Sample range: {formatNumber(Math.round(pace.sample_min))}–{formatNumber(Math.round(pace.sample_max))}s per 1% progress.</p>}
      {pace.latest_sample_at && <p>Last sample: {formatDateTime(pace.latest_sample_at)}</p>}
    </div>
  )
}

export function ProgressMilestones({ milestones }: { milestones: BookDetail["progress_milestones"] }) {
  if (milestones.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle data-usage-view="milestones">Progress milestones</CardTitle>
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

export function BookVocabulary({ words, activity }: {
  words: BookDetail["saved_words"]
  activity: BookDetail["dictionary_activity"]
}) {
  return (
    <>
      {words.length > 0 && (
        <Card>
          <CardHeader><CardTitle data-usage-view="vocabulary">Saved vocabulary ({words.length})</CardTitle></CardHeader>
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
      {(activity.reported_words.length > 0 || activity.recorded_at.length > 0) && (
        <Card>
          <CardHeader><CardTitle data-usage-view="dictionary">Dictionary activity</CardTitle><CardDescription>Timestamps are book-level, not per word.</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4">
            {activity.reported_words.length > 0 && <Table>
              <TableHeader><TableRow><TableHead>Reported word</TableHead><TableHead>Dictionary</TableHead></TableRow></TableHeader>
              <TableBody>{activity.reported_words.map((word) => <TableRow key={`${word.word}-${word.dictionary}`}><TableCell>{word.word}</TableCell><TableCell>{word.dictionary ?? "Unknown"}</TableCell></TableRow>)}</TableBody>
            </Table>}
            <div className="grid gap-1 text-sm">
              {activity.recorded_at.length > 0 ? <>
                <p>{formatNumber(activity.recorded_at.length)} distinct timestamps</p>
                <p>First: {formatDateTime(activity.recorded_at[0])}</p>
                <p>Last: {formatDateTime(activity.recorded_at[activity.recorded_at.length - 1])}</p>
              </> : <p>No timestamps</p>}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
