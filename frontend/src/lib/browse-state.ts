import { useMemo, useSyncExternalStore } from "react"

export const browseDefaults = {
  search: "",
  status: "all",
  availability: "all",
  source: "all",
  highlights: "all",
  series: "all",
  publisher: "all",
  language: "all",
  page: 1,
  sort: "last_read",
  direction: "desc",
  month: "",
  book: "",
}
export type BrowseState = typeof browseDefaults
const changeEvent = "kstats:browse"

function choice(value: string | null, values: string[], fallback: string) {
  return value && values.includes(value) ? value : fallback
}

export function parseBrowseState(search: string): BrowseState {
  const params = new URLSearchParams(search)
  const page = Number(params.get("page") ?? 1)
  const month = params.get("month") ?? ""
  return {
    search: params.get("search") ?? "",
    status: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
      ? "all" : choice(params.get("status"), ["all", "unread", "reading", "finished"], "all"),
    availability: choice(params.get("availability"), ["all", "downloaded", "cloud"], "all"),
    source: choice(params.get("source"), ["all", "kobo_store", "sideloaded"], "all"),
    highlights: choice(params.get("highlights"), ["all", "with", "without"], "all"),
    series: params.get("series") || "all",
    publisher: params.get("publisher") || "all",
    language: params.get("language") || "all",
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1_000_000) : 1,
    sort: choice(params.get("sort"), ["title", "status", "progress", "reading_time", "remaining_time", "last_read", "highlights"], "last_read"),
    direction: choice(params.get("direction"), ["asc", "desc"], "desc"),
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : "",
    book: params.get("book") ?? "",
  }
}

export function updateBrowseState(patch: Partial<BrowseState>, mode: "push" | "replace" = "push") {
  const url = new URL(window.location.href)
  for (const key of Object.keys(patch) as Array<keyof BrowseState>) {
    const value = patch[key]
    if (value === undefined) continue
    if (value === browseDefaults[key]) url.searchParams.delete(key)
    else url.searchParams.set(key, String(value))
  }
  if (url.href === window.location.href) return
  if (mode === "replace") window.history.replaceState(null, "", url)
  else window.history.pushState(null, "", url)
  window.dispatchEvent(new Event(changeEvent))
}

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback)
  window.addEventListener(changeEvent, callback)
  return () => {
    window.removeEventListener("popstate", callback)
    window.removeEventListener(changeEvent, callback)
  }
}

export function useBrowseState() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "")
  return useMemo(() => parseBrowseState(search), [search])
}

export function useBrowseValue<Key extends keyof BrowseState>(key: Key): BrowseState[Key] {
  return useSyncExternalStore(
    subscribe,
    () => parseBrowseState(window.location.search)[key],
    () => browseDefaults[key],
  )
}

export function focusLibrary() {
  const heading = document.getElementById("library-heading")
  heading?.focus({ preventScroll: true })
  heading?.scrollIntoView({ block: "start" })
}
