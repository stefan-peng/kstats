/** Best-effort local usage counts. Never send DOM text, URLs, or field values. */
let running = false

export function trackUsage(name: string) {
  if (!running) return
  try {
    void fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, revision: "baseline-v1" }),
      keepalive: true,
    }).catch(() => undefined)
  } catch { /* Usage collection must never interrupt the app. */ }
}

export function startUsage() {
  if (running) return () => {}
  running = true
  trackUsage("app.open")
  const seen = new Set<string>()
  const timers = new Map<Element, ReturnType<typeof setTimeout>>()
  const visible = new Set<Element>()
  const dirtySearches = new WeakSet<Element>()
  const eligible = (element: Element) => document.visibilityState !== "hidden" &&
    (!document.querySelector('[role="dialog"]') || Boolean(element.closest('[role="dialog"]')))

  function schedule(element: Element) {
    const name = element.getAttribute("data-usage-view")
    if (!name || seen.has(name) || timers.has(element) || !eligible(element)) return
    timers.set(element, setTimeout(() => {
      timers.delete(element)
      if (!element.isConnected || !visible.has(element) || !eligible(element) || seen.has(name)) return
      seen.add(name)
      trackUsage(`seen.${name}`)
    }, 1000))
  }
  function reconcile() {
    for (const [element, timer] of timers) {
      if (!eligible(element) || !element.isConnected) {
        clearTimeout(timer)
        timers.delete(element)
      }
    }
    for (const element of visible) {
      if (!element.isConnected) visible.delete(element)
      else schedule(element)
    }
  }
  const observed = new Set<Element>()
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        visible.add(entry.target)
        schedule(entry.target)
      } else {
        visible.delete(entry.target)
        clearTimeout(timers.get(entry.target))
        timers.delete(entry.target)
      }
    }
  }, { threshold: 0.5 })
  function scan() {
    for (const element of observed) {
      if (!element.isConnected) {
        observer?.unobserve(element)
        observed.delete(element)
      }
    }
    document.querySelectorAll("[data-usage-view]").forEach((element) => {
      if (!observed.has(element)) {
        observed.add(element)
        observer?.observe(element)
      }
    })
    reconcile()
  }
  const mutations = new MutationObserver(scan)
  mutations.observe(document.body, { childList: true, subtree: true })
  scan()
  function click(event: Event) {
    const target = event.target instanceof Element ? event.target.closest("[data-usage-action]") : null
    if (!target || target.matches(':disabled, [aria-disabled="true"]')) return
    trackUsage(target.getAttribute("data-usage-action")!)
  }
  function keyboard(event: KeyboardEvent) {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return
    const target = event.target instanceof Element ? event.target : null
    // Native controls already emit click for keyboard activation.
    if (target?.matches('[role="button"][data-usage-action]:not(button):not(a):not(input)')) click(event)
  }
  function input(event: Event) {
    if (event.target instanceof Element && event.target.matches("[data-usage-search]")) dirtySearches.add(event.target)
  }
  function blur(event: Event) {
    const target = event.target
    if (target instanceof Element && dirtySearches.has(target)) {
      dirtySearches.delete(target)
      trackUsage(target.getAttribute("data-usage-search")!)
    }
  }
  document.addEventListener("click", click, true)
  document.addEventListener("keydown", keyboard, true)
  document.addEventListener("input", input, true)
  document.addEventListener("blur", blur, true)
  document.addEventListener("visibilitychange", reconcile)
  return () => {
    running = false
    observer?.disconnect()
    mutations.disconnect()
    timers.forEach(clearTimeout)
    document.removeEventListener("click", click, true)
    document.removeEventListener("keydown", keyboard, true)
    document.removeEventListener("input", input, true)
    document.removeEventListener("blur", blur, true)
    document.removeEventListener("visibilitychange", reconcile)
  }
}
