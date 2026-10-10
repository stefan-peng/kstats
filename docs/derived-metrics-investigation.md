# Derived metrics investigation — October 10, 2026

## Evidence and scope

Read-only SQLite queries, decoded Qt Event payloads, source/API review, regression
tests, and browser inspection of the built frontend. Initial queries used the
snapshot imported at 20:45 UTC; later validation used the independently refreshed
20:51 UTC snapshot. The latter contains 269 canonical books: 194 unread, 27 in
progress, and 48 finished. Counts describe these snapshots, not Kobo firmware in
general or verified human reading behavior.

This review supplements the [September audit](data-accuracy-audit.md), especially
its interpretation of dictionary records. It does not turn retained telemetry
into complete lifetime history. No source-device database was modified.

## Implemented high-confidence changes

| Feature | Evidence / calculation | Guardrail |
| --- | --- | --- |
| Archived session display | App-owned Open/Leave archive; content ID or unique exact title/author matching | Retained records only; never added to cumulative time totals |
| Session assessments | Same pairing and sample filters as the remaining-time estimator | Opening/progress association is heuristic; rejected samples still display their reported durations |
| Observed progress pace | Accepted seconds / accepted percentage-point progress | Not WPM or pages/minute; descriptive sample spread is not a confidence interval |
| Pace freshness | Latest accepted paired session timestamp | Import-interval sample dates are unavailable, not inferred from the latest observation |
| Resume view | Local calendar-date difference between last read and snapshot timestamp | Naive, invalid, missing, or future timestamps remain unknown; no abandonment claim |
| Finish-soon list | Positive selected remaining estimates, sorted ascending | Identifies Kobo/session/history source; sparse or old samples can be misleading |
| Time composition | Canonical selected recorded seconds grouped by exact author string, source, format, or base language | Status stacks use current status, not status at the time of reading; all groups retained in API, top ten positive groups displayed |
| Coverage summary | Valid dated completions, zero counters, substitutions, word-count availability, telemetry ID membership | Missing records are unknown; unmatched IDs are not automatically deleted books |
| Progress milestones | Explicit timestamps from event types 1012/1013/1014 | Repeated crossings retained; no continuous progress or elapsed-reading reconstruction |
| Saved vocabulary | WordList text, dictionary suffix, creation timestamp | Saved entries, not every dictionary lookup |
| Dictionary activity | Reported Event type-9 word values and separate book-level timestamp union | No assignment of aggregate timestamps to individual words |
| Highlight exploration | Saved visible text/notes, stored color codes, local creation months | No invented color meaning; exports always include all notes regardless of filters |

The later snapshot has 38 dated and 10 undated/unusable finished-book timestamps,
14 started/finished books with zero selected recorded time, and 11 books with
word counts. These limitations are now visible rather than silently interpreted
as complete coverage.

## Further investigations and decisions

### Dictionary payload scope: confirmed presentation problem

The Library has one type-9 row reporting `Word = eschatological`, `EventCount = 24`,
and 24 timestamps extending from September 24 UTC to October 3 UTC. WordList
contains 11 different saved words for that book. Each saved-word timestamp is
within 2–6 seconds of a timestamp in the aggregate event, including Cacoethes,
extirpate, Palatinate, nuncio, and others. The final saved word is eschatological.

This strongly supports an aggregate row retaining a single reported word value,
not 24 lookups of that word. Exact action/word mapping cannot be recovered from
this snapshot. The API now separates `dictionary_activity.reported_words` from
`dictionary_activity.recorded_at`; the UI shows book-level distinct timestamp
count and earliest/latest interaction. WordList remains a separate saved list.
The old `dictionary_lookups` API field was removed rather than aliased.

### Reading word counters: no defensible WPM

Of 99 type-3 rows with duration fields, 92 contain `wordCounts`; 87 contain a
non-null `wordsRead` (56 positive, 31 zero). In every one of those 87 rows,
`wordsRead` equals the last `wordCounts` entry. None of the 92 word-count arrays
has the same length as its row's interaction timestamp array.

These are not demonstrated total words consumed over the duration window, nor
aligned word/time samples. All 99 `PagesTurnedThisSession` fields are zero;
`StartPercentage` and `ButtonPressCount` are null in those duration rows.
No WPM, aggregate page-turn pace, or lifetime-time/progress rate was added.

Needed evidence: a controlled before/after reading experiment establishing each
field's scope and update rules, with text/page position and elapsed time.

### Explicit session metrics: useful but limited

The archive retains 11 Open and 11 Leave events, all on October 10, spanning
15:05–20:44 UTC. None has `volumeid`; all have title/author values. Seven Harry
Silver sessions pass the estimator's existing filters, covering 3,263 reported
seconds and 25 percentage points. Observed weighted pace is 130.52 seconds per
percentage point; accepted individual rates span roughly 84–197 seconds.

The 17-point session and the brief/no-progress session are rejected, with their
recorded durations still visible. These exclusions are heuristics, not proof
that the other sessions contain only uninterrupted reading. IdleTime is not
subtracted. The archive is too short to justify weekday/time-of-day habits or
streak claims.

`ButtonPressCount` increases across several sessions (519, 786, 906, 938, 1019),
then resets to 52. Its scope differs from per-session page turns. A button-use
ratio would need reset-aware scope validation, so none was added.

Harry Silver also stores `TimesStartedReading = 0` despite nine retained Leave
records. That field is not a defensible session/open count. `LastTimeStartedReading`
is empty for this book and cannot establish a first-reading date.

### Rendered-page caches: chapter profiles deferred

There are 11,999 chapter-cache rows but only 4,462 join to currently retained
rendered-page records. Of 1,151 distinct content/chapter-index groups, 164 have
multiple chapter-page counts. The rendered-page table has four viewing-setting
hashes and 912 pagination hashes. Cache counts are therefore layout/history
artifacts, not directly summable book lengths or pages read.

Positive cached book-page counts exist for only 41 canonical books in the later
snapshot (42 in the initial snapshot). Cached
viewports are sparse; their highest page number is not proof that preceding pages
were read. Zero of 27 non-null current-book chapter bookmarks resolves directly
to a content-row ID: bookmark values contain paths, fragments, and offsets.

No chapter-length or pages-read chart was added. Needed evidence: a validated
current-pagination identity, orphan/stale-cache handling, chapter deduplication,
and a tested bookmark-to-TOC mapping. Parsing the actual EPUB's navigation data
may be a better source of chapter structure than the rendering cache.

### Events 1020 and 1021: correlation is not identification

Type 1020 timestamps match all 11 retained openings, but also seven retained
leavings. Type 1021 timestamps match all 11 leavings and none of those openings.
Both retain much longer timestamp histories than AnalyticsEvents.

This is suggestive, not enough to label them as session start/end events. Their
payloads provide timestamps but no explicit duration or progress association.
No historical sessions were reconstructed from them. Needed evidence: firmware
symbol/string analysis or controlled observations of opening, closing, sleeping,
resuming, navigating, and marking completion.

### Acquisition and completion timing

All 269 `DateAdded` values are empty. `DateCreated` is populated but spans 1973
to December 2026, including publication dates and dates after the snapshot.
It cannot support acquisition dates, backlog age, or library-growth history.
Future first-seen observations could describe when this app first observed a
book, not when it was purchased or first added to the device.

A first-start-to-finish metric also cannot use `LastTimeStartedReading` as a
first-start timestamp. Completion state alone does not establish end-to-end
reading. No acquisition, abandonment, exact completion-duration, or reread-count
metric was introduced.

## Verification

Backend regression tests cover archive matching/retention, unknown dates,
timezone/calendar boundaries, preserved composition totals, language variants,
milestone repeats/deduplication, vocabulary scope, dictionary aggregate scope,
and descriptive pace/diagnostics. Frontend tests cover grouping, note filtering,
unfiltered exports, unknown histories, sample caveats, and all plotted labels.

The production build was inspected in Chrome using an isolated read-only API
server against the local snapshot, with no device monitor/import loop. Desktop
and 390px mobile views were reviewed; chart labels and mobile table widths were
corrected. New insights/resume tables fit their mobile containers without
horizontal overflow. The detail-dialog grid was also constrained after a real
saved-vocabulary table exposed min-content overflow; the mobile dialog now has
matching 358px client and content widths. Browser inspection included real archived sessions,
milestones, saved vocabulary, and highlight controls.

Remaining ideas require new evidence rather than more arithmetic on the current
fields. No ambiguous counters were promoted into reading-performance claims.
