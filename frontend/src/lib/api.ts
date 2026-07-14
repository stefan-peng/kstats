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
  deviceStatus: () => request<DeviceStatus>("/api/device/status"),
  refresh: () => request<DeviceStatus>("/api/import", { method: "POST" }),
  dashboard: () => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    return request<DashboardData>(
      `/api/dashboard?timezone=${encodeURIComponent(timezone)}`,
    )
  },
  books: (query: URLSearchParams) =>
    request<BooksResponse>(`/api/books?${query.toString()}`),
  book: (contentId: string) => {
    const query = new URLSearchParams({
      content_id: contentId,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    return request<BookDetail>(`/api/book?${query.toString()}`)
  },
}
