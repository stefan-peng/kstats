import { useCallback, useEffect, useRef, useState } from "react"
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
  const previousConnectedRef = useRef<boolean | null>(null)
  const importInFlightRef = useRef(false)
  const statusCheckInFlightRef = useRef<Promise<void> | null>(null)
  const refreshVersionRef = useRef(0)
  const dashboardRef = useRef(dashboard)
  dashboardRef.current = dashboard

  const refreshDeviceStatus = useCallback(async () => {
    const status = await api.deviceStatus()
    previousConnectedRef.current = status.connected
    setDevice(status)
    return status
  }, [])

  const load = useCallback(async () => {
    const refreshVersion = refreshVersionRef.current
    const status = await refreshDeviceStatus()
    if (!status.snapshot_available) {
      setDashboard(null)
      setError("No Kobo snapshot is available yet.")
      return
    }
    const nextDashboard = await api.dashboard()
    if (refreshVersionRef.current !== refreshVersion) return
    setDashboard(nextDashboard)
    setError(null)
  }, [refreshDeviceStatus])

  useEffect(() => {
    load()
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false))
  }, [load])

  const refresh = useCallback(async () => {
    if (importInFlightRef.current) return

    refreshVersionRef.current += 1
    importInFlightRef.current = true
    setRefreshing(true)
    let status: DeviceStatus
    try {
      status = await api.refresh()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Refresh failed"
      await refreshDeviceStatus().catch(() => undefined)
      setError(message)
      if (dashboardRef.current) {
        toast.warning("Kobo import failed; using the previous snapshot")
      } else {
        toast.error(message)
      }
      importInFlightRef.current = false
      setRefreshing(false)
      return false
    }

    previousConnectedRef.current = status.connected
    setDevice(status)
    try {
      setDashboard(await api.dashboard())
      setError(null)
      toast.success("Kobo snapshot refreshed")
      return true
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to load reading data"
      setDashboard(null)
      setError(`Kobo snapshot imported, but reading data could not be loaded. ${message}`)
      toast.error("Kobo snapshot imported, but reading data could not be loaded")
      return null
    } finally {
      importInFlightRef.current = false
      setRefreshing(false)
    }
  }, [refreshDeviceStatus])

  const checkDeviceStatus = useCallback(() => {
    if (statusCheckInFlightRef.current) return statusCheckInFlightRef.current

    const check = (async () => {
      const wasDisconnected = previousConnectedRef.current === false
      const status = await refreshDeviceStatus()

      if (wasDisconnected && status.connected) {
        const refreshed = await refresh()
        if (refreshed === false) previousConnectedRef.current = false
      }
    })()
    const trackedCheck = check.finally(() => {
      if (statusCheckInFlightRef.current === trackedCheck) {
        statusCheckInFlightRef.current = null
      }
    })
    statusCheckInFlightRef.current = trackedCheck
    return trackedCheck
  }, [refresh, refreshDeviceStatus])

  useEffect(() => {
    const check = () => {
      void checkDeviceStatus().catch(() => undefined)
    }
    const interval = window.setInterval(check, DEVICE_STATUS_POLL_MS)
    window.addEventListener("focus", check)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", check)
    }
  }, [checkDeviceStatus])

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
