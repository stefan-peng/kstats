/// <reference types="vite/client" />
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "next-themes"
import App from "./App"
import { startUsage } from "./lib/usage"
import "./styles.css"

const stopUsage = startUsage()
if (import.meta.hot) import.meta.hot.dispose(stopUsage)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <App />
    </ThemeProvider>
  </StrictMode>,
)

