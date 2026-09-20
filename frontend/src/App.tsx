import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { updateBrowseState, useBrowseValue } from "@/lib/browse-state"
import { api } from "@/lib/api"
import type { DashboardData, DeviceStatus } from "@/types"
import { AppShell } from "./components/app-shell"
import { BookDetailDialog } from "./components/book-detail-dialog"
import { OverviewPage } from "./components/overview-page"

const DEVICE_STATUS_POLL_MS = 5_000

function snapshotVersion(status: DeviceStatus) {
  return JSON.stringify([status.snapshot_available, status.imported_at, status.source])
}

function sameDeviceStatus(left: DeviceStatus | null, right: DeviceStatus) {
  return left !== null &&
    left.connected === right.connected &&
    left.snapshot_available === right.snapshot_available &&
    left.imported_at === right.imported_at &&
    left.source === right.source &&
    left.importing === right.importing &&
    left.import_error === right.import_error
}

function isAbortError(reason: unknown) {
  return reason instanceof Error && reason.name === "AbortError"
}

export default function App() {
  const [connectionError, setConnectionError] = useState(false)
  const lastCheckedRef = useRef<string | null>(null)
  const [device, setDevice] = useState<DeviceStatus | null>(null)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const selectedBook = useBrowseValue("book")
  const setSelectedBook = useCallback((book: string | null) => updateBrowseState({ book: book ?? "" }), [])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importFailure, setImportFailure] = useState(false)
  const loadedSnapshotRef = useRef<string | null>(null)
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
    try {
      const status = await api.deviceStatus(signal)
      if (statusVersionRef.current !== statusVersion || signal?.aborted) return status
      lastCheckedRef.current = new Date().toISOString()
      setConnectionError(false)
      setDevice((current) => (sameDeviceStatus(current, status) ? current : status))
      return status
    } catch (reason) {
      if (statusVersionRef.current === statusVersion && !signal?.aborted && !isAbortError(reason)) {
        setConnectionError(true)
      }
      throw reason
    }
  }, [])

  const load = useCallback(async (signal?: AbortSignal) => {
    const refreshVersion = ++refreshVersionRef.current
    try {
      const status = await refreshDeviceStatus(signal)
      if (refreshVersionRef.current !== refreshVersion || signal?.aborted) return
      setImportFailure(Boolean(status.import_error))
      if (!status.snapshot_available) {
        setDashboard(null)
        loadedSnapshotRef.current = null
        setError(status.import_error || "No Kobo snapshot is available yet.")
        return
      }
      if (loadedSnapshotRef.current === snapshotVersion(status)) {
        setError(status.import_error || null)
        return
      }
      let nextDashboard: DashboardData
      try {
        nextDashboard = await api.dashboard(signal)
      } catch (reason) {
        if (refreshVersionRef.current === refreshVersion && !signal?.aborted) {
          setImportFailure(false)
          setError(`Unable to load the latest snapshot. ${reason instanceof Error ? reason.message : "Reading data request failed"}`)
        }
        return
      }
      if (refreshVersionRef.current !== refreshVersion || signal?.aborted) return
      setDashboard(nextDashboard)
      loadedSnapshotRef.current = snapshotVersion(status)
      setError(status.import_error || null)
    } catch (reason) {
      if (refreshVersionRef.current === refreshVersion && !signal?.aborted) throw reason
    }
  }, [refreshDeviceStatus])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
      .catch((reason: Error) => {
        if (!controller.signal.aborted && !isAbortError(reason)) setError(reason.message)
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
    let imported = false
    try {
      const status = await api.refresh(controller.signal)
      if (controller.signal.aborted) return
      imported = true
      statusVersionRef.current += 1
      lastCheckedRef.current = new Date().toISOString()
      setConnectionError(false)
      setDevice(status)
      const nextDashboard = await api.dashboard(controller.signal)
      if (controller.signal.aborted) return
      setDashboard(nextDashboard)
      loadedSnapshotRef.current = snapshotVersion(status)
      setError(null)
      setImportFailure(false)
      toast.success("Kobo snapshot refreshed")
    } catch (reason) {
      if (controller.signal.aborted || isAbortError(reason)) return
      const message = reason instanceof Error ? reason.message : "Refresh failed"
      if (imported) {
        setImportFailure(false)
        setDashboard(null)
        loadedSnapshotRef.current = null
        setError(`Kobo snapshot imported, but reading data could not be loaded. ${message}`)
        toast.error("Kobo snapshot imported, but reading data could not be loaded")
      } else {
        await refreshDeviceStatus(controller.signal).catch(() => undefined)
        if (controller.signal.aborted) return
        setError(message)
        setImportFailure(true)
        if (dashboardRef.current) {
          toast.warning("Kobo import failed; using the previous snapshot")
        } else {
          toast.error(message)
        }
      }
    } finally {
      importInFlightRef.current = false
      if (refreshAbortRef.current === controller) refreshAbortRef.current = null
      if (!controller.signal.aborted) setRefreshing(false)
    }
  }, [refreshDeviceStatus])

  const checkDeviceStatus = useCallback(() => {
    if (importInFlightRef.current) return Promise.resolve()
    if (statusCheckInFlightRef.current) return statusCheckInFlightRef.current

    const controller = new AbortController()
    statusAbortRef.current = controller
    const check = load(controller.signal)
    const trackedCheck = check.finally(() => {
      if (statusCheckInFlightRef.current === trackedCheck) {
        statusCheckInFlightRef.current = null
        statusAbortRef.current = null
      }
    })
    statusCheckInFlightRef.current = trackedCheck
    return trackedCheck
  }, [load])

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
      <AppShell device={device} connectionError={connectionError} lastChecked={lastCheckedRef.current}>
        <OverviewPage
          dashboard={dashboard}
          device={device}
          loading={loading}
          refreshing={refreshing}
          error={error}
          importFailure={importFailure}
          onRefresh={refresh}
          onOpenBook={setSelectedBook}
        />
      </AppShell>
      <BookDetailDialog
        key={device?.imported_at}
        contentId={selectedBook || null}
        onOpenChange={(open) => !open && setSelectedBook(null)}
      />
      <Toaster richColors />
    </TooltipProvider>
  )
}
