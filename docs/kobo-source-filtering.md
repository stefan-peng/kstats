# Kobo Source Filtering Plan

## Context

The current Kobo snapshot contains several distinct sources of book rows in the
native `content` table. Treating every `ContentType = 6` book row as a real
library entry inflates totals and surfaces custom-server catalog noise as if it
were actual Kobo reading history.

The app should default to real Kobo account books plus sideloaded books, while
ignoring custom-server and catalog-only rows unless their data can be safely
merged into a kept canonical book.

## Snapshot Evidence

Current snapshot book rows, limited to supported book MIME types:

| Bucket | Marker | Rows | Notes |
| --- | --- | ---: | --- |
| Kobo account | `___UserID = '77bec515-aa9c-472e-afa8-449ec2de7ebc'` | 229 | 228 downloaded, 30 in progress, 58 finished, 37 with reading time |
| Sideloaded | `___UserID = 'kepub_user'` and `ContentID LIKE 'file:%'` | 8 | 3 in progress, 1 finished, 4 with reading time |
| Custom server / removed | `___UserID = 'removed'` | 2,540 | 2,526 share `DateLastRead = '2026-06-24T20:36:59Z'` |
| Catalog-only noise | blank `___UserID` | 835 | All unread, not downloaded, no reading activity |

Other supporting observations:

- Visible bookmarks are all in the Kobo account bucket: 130 bookmark rows across
  20 books.
- `removed` is not pure junk, but it is mostly custom-server noise. It has only
  3 non-unread rows, 2 rows with reading time, 14 rows with non-mass
  `DateLastRead`, and no visible bookmarks.
- `removed` rows with real-looking activity can duplicate kept rows. For
  example, `Siheyuan: Sign-in Starting from 1951` appears in `removed` and also
  in the Kobo account bucket.
- `DownloadUrl` is not a useful source marker in this snapshot because it is
  mostly the literal value `false`.
- A hard `file://`-only rule is too narrow. It would keep only 8 books and would
  discard meaningful Kobo account reading history.

## Recommended Default Behavior

The default book universe should include:

```sql
___UserID = '<real Kobo account user id>'
OR ___UserID = 'kepub_user'
OR ContentID LIKE 'file:%'
```

The default book universe should exclude:

```sql
___UserID = 'removed'
OR ___UserID IS NULL
OR TRIM(___UserID) = ''
```

Do not hardcode the Kobo account UUID as a permanent constant. Derive real Kobo
account user ids per snapshot as non-empty `___UserID` values excluding
`removed` and `kepub_user`. If multiple real account-like ids exist, keep all of
them.

Apply this default filter to all user-facing book queries:

- Dashboard totals, status counts, monthly completions, continue-reading, and
  most-read books.
- Library search, sort, filters, and pagination.
- Book detail lookup.
- Bookmark/highlight joins.
- Event/dictionary joins.
- Cover import and cover serving.

## Removed-Row Merge Rules

Never show `removed` rows as standalone books by default. Doing so would bring
back thousands of custom-server catalog entries.

Use `removed` rows only as supplemental history when they can be merged into a
kept canonical book with high confidence:

1. Prefer stable identifier matches when available, such as matching Kobo ids.
2. Otherwise allow exact normalized title plus exact normalized author matches.
3. Do not fuzzy-merge in v1.

When merging supplemental `removed` history:

- Preserve the kept book as the canonical row.
- Use supplemental values only when they improve the canonical book's reading
  state without contradicting stronger canonical data.
- Track counts for ignored custom rows, removed rows with activity, and merged
  removed-history rows so the UI can explain what happened.

Examples from the current snapshot:

- `Siheyuan: Sign-in Starting from 1951` can be considered mergeable because the
  `removed` row exactly matches a kept Kobo account title and author.
- `American Steam Locomotives: Design and Development, 1880-1960` should not be
  guessed as the same book as `American Steam Locomotives` in v1. That would
  require fuzzy title matching and should remain ignored unless a stable match
  is found.

## Covers

Cover support is feasible, but it should follow the same canonical-book filter.

Current snapshot evidence:

- 2,530 supported book rows have `ImageId`.
- The mounted Kobo has `.kobo-images` files with JPEG data stored in `.parsed`
  files.
- Cover presence alone does not mean a row is meaningful. Many custom/catalog
  rows also have image ids.

Recommended behavior:

- Import or serve covers only for kept canonical books.
- Copy cover assets into the local snapshot data directory during import so they
  still work after the Kobo is disconnected.
- Use neutral placeholders when no durable local cover exists.
- Do not use covers to decide whether a custom/catalog row should be shown.

## API and UI Recommendations

Backend:

- Add a source classifier for `kobo_store`, `sideloaded`, `custom_server`, and
  `catalog_noise`.
- Add `source_type` to book API payloads.
- Add dashboard/source summary counts: kept Kobo account rows, kept sideloaded
  rows, ignored custom/catalog rows, removed rows with activity, and merged
  removed-history rows.

Frontend:

- Show a compact snapshot note, for example:
  `237 books shown; 3,375 custom/catalog rows ignored`.
- Add a Library source filter for `All shown`, `Kobo store`, and `Sideloaded`.
- Show source badges in book detail.
- Do not add a separate custom-server view in v1.

## Testing Notes

Regression fixtures should cover:

- A real Kobo account row.
- A sideloaded `kepub_user` row.
- A `file://` row.
- A `removed` row with no activity.
- A `removed` row with activity that merges into a kept row.
- A `removed` row with activity that does not merge and remains hidden.
- A blank-user catalog row.

Expected behavior:

- Dashboard and library counts exclude `removed` and blank rows by default.
- Book detail returns only kept canonical rows.
- Highlights and events attached to ignored rows do not leak into visible counts.
- Mergeable `removed` activity can supplement a kept row, but never creates a
  standalone visible book.
