export type ReadingStatus = "unread" | "reading" | "finished"

export interface DeviceStatus {
  connected: boolean
  snapshot_available: boolean
  imported_at: string | null
  source: string | null
}

export interface Book {
  content_id: string
  title: string
  author: string
  status: ReadingStatus
  reading_seconds: number
  percent_read: number
  date_last_read: string | null
  finished_at: string | null
  current_chapter_estimate_seconds: number
  rest_of_book_estimate_seconds: number
  remaining_seconds: number
  downloaded: boolean
  word_count: number | null
  series: string | null
  series_number: string | null
  publisher: string | null
  language: string | null
  isbn: string | null
  description: string | null
  mime_type: string
  bookmark_count: number
  cover_url: string | null
}

export interface Bookmark {
  id: string
  text: string | null
  annotation: string | null
  type: string | null
  created_at: string | null
  chapter_progress: number
  color: number
}

export interface DictionaryLookup {
  word: string
  dictionary: string | null
}

export interface BookDetail extends Book {
  bookmarks: Bookmark[]
  dictionary_lookups: DictionaryLookup[]
  data_source: {
    snapshot_path: string
    read_only: boolean
  }
}

export interface DashboardData {
  totals: {
    library: number
    finished: number
    reading: number
    reading_seconds: number
  }
  status_counts: Record<ReadingStatus, number>
  monthly_completions: Array<{ month: string; count: number }>
  continue_reading: Book[]
  top_books: Book[]
}

export interface BooksResponse {
  items: Book[]
  page: number
  page_size: number
  total: number
  pages: number
  filter_options: {
    series: string[]
    publishers: string[]
    languages: string[]
  }
}
