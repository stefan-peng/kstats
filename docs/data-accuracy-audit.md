# Reading data accuracy audit — September 26, 2026

Evidence: read-only queries against `.data/KoboReader.sqlite` during this review,
plus the source-to-API-to-UI calculation paths. Dates below use America/New_York.
The snapshot was not modified. This verifies database consistency and app
calculations, not the actual time a person spent reading.

## Confirmed defect: Count Zero's daily activity

The book record contains 154 reading seconds, 13% progress, and two starts.
Its type-3 event contains 9 reading seconds, one reported session, and timestamps
1787624886, 1787624888, 1790479202: two interactions on August 24 and one on
September 26. The type-46 counterpart also reports 9 seconds and one session,
but only has the two August timestamps. Event counts and session counters are
therefore not interchangeable, nor reliable reconstructions of actual sessions.

Previously, the single-session counter caused the app to weight the entire
33-day gap as reading. Integer rounding then produced nine one-second bars on
August 25–September 2: none were dates represented by the source interactions.

Fixed: detect gaps exceeding either the row's entire reported duration or a
30-minute inactivity bound. When these imply more separate activity clusters
than the session counter supports, leave the entire row's duration unallocated.
Do not guess which timestamps correspond to its stale duration. Otherwise keep
the largest-gap session grouping, deduplicate timestamps, and divide plausible
midnight intervals across local dates. The 30-minute bound is a conservative
heuristic, not a Kobo specification. Unusable dates also retain their duration
in `unallocated_seconds` rather than disappearing from `source_seconds`.

Count Zero's 9 seconds now remain **undated**, and no daily bars are fabricated.
The first attempted correction allocated 6 and 3 seconds to the observed dates;
that was rejected because there is no evidence associating the stale counter
with September's interaction. The chart is called “Recorded reading activity”
and explicitly identifies duration that cannot be dated reliably.

A separate `AnalyticsEvents.LeaveContent` record provides better recent data:
154 seconds read, 9 page turns, and 3 seconds of separately reported idle time,
at September 26, 11:22:36 PM. The preceding `OpenContent` record is at 11:20:02 PM;
progress changes from 11% to 13%. The app now displays up to 20 retained explicit
LeaveContent sessions separately, with exact reported seconds and page turns.
It does not add these seconds to either the content counter or Event duration,
which would risk double-counting. SecondsRead is displayed as reported; IdleTime
is not subtracted without evidence establishing whether it is already excluded.
Only one LeaveContent record survives in this snapshot, so this cannot establish
the user's full reading time today. There is no basis to claim the stale 9-second
counter measures today's reading or that all actual sessions are retained.

Across all 72 usable type-3 rows, the total stays 141,727 seconds: 137,936 can
be distributed heuristically and 3,791 are now undated. Three rows previously
allocated positive time to dates without source interactions, affecting 11
distinct dates. Positive dashboard days drop from 41 to 38; other books can
still have activity on those same dates.

## Remaining time

The app sums nonnegative `CurrentChapterEstimate` and `RestOfBookEstimate` for
in-progress books. It does not calculate reading speed. Count Zero stores
0 + 23,913 seconds, displayed as 6h 38m. This is the exact stored estimate after
minute truncation; its predictive accuracy cannot be established from this
snapshot. The UI now identifies it as Kobo's estimate in the library and detail.

A replacement based on `TimeSpentReading / percent_read` would predict only
about 17 minutes remaining for Count Zero. That assumes the 154 recorded seconds
account for all of its 13% progress, which the database cannot establish. Progress
can change independently of recorded time. WordCount is unavailable for this
book, so a words-per-minute model also lacks an input. No replacement estimate
was introduced. Of 47 in-progress books, 34 have no positive chapter estimate
and one has no positive remaining estimate; unavailable values remain dashes.

Improvement requiring new evidence: archive the short-lived LeaveContent records by event ID and persist successive imports' per-book time
and progress, identify resets/jumps/re-reads, and compare estimates with later
observed reading-time increments. Estimate from several consistent increments
with a range and coverage indicator. Validate the meaning of the two Kobo
estimate fields against the device display before changing their combination.
A single snapshot cannot prove whether any discrepancy is sync, retention,
a reset, another reader, or actual reading behavior.

## Other metrics reviewed

| Metric | Finding | Reliability / improvement |
| --- | --- | --- |
| Library and status totals | 279 canonical books: 192 unread, 47 reading, 40 finished. 198 store and 81 sideloaded; 157 other catalog rows excluded. | Correct for the app's library scope, not every content row. Status is Kobo's stored state, not proof a book was read end-to-end. |
| Recorded reading time | Canonical total 253,246 seconds (70h 20m 46s). Eight finished books and two in-progress books have zero recorded time. | Sum is correct, but zero is not proof of no reading. Do not infer actual reading speed from lifetime progress and this incomplete counter. |
| Telemetry total versus library total | 141,727 seconds of retained type-3 telemetry; 68,456 seconds from 34 usable rows refer to content IDs no longer present in `content`. | Different populations and retention windows. Do not divide these totals to claim a coverage percentage. Dashboard now explicitly states that retained telemetry includes books no longer in the library. |
| Event streams | 90 type-3 rows, 72 usable duration payloads. 172 type-46 rows, 65 usable duration payloads. 57 type-3/type-46 pairs share content ID and LastOccurrence. | Keep one stream; blindly adding type 46 would duplicate activity. A future fallback needs tested identity/deduplication, not summation. Rows without valid duration fields cannot supply duration. |
| Progress | Clamped to 0–100; finished status displayed as 100%. | Deliberate status normalization, not measured pages read. Jumped/synced progress must not count as measured reading. |
| Completion chart | 40 finished books, three without finish timestamps (The Boy Who Thought, A Fearless Champion, Konbini). | Correctly excludes undated completions rather than inventing dates. Uses stored timestamp months; local-time boundary normalization would also need matching library filters. Window ends at latest recorded completion, not necessarily current month. |
| Historical duplicate merging | No removed rows with activity and no merged histories in this snapshot. | Existing max-time strategy avoids summing duplicate cumulative counters; it can undercount genuinely independent copies. Cannot validate that scenario from this snapshot. Book detail currently queries telemetry only for the canonical ID. |
| Highlights and lookups | 127 displayable bookmarks in the current library. Hidden/empty marks excluded; dictionary entries deduplicated by word and dictionary. | These are saved highlights/notes and unique lookup entries, not counts of every highlight action or lookup occurrence. |
| Activity heatmap | Uses allocated daily seconds; blank dates mean no allocated retained telemetry. | Not evidence of zero actual reading. Weekly/monthly views reduce apparent precision but use the same estimated allocation. |

## Verification

Regression coverage includes the Count Zero payload, multi-day idle gaps even
with large cumulative durations, duplicate timestamps, plausible midnight
intervals, unusable timestamps, and matching dashboard/book API distributions.
Backend suite and frontend tests passed; production frontend build passed.
Frontend interaction checks used jsdom, not a live browser/device comparison.
Final checks: 103 backend tests, frontend interaction/regression tests, and build.
