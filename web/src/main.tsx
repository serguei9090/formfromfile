import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { App } from './App'
import { ErrorBoundary } from './app/ErrorBoundary'
import { Toaster } from './app/Toaster'
import { installGlobalErrorToasts } from './app/toast'

installGlobalErrorToasts()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
      <Toaster />
    </BrowserRouter>
  </StrictMode>,
)
