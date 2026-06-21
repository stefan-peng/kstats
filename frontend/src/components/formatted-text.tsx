import { Fragment, type ReactNode } from "react"

const blockedTags = new Set([
  "iframe",
  "object",
  "script",
  "style",
  "svg",
  "template",
])

function safeHref(value: string): string | undefined {
  const href = value.trim()
  if (
    (href.startsWith("/") && !href.startsWith("//")) ||
    href.startsWith("#") ||
    /^(https?:|mailto:)/i.test(href)
  ) {
    return href
  }
  return undefined
}

function renderNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null
  }

  const element = node as Element
  const tag = element.tagName.toLowerCase()
  if (blockedTags.has(tag)) {
    return null
  }

  const children = Array.from(element.childNodes).map((child, index) =>
    renderNode(child, `${key}-${index}`),
  )

  switch (tag) {
    case "p":
      return <p key={key}>{children}</p>
    case "strong":
    case "b":
      return <strong key={key}>{children}</strong>
    case "em":
    case "i":
      return <em key={key}>{children}</em>
    case "br":
      return <br key={key} />
    case "ul":
      return (
        <ul key={key} className="list-disc pl-5">
          {children}
        </ul>
      )
    case "ol":
      return (
        <ol key={key} className="list-decimal pl-5">
          {children}
        </ol>
      )
    case "li":
      return <li key={key}>{children}</li>
    case "blockquote":
      return (
        <blockquote key={key} className="border-l-2 pl-4 italic">
          {children}
        </blockquote>
      )
    case "a": {
      const href = safeHref(element.getAttribute("href") ?? "")
      return href ? (
        <a
          key={key}
          className="underline underline-offset-4"
          href={href}
          rel="noreferrer"
          target={href.startsWith("http") ? "_blank" : undefined}
        >
          {children}
        </a>
      ) : (
        <Fragment key={key}>{children}</Fragment>
      )
    }
    default:
      return <Fragment key={key}>{children}</Fragment>
  }
}

export function FormattedText({ children }: { children: string }) {
  const document = new DOMParser().parseFromString(children, "text/html")

  return (
    <div className="flex flex-col gap-3 text-sm leading-6 text-muted-foreground">
      {Array.from(document.body.childNodes).map((node, index) =>
        renderNode(node, String(index)),
      )}
    </div>
  )
}
