# Kobo Native Reader Reading Statistics Analysis

Your plugged-in Kobo stores reading telemetry and metadata locally in a SQLite database at `/Volumes/KOBOeReader/.kobo/KoboReader.sqlite`. By querying this database, we can extract book-level metrics, session-level reading logs, word lookup history, highlights, and annotations.

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
| **`3`** & **`46`** | **Reading Session** | • `ExtraDataReadingSeconds`: Duration of the reading session (seconds)<br>• `wordsRead`: Number of words read in the session<br>• `PagesTurnedThisSession`: Count of page turns<br>• `StartPercentage`: Progress % when session started<br>• `Orientation`: Device orientation (`Portrait`, `Landscape`)<br>• `eventTimestamps`: A list of Unix epoch timestamps recording **the exact second of every page turn** in the session. |
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
