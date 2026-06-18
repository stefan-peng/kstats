import type {
  BookDetail,
  BooksResponse,
  DashboardData,
  DeviceStatus,
} from "@/types"

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.detail ?? `Request failed with ${response.status}`)
  }
  return response.json() as Promise<T>
}

export const api = {
  deviceStatus: () => request<DeviceStatus>("/api/device/status"),
  refresh: () => request<DeviceStatus>("/api/import", { method: "POST" }),
  dashboard: () => request<DashboardData>("/api/dashboard"),
  books: (query: URLSearchParams) =>
    request<BooksResponse>(`/api/books?${query.toString()}`),
  book: (contentId: string) =>
    request<BookDetail>(`/api/book?content_id=${encodeURIComponent(contentId)}`),
}

