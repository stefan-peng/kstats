export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

export function formatDate(value: string | null): string {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

export function formatMonth(value: string): string {
  const [year, month] = value.split("-").map(Number)
  return new Intl.DateTimeFormat(undefined, { month: "short" }).format(
    new Date(year, month - 1, 1),
  )
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}
