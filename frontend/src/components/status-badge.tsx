import { Badge } from "@/components/ui/badge"
import type { ReadingStatus } from "@/types"

const labels: Record<ReadingStatus, string> = {
  unread: "Unread",
  reading: "In progress",
  finished: "Finished",
}

export function StatusBadge({ status }: { status: ReadingStatus }) {
  return (
    <Badge variant={status === "reading" ? "default" : "secondary"}>
      {labels[status]}
    </Badge>
  )
}

