# Estimated time remaining

Remaining time first uses a reading rate computed from paired OpenContent/LeaveContent sessions. One usable session with positive progress is enough. The app retains up to 20,000 recent session events in its own snapshot tables, deduplicated by their contents, so Kobo clearing AnalyticsEvents no longer immediately loses the estimate.

When paired sessions are unavailable, the app learns a rate from changes between imports in the independent Event type 3 `ExtraDataReadingSeconds` counter and book progress. The first import establishes a baseline; a later import after reading supplies a sample. A sample requires at least 120 additional recorded seconds, 1–25 percentage points of progress, and no more recorded time than the elapsed time between observations (with 10 seconds of tolerance). Reading with unchanged rounded progress accumulates until progress advances. Counter decreases, progress decreases and unread resets discard previous rates. Archived sessions predating a detected reset are excluded. Only the latest ten interval samples per book are retained. Unchanged imports do not add samples.

Session matching uses volumeid, or an exact title/author match only when unique in the canonical library. A paired session requires at least 120 reported seconds, 10 page turns, positive progress no greater than 10 percentage points, and elapsed time within 10 seconds or 10% of reported seconds. IdleTime is not separately subtracted. Recent archived session records show the
paired opening and observed progress change when usable, plus the estimator's
sample assessment (including short duration, progress jump, elapsed-time mismatch,
or pace outlier). These assessments reuse the estimator's checks; they are not
proof that a record represents genuine continuous reading.

For either kind of estimate, rates from the latest ten candidates must be within a factor of three of their median in log space. This treats multiplicative differences symmetrically, including when there are only two conflicting samples. Remaining seconds equal summed recorded seconds divided by summed progress, multiplied by remaining percentage. Book details identify the source and show sample coverage; an import interval can include several reading sessions.

When no usable rate is available, the app falls back to Kobo's nonnegative current-chapter plus rest-of-book estimate. Missing values display as a dash. Chapter estimates are shown only for the Kobo fallback. Lifetime reading time divided by current progress is never used as a fallback.

Book details show observed seconds per percentage point, an accepted-sample
range when there is more than one sample, and the latest accepted session timestamp
when available. The range is descriptive, not a confidence interval or prediction
range. Retained import-interval samples have no stored dates, so their freshness
remains unknown. Pace is never presented as words or pages per minute.

Whole-percent rounding, navigation that passes the checks, telemetry retention, counter lag and changing speed can affect the result. These filters are heuristics, not validated Kobo specifications or confidence bounds. A single sample cannot be checked against other reading speeds. The app cannot recover sessions cleared before it observed them.

# Recorded reading time

Reading time normally uses the content counter, including matched removed-record history. When that total exceeds both 24 hours and ten times a retained Event type 3 counter, and that event has at least 120 seconds and ten distinct interaction timestamps, the app substitutes the event counter and labels it as recorded reading time. This targets gross inflation such as Count Zero's 460,860-second content counter versus 6,337 recorded session seconds. Smaller differences are left alone because retained events can be incomplete. The replacement is recorded coverage, not a claim to recover all lifetime reading.

The selected values and their sources are stored in the app's derived book table, so dashboard, library, details and sorting agree. History is carried into the next temporary snapshot only for the same source path and account, then published atomically with it. Failed imports do not advance the baseline. The source Kobo content and telemetry are unchanged. Existing snapshots rebuild automatically when the derived schema changes.
