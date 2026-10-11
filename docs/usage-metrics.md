# Usage-driven evolution

The app silently records local feature usage. No analytics service or UI is involved.
Agents should use this evidence to volunteer design suggestions during substantive
app work, without waiting for the user to name a feature or problem. Implementing
those suggestions still requires a user request; logging triggers no automatic redesign.

## Where to find it

- Database: `.data/usage.sqlite` (or `usage.sqlite` in the configured data directory).
- Read-only report: `GET /api/usage`, with schema version, retention, and daily counts.
- SQLite: `SELECT revision, name, SUM(count) FROM counts GROUP BY revision, name;`

The database is separate from `KoboReader.sqlite` and survives imports. It contains
UTC daily aggregates for the last 180 days, pruned when read or written. No book
IDs, titles, search strings, highlights, URLs, client identifiers, or raw click
coordinates are saved. Event names are validated against an explicit allowlist.

## Meaning of the first experiment

UI revision **baseline-v1** is the existing dashboard before the proposed
retrospective redesign. Instrumentation does not rearrange any features.
Early counts created before revision labels existed are migrated once and retained
as `unversioned`; exclude those from comparisons between UI revisions.

- `app.open`: one frontend initialization/page load, not a person or reading session.
- `seen.<section>`: a section heading was at least half visible for a continuous
  second in a visible tab, outside any covering dialog. Counted once per section
  per page load, across all books. This measures opportunity to notice, not attention.
- `book.open.library|continue|resume|finish_soon|top`: book activation by entry point, including
  keyboard activation. Repeated openings count; direct URL loads are not clicks.
- `library.<filter>`, `library.sort|direction|page|month`: changed browse state.
  Clearing filters can change several fields; these are field changes, not distinct
  gestures. Automatic pagination resets accompanying filters do not count.
- `library.search`, `notes.search`: an edited search field lost focus. No keystroke
  counts or values. An edit abandoned by closing the page may not be recorded.
- `duration.day|week|month|heatmap`, `insights.author|source|format|language`:
  duration-control activations and grouping selections.
- `notes.color|month|clear`: note filter changes/clear actions.
- `notes.copy|download`: successful clipboard write or download initiation, not
  proof of a file being saved or later used.
- `session.details`: disclosure activation, including both opening and closing.
- Other actions: library jump/more-filters/clear, manual import, theme toggle.

The complete event allowlist is in `backend/app/usage.py`; heading markers and
explicit action hooks live alongside the corresponding frontend features.
Background status polling, imports, renders, and chart hover are not usage events.
Delivery is best effort, with no offline queue or retries; failures never block UI.
Section exposure requires IntersectionObserver. Dev/test/manual exploration can
inflate counts, so consider dates and how the app was being used.

## Agent review and user-triggered evolution

1. Read this document and query the actual database read-only. Report date range,
   page loads, active days, and UI revisions before interpreting feature counts.
2. Compare use and exposure. A rarely seen section may be buried, while a frequently
   viewed chart may be useful without clicks. Daily aggregates do not establish
   sessions, funnels, unique users, or click-through conversion rates.
3. Combine the evidence with the user's reading goals and the source data's limits.
   Suggest a small, concrete hypothesis; do not equate low usage with low value.
4. Implement design changes only within the user's requested scope. For meaningful
   layout/feature changes, give the frontend a new revision label and add it to the
   backend's accepted revisions. Preserve old labels/counts for comparison.
5. Compare equivalent periods and exposure under each revision after real use.
   Keep, revise, or revert based on evidence and user feedback, not a click-maximizing
   objective. Sparse data is a reason to withhold judgment.

Example request: “Review docs/usage-metrics.md and the local usage database, then
suggest the next small evolution of the app based on how I actually use it.”
