import "@testing-library/jest-dom/vitest"

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
})

Object.defineProperties(Element.prototype, {
  hasPointerCapture: {
    value: () => false,
  },
  releasePointerCapture: {
    value: () => undefined,
  },
  scrollIntoView: {
    value: () => undefined,
  },
  setPointerCapture: {
    value: () => undefined,
  },
})

globalThis.ResizeObserver = class ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: {
            width: 800,
            height: 400,
            top: 0,
            right: 800,
            bottom: 400,
            left: 0,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          },
        } as ResizeObserverEntry,
      ],
      this,
    )
  }

  unobserve() {}
  disconnect() {}
}

const storageMap = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageMap.set(key, String(value))
  },
  removeItem: (key: string) => {
    storageMap.delete(key)
  },
  clear: () => {
    storageMap.clear()
  },
  key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
  get length() {
    return storageMap.size
  },
}

Object.defineProperty(window, "localStorage", {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
})

