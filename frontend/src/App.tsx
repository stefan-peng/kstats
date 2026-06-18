import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import type { DashboardData, DeviceStatus } from "@/types"
import { AppShell, type Page } from "./components/app-shell"
import { BookDetailDialog } from "./components/book-detail-dialog"
import { LibraryPage } from "./components/library-page"
import { OverviewPage } from "./components/overview-page"

export default function App() {
  const [page, setPage] = useState<Page>("overview")
  const [device, setDevice] = useState<DeviceStatus | null>(null)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [selectedBook, setSelectedBook] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const status = await api.deviceStatus()
    setDevice(status)
    if (!status.snapshot_available) {
      setDashboard(null)
      setError("No Kobo snapshot is available yet.")
      return
    }
    setDashboard(await api.dashboard())
    setError(null)
  }, [])

  useEffect(() => {
    load()
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false))
  }, [load])

  async function refresh() {
    setRefreshing(true)
    try {
      const status = await api.refresh()
      setDevice(status)
      setDashboard(await api.dashboard())
      setError(null)
      toast.success("Kobo snapshot refreshed")
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Refresh failed"
      setError(message)
      toast.error(message)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <TooltipProvider>
      <AppShell page={page} onPageChange={setPage} device={device}>
        {page === "overview" ? (
          <OverviewPage
            dashboard={dashboard}
            device={device}
            loading={loading}
            refreshing={refreshing}
            error={error}
            onRefresh={refresh}
            onOpenBook={setSelectedBook}
            onOpenLibrary={() => setPage("library")}
          />
        ) : (
          <LibraryPage onOpenBook={setSelectedBook} />
        )}
      </AppShell>
      <BookDetailDialog
        contentId={selectedBook}
        onOpenChange={(open) => !open && setSelectedBook(null)}
      />
      <Toaster richColors />
    </TooltipProvider>
  )
}

