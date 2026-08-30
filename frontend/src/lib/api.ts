import type {
  BookDetail,
  BooksResponse,
  DashboardData,
  DeviceStatus,
} from "@/types"

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    let payload: unknown
    try {
      payload = await response.json()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      throw new Error(
        `Request failed with ${response.status}; invalid error response JSON: ${message}`,
        { cause: reason },
      )
    }
    if (
      typeof payload === "object" &&
      payload !== null &&
      "detail" in payload &&
      typeof payload.detail === "string"
    ) {
      throw new Error(payload.detail)
    }
    throw new Error(`Request failed with ${response.status}; invalid error response shape`)
  }
  return response.json() as Promise<T>
}

export const api = {
  deviceStatus: (signal?: AbortSignal) =>
    request<DeviceStatus>("/api/device/status", { signal }),
  refresh: (signal?: AbortSignal) =>
    request<DeviceStatus>("/api/import", { method: "POST", signal }),
  dashboard: (signal?: AbortSignal) => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    return request<DashboardData>(
      `/api/dashboard?timezone=${encodeURIComponent(timezone)}`,
      { signal },
    )
  },
  books: (query: URLSearchParams, signal?: AbortSignal) =>
    request<BooksResponse>(`/api/books?${query.toString()}`, { signal }),
  book: (contentId: string, signal?: AbortSignal) => {
    const query = new URLSearchParams({
      content_id: contentId,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    return request<BookDetail>(`/api/book?${query.toString()}`, { signal })
  },
}
