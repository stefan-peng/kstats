import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import "./styles.css"

describe("interactive cursor styles", () => {
  it("keeps interactive elements on a pointer cursor even with utility overrides", () => {
    const { container } = render(
      <>
        <button type="button">Action</button>
        <a href="/library">Library</a>
        <div data-interactive="true">
          <span className="cursor-default">Interactive row content</span>
        </div>
        <div role="button">Card</div>
        <div role="option" className="cursor-default">
          Option
        </div>
        <button type="button" disabled>
          Disabled
        </button>
        <div role="button" aria-disabled="true">
          Unavailable
        </div>
        <a href="/unavailable" aria-disabled="true">
          Unavailable link
        </a>
      </>,
    )

    const elements = container.children
    expect(getComputedStyle(elements[0]).cursor).toBe("pointer")
    expect(getComputedStyle(elements[1]).cursor).toBe("pointer")
    expect(getComputedStyle(elements[2]).cursor).toBe("pointer")
    expect(getComputedStyle(elements[2].firstElementChild!).cursor).toBe("pointer")
    expect(getComputedStyle(elements[3]).cursor).toBe("pointer")
    expect(getComputedStyle(elements[4]).cursor).toBe("pointer")
    expect(getComputedStyle(elements[5]).cursor).toBe("not-allowed")
    expect(getComputedStyle(elements[6]).cursor).toBe("not-allowed")
    expect(getComputedStyle(elements[7]).cursor).toBe("not-allowed")
  })
})
