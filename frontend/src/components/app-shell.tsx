import { useState, type ReactNode } from "react"
import { BarChart3, BookOpen, Library, Menu, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { DeviceStatus } from "@/types"

export type Page = "overview" | "library"

function Navigation({
  page,
  onPageChange,
  onNavigate,
}: {
  page: Page
  onPageChange: (page: Page) => void
  onNavigate?: () => void
}) {
  const items = [
    { value: "overview" as const, label: "Overview", icon: BarChart3 },
    { value: "library" as const, label: "Library", icon: Library },
  ]
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => (
        <Button
          key={item.value}
          variant={page === item.value ? "secondary" : "ghost"}
          className={cn("justify-start", page === item.value && "text-primary")}
          onClick={() => {
            onPageChange(item.value)
            onNavigate?.()
          }}
        >
          <item.icon data-icon="inline-start" />
          {item.label}
        </Button>
      ))}
    </nav>
  )
}

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
  page,
  onPageChange,
  device,
  children,
}: {
  page: Page
  onPageChange: (page: Page) => void
  device: DeviceStatus | null
  children: ReactNode
}) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r bg-sidebar p-5 lg:flex">
        <Brand />
        <div className="mt-10">
          <Navigation page={page} onPageChange={onPageChange} />
        </div>
        <div className="mt-auto flex items-center gap-3 rounded-lg border bg-background/50 p-3">
          <span
            className={cn(
              "size-2 rounded-full",
              device?.connected ? "bg-primary" : "bg-muted-foreground",
            )}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {device?.connected ? "Connected" : "Using snapshot"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {device?.snapshot_available ? "Kobo library available" : "No import yet"}
            </p>
          </div>
        </div>
      </aside>

      <div className="lg:pl-60">
        <div className="sticky top-0 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden">
          <Brand />
          <div className="flex items-center gap-1">
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
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open navigation">
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Kobo Stats</SheetTitle>
                  <SheetDescription>Reading dashboard navigation</SheetDescription>
                </SheetHeader>
                <div className="mt-6">
                  <Navigation
                    page={page}
                    onPageChange={onPageChange}
                    onNavigate={() => setMobileOpen(false)}
                  />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
