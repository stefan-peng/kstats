import { render, screen } from "@testing-library/react"
import { expect, test } from "vitest"
import { FormattedText } from "./formatted-text"

test("rejects root-relative links that resolve to another origin", () => {
  render(<FormattedText>{'<a href="/\\evil.example">Unsafe</a> <a href="/\t/evil.example">Tab</a> <a href="/library">Library</a>'}</FormattedText>)

  expect(screen.queryByRole("link", { name: "Unsafe" })).not.toBeInTheDocument()
  expect(screen.queryByRole("link", { name: "Tab" })).not.toBeInTheDocument()
  expect(document.body).toHaveTextContent("Unsafe Tab Library")
  expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("href", "/library")
})
