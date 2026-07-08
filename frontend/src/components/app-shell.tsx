import type { ReactNode } from "react"
import { BookOpen, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { DeviceStatus } from "@/types"

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <BookOpen className="size-5" />
      </div>
      <span className="font-serif text-xl font-semibold">Kobo Stats</span>
    </div>
  )
}

export function AppShell({
  device,
  children,
}: {
  device: DeviceStatus | null
  children: ReactNode
}) {
  const { resolvedTheme, setTheme } = useTheme()
  const deviceLabel = !device
    ? "Checking Kobo"
    : device.connected
      ? "Kobo connected"
      : "Kobo disconnected"
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 md:px-8 lg:px-10">
          <Brand />
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 text-sm sm:flex">
              <span
                className={cn(
                  "size-2 rounded-full",
                  device?.connected ? "bg-primary" : "bg-muted-foreground",
                )}
              />
              <span className="font-medium">
                {deviceLabel}
              </span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Toggle theme"
                  onClick={() =>
                    setTheme(resolvedTheme === "dark" ? "light" : "dark")
                  }
                >
                  {resolvedTheme === "dark" ? <Sun /> : <Moon />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle theme</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>
      {children}
    </div>
  )
}
