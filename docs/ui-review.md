# UI review — October 10, 2026

Reviewed the running app at localhost:5173 in the Codex in-app browser, using
the current Kobo snapshot. This is a visual regression checklist, not a claim
that every possible data or device state has been exercised.

## Corrections

- Card outlines were painted outside the element and clipped at the left edge
  of the book dialog's scroll region. Paint them inset, using the border token.
- Books without daily telemetry reserved a chart-sized empty area. Let the empty
  message use its natural height.
- Duration axis labels such as `16h 40m` wrapped onto two lines. Increase the
  duration axis width in both the overview and book detail charts.

## Rendered review

| Surface | Checks |
| --- | --- |
| Header and overview | Typography, snapshot provenance, disconnected/disabled refresh, theme control, summary grid |
| Reading status and completions | Legend, axes, spacing, responsive stacking |
| Reading duration | Weekly axis labels, heatmap legend and calendar layout, selected control |
| Reading insights and coverage | Long author labels and table text, numeric alignment, grouping control, coverage labels |
| Resume reading | Scatter axes, remaining estimates, nested scrolling table |
| Continue reading and most read | Title truncation, progress bars, consistent card sizing and spacing |
| Library | Expanded filters, search, no-results state, clear action, table alignment, narrow two-column view, pagination controls |
| Book details | Long title, cover, badges, progress, metadata, formatted description, scroll area and close control |
| Reading history | Populated sessions, milestones, activity chart, remaining-time panel, compact empty activity |
| Vocabulary and dictionary | Populated tables, timestamps, card edges |
| Highlights and notes | Populated and empty content, search no-results and clear action, filter and export controls |

Desktop dark and light themes were inspected. Narrow layout was inspected via
full-page captures because viewport-only captures intermittently returned blank
images after scrolling. This limits confidence in the browser preview's viewport
capture, not evidence of an app defect. No physical mobile device or Firefox
rendering was tested. Clipboard/download side effects and device import were not
triggered. Loading/error/retry behavior remains covered by the existing tests,
not a forced live backend failure.

## Regression procedure

1. Open Lucius Malfoy, Would-Be Murderer from the library. Check the entire left
   activity-card edge, including both rounded corners; verify the empty panel
   stays compact and the description and notes remain reachable.
2. Open Harry Silver. Check card edges while scrolling past sessions, milestones,
   activity, and the remaining-time estimate. Confirm nested session scrolling
   does not conceal the dialog close button.
3. Open The Library. Check vocabulary/dictionary tables and highlights; search
   for an absent phrase, then clear the note filters.
4. Switch overview duration to Weekly. Check that multi-part duration ticks stay
   on one line. Check Heatmap, then restore Weekly.
5. Repeat the card-edge checks in light theme and narrow layout. Check that
   tables scroll within their containers rather than widening the page.

Validation: all 80 frontend tests passed; TypeScript/Vite production build and
`git diff --check` passed. JSDOM emits CSS parser warnings for modern stylesheet
syntax, so real-browser inspection supplied the visual regression check.

Usage evidence before review: one UTC day (2026-10-11, October 10 locally), three
page loads across `baseline-v1` and `unversioned`. Counts are too sparse for
usage-based redesign conclusions and include development activity.
