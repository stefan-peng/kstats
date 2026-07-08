import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import type { DashboardData, DeviceStatus } from "@/types"
import { AppShell } from "./components/app-shell"
import { BookDetailDialog } from "./components/book-detail-dialog"
import { OverviewPage } from "./components/overview-page"

const DEVICE_STATUS_POLL_MS = 10_000

export default function App() {
  const [device, setDevice] = useState<DeviceStatus | null>(null)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [selectedBook, setSelectedBook] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshDeviceStatus = useCallback(async () => {
    const status = await api.deviceStatus()
    setDevice(status)
    return status
  }, [])

  const load = useCallback(async () => {
    const status = await refreshDeviceStatus()
    if (!status.snapshot_available) {
      setDashboard(null)
      setError("No Kobo snapshot is available yet.")
      return
    }
    setDashboard(await api.dashboard())
    setError(null)
  }, [refreshDeviceStatus])

  useEffect(() => {
    load()
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false))
  }, [load])

  useEffect(() => {
    const checkDeviceStatus = () => {
      void refreshDeviceStatus().catch(() => undefined)
    }
    const interval = window.setInterval(checkDeviceStatus, DEVICE_STATUS_POLL_MS)
    window.addEventListener("focus", checkDeviceStatus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", checkDeviceStatus)
    }
  }, [refreshDeviceStatus])

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
      await refreshDeviceStatus().catch(() => undefined)
      setError(message)
      toast.error(message)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <TooltipProvider>
      <AppShell device={device}>
        <OverviewPage
          dashboard={dashboard}
          device={device}
          loading={loading}
          refreshing={refreshing}
          error={error}
          onRefresh={refresh}
          onOpenBook={setSelectedBook}
        />
      </AppShell>
      <BookDetailDialog
        contentId={selectedBook}
        onOpenChange={(open) => !open && setSelectedBook(null)}
      />
      <Toaster richColors />
    </TooltipProvider>
  )
}
