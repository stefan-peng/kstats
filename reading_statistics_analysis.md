# Kobo Native Reader Reading Statistics Analysis

Your plugged-in Kobo stores reading telemetry and metadata locally in `.kobo/KoboReader.sqlite` on the mounted device. By querying this database, we can extract book-level metrics, aggregated session telemetry, word lookup history, highlights, and annotations.

> [!NOTE]
> There is a significant difference in telemetry between standard EPUB files (`.epub`) and Kobo EPUB files (`.kepub.epub` or official store purchases). Detailed page-turn timestamps and session tracking are **only** generated for Kepub/Kobo EPUB files.

---

## 1. Book-Level Reading Statistics (`content` Table)

The `content` table contains records for all books and their individual chapters/sections. The main book record (identified by `ContentType = 6`) contains the overall reading status and aggregated time:

### Key Columns

| Column Name | Data Type | Description |
| :--- | :--- | :--- |
| `Title` | `TEXT` | Book title |
| `Attribution` | `TEXT` | Author |
| `ReadStatus` | `INTEGER` | `0` = Unread, `1` = Reading (In Progress), `2` = Finished (Read) |
| `TimeSpentReading` | `INTEGER` | Total time spent reading the book (in seconds) |
| `___PercentRead` | `INTEGER` | Percentage progress through the book (`0` to `100`) |
| `TimesStartedReading` | `INTEGER` | Number of times the book was opened/started |
| `DateLastRead` | `TEXT` | ISO-8601 timestamp of when the book was last read |
| `LastTimeStartedReading` | `TEXT` | Start time of the last reading session |
| `LastTimeFinishedReading`| `TEXT` | End time of the last reading session |
| `WordCount` | `INTEGER` | Total words in the book (often `-1` for sideloaded EPUBs, but populated for Kepubs) |

---

## 2. Granular Session and Telemetry Logs (`Event` Table)

For Kobo EPUBs (`.kepub.epub`), the reader logs extremely granular telemetry in the `Event` table. The `ExtraData` column is serialized in **Qt's QDataStream QVariant/QVariantMap binary format**. By decoding this binary data, we can access the following events:

### Event Type Map

| Event Type | Event Name / Category | Extracted Data Fields in `ExtraData` |
| :--- | :--- | :--- |
| **`3`** & **`46`** | **Aggregated reading telemetry** | • `ExtraDataReadingSeconds`: Total tracked duration represented by the row (seconds)<br>• `ExtraDataReadingSessions`: Number of sessions represented by the row<br>• `wordsRead`: Number of words read<br>• `PagesTurnedThisSession`: Page-turn count<br>• `StartPercentage`: Progress when tracking started<br>• `Orientation`: Device orientation (`Portrait`, `Landscape`)<br>• `eventTimestamps`: Unix timestamps for recorded reading interactions/page turns. |
| **`9`** | **Dictionary Lookup** | • `Word`: The exact word looked up (e.g., `disembarked`, `Ruthenians`)<br>• `DictionaryName`: The dictionary code used (e.g., `-en` for English)<br>• `eventTimestamps`: Timestamp of the lookup |
| **`1012`** | **25% Milestone** | GA4 progress event at 25% |
| **`1013`** | **50% Milestone** | GA4 progress event at 50% |
| **`1014`** | **75% Milestone** | GA4 progress event at 75% |
| **`5`** | **Mark as Finished** | Records when the book is marked as finished (`IsMarkAsFinished`: `True`/`False`) |
| **`6`** | **Page-Turn Method** | Records the physical method used to turn the page (`Method`: `finger` or physical button) |

---

## 3. Highlights, Bookmarks, & Annotations (`Bookmark` Table)

Every highlight, bookmark, and text annotation you make is logged in the `Bookmark` table.

### Key Columns

| Column Name | Data Type | Description |
| :--- | :--- | :--- |
| `Text` | `TEXT` | The highlighted text snippet from the book |
| `Annotation` | `TEXT` | Any typed note or annotation attached to the highlight |
| `Type` | `TEXT` | Type of bookmark (e.g., `highlight`, `bookmark`) |
| `DateCreated` | `TEXT` | Timestamp when the highlight was created |
| `ChapterProgress` | `REAL` | Progress position inside the current chapter (`0.0` to `1.0`) |
| `Color` | `INTEGER` | Highlight color code (for devices with color screens or synced apps) |

---

## 4. UI Navigation Telemetry (`AnalyticsEvents` Table)

The reader tracks how you navigate Nickel (the native Kobo OS). This includes:
- **`AppStart`**: When the device wakes up or boots.
- **`MyBooks`**: When you browse the library.
- **`OpenContent`**: Logs which book you opened, its format (`application/x-kobo-epub+zip`), monetization status (`Paid`, `Free`), orientation, and source.

---

## 5. Other Database Files

- **`BookReader.sqlite`**: This file is located in the `.kobo` directory but is typically encrypted/obscured by Kobo's DRM system (Adobe RMSDK) and cannot be opened as a standard SQLite database. It does not store user-facing reading statistics.

---

## 6. Reading-Duration Timeline Verification

Verified against the local snapshot imported on **2026-07-13**:

| Check | Event type `3` | Event type `46` |
| :--- | ---: | ---: |
| Rows | 133 | 227 |
| Rows with reading seconds and session count | 111 | 128 |
| Decoding failures | 0 | 0 |
| Reported reading sessions | 561 | 588 |
| Reported reading seconds | 166,583 | 169,673 |
| Duration rows spanning more than one UTC day | 36 | 22 |

The two event types are not independent sources. There are **123 rows with the same content ID and last-occurrence timestamp**, and their reading-second and session-count values agree where those fields are present. Adding types `3` and `46` would therefore double-count most tracked reading. Type `46` also includes Pocket/Instapaper activity, while type `3` is the cleaner starting point for the app's book-only statistics.

All 111 type `3` duration rows have interaction timestamps, covering **2026-05-17 through 2026-07-13** in this snapshot. The current canonical book records contain 250,574 cumulative reading seconds. Event type `3` accounts for 166,583 seconds, or about **66.5%** of that total. The difference is expected because `content.TimeSpentReading` is a lifetime cumulative value, while event retention and detailed telemetry coverage are more limited. Detailed events should not be presented as complete lifetime history.

### What can be charted reliably

- Total duration represented by a decoded telemetry row is reliable enough to use after validating its field types and excluding duplicate event streams.
- The interaction timestamps reliably identify the dates on which recorded reading activity occurred.
- Weekly and monthly activity trends can be estimated from these fields, with better practical stability than daily values.

### What cannot be recovered exactly

An event row can represent several sessions over several days. It supplies one aggregate duration and a list of interaction timestamps, but it does not map an exact duration to each individual session or day. Splitting each type `3` row into its reported number of sessions at the largest timestamp gaps produced a median inferred/reported duration ratio of about **0.978**, but only 56 of 111 rows were within 10% or 60 seconds of the reported duration. This is useful distribution evidence, not an exact reconstruction. Assigning the whole duration to `ExtraDataDateCreated` or `LastOccurrence` would also misattribute multi-day rows.

Any historical duration chart derived from the current database should therefore be labeled as **estimated from Kobo session telemetry**, especially at daily granularity. An exact-duration total and an estimated date distribution can coexist: allocate each row's reported duration across inferred activity sessions/dates while preserving the row total.

For better data going forward, imports can persist telemetry deltas between snapshots. That will narrow each new duration increment to the interval since the previous import, although imports that occur less than daily still cannot create exact daily history by themselves.
