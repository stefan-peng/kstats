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
  times_started: number
  date_last_read: string | null
  last_started_at: string | null
  finished_at: string | null
  downloaded: boolean
  word_count: number | null
  series: string | null
  series_number: string | null
  publisher: string | null
  description: string | null
  mime_type: string
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

export interface BookDetail extends Book {
  bookmarks: Bookmark[]
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
}
