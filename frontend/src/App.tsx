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

function sameDeviceStatus(left: DeviceStatus | null, right: DeviceStatus) {
  return left !== null &&
    left.connected === right.connected &&
    left.snapshot_available === right.snapshot_available &&
    left.imported_at === right.imported_at &&
    left.source === right.source
}

function isAbortError(reason: unknown) {
  return reason instanceof Error && reason.name === "AbortError"
}

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
  const statusAbortRef = useRef<AbortController | null>(null)
  const refreshAbortRef = useRef<AbortController | null>(null)
  const statusVersionRef = useRef(0)
  const refreshVersionRef = useRef(0)
  const dashboardRef = useRef(dashboard)
  dashboardRef.current = dashboard

  const refreshDeviceStatus = useCallback(async (signal?: AbortSignal) => {
    const statusVersion = ++statusVersionRef.current
    const status = await api.deviceStatus(signal)
    if (statusVersionRef.current !== statusVersion || signal?.aborted) return status
    previousConnectedRef.current = status.connected
    setDevice((current) => (sameDeviceStatus(current, status) ? current : status))
    return status
  }, [])

  const load = useCallback(async (signal?: AbortSignal) => {
    const refreshVersion = refreshVersionRef.current
    const status = await refreshDeviceStatus(signal)
    if (refreshVersionRef.current !== refreshVersion || signal?.aborted) return
    if (!status.snapshot_available) {
      setDashboard(null)
      setError("No Kobo snapshot is available yet.")
      return
    }
    const nextDashboard = await api.dashboard(signal)
    if (refreshVersionRef.current !== refreshVersion || signal?.aborted) return
    setDashboard(nextDashboard)
    setError(null)
  }, [refreshDeviceStatus])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
      .catch((reason: Error) => {
        if (!isAbortError(reason)) setError(reason.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [load])

  const refresh = useCallback(async () => {
    if (importInFlightRef.current) return

    refreshVersionRef.current += 1
    statusVersionRef.current += 1
    statusAbortRef.current?.abort()
    importInFlightRef.current = true
    setRefreshing(true)
    const controller = new AbortController()
    refreshAbortRef.current = controller
    let status: DeviceStatus
    try {
      status = await api.refresh(controller.signal)
    } catch (reason) {
      if (isAbortError(reason)) {
        importInFlightRef.current = false
        if (refreshAbortRef.current === controller) refreshAbortRef.current = null
        return false
      }
      const message = reason instanceof Error ? reason.message : "Refresh failed"
      await refreshDeviceStatus(controller.signal).catch(() => undefined)
      setError(message)
      if (dashboardRef.current) {
        toast.warning("Kobo import failed; using the previous snapshot")
      } else {
        toast.error(message)
      }
      importInFlightRef.current = false
      if (refreshAbortRef.current === controller) refreshAbortRef.current = null
      setRefreshing(false)
      return false
    }

    statusVersionRef.current += 1
    previousConnectedRef.current = status.connected
    setDevice(status)
    try {
      setDashboard(await api.dashboard(controller.signal))
      setError(null)
      toast.success("Kobo snapshot refreshed")
      return true
    } catch (reason) {
      if (isAbortError(reason)) return false
      const message = reason instanceof Error ? reason.message : "Unable to load reading data"
      setDashboard(null)
      setError(`Kobo snapshot imported, but reading data could not be loaded. ${message}`)
      toast.error("Kobo snapshot imported, but reading data could not be loaded")
      return null
    } finally {
      importInFlightRef.current = false
      if (refreshAbortRef.current === controller) {
        refreshAbortRef.current = null
      }
      if (!controller.signal.aborted) setRefreshing(false)
    }
  }, [refreshDeviceStatus])

  const checkDeviceStatus = useCallback(() => {
    if (statusCheckInFlightRef.current) return statusCheckInFlightRef.current

    const check = (async () => {
      const controller = new AbortController()
      statusAbortRef.current = controller
      const wasDisconnected = previousConnectedRef.current === false
      const status = await refreshDeviceStatus(controller.signal)

      if (!controller.signal.aborted && wasDisconnected && status.connected) {
        const refreshed = await refresh()
        if (refreshed === false) previousConnectedRef.current = false
      }
    })()
    const trackedCheck = check.finally(() => {
      if (statusCheckInFlightRef.current === trackedCheck) {
        statusCheckInFlightRef.current = null
        statusAbortRef.current = null
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
      statusAbortRef.current?.abort()
      refreshAbortRef.current?.abort()
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
