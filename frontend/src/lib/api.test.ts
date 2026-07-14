import { afterEach, expect, test, vi } from "vitest"
import { api } from "./api"

afterEach(() => {
  vi.unstubAllGlobals()
})

test("fails loudly when an error response is not valid JSON", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("not JSON", { status: 502 })),
  )

  await expect(api.dashboard()).rejects.toThrow(
    "Request failed with 502; invalid error response JSON",
  )
})

test("fails loudly when an error response has an invalid shape", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ message: "wrong field" }, { status: 502 })),
  )

  await expect(api.dashboard()).rejects.toThrow(
    "Request failed with 502; invalid error response shape",
  )
})
