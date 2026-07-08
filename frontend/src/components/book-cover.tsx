import { BookOpen } from "lucide-react"
import { cn } from "@/lib/utils"

export function BookCover({
  title,
  coverUrl,
  className,
}: {
  title: string
  coverUrl: string | null
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex aspect-[2/3] shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground",
        className,
      )}
      aria-label={`${title} cover`}
    >
      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <BookOpen className="size-5" aria-hidden="true" />
      )}
    </div>
  )
}
