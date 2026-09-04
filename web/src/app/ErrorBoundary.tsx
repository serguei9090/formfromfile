import { Component, type ErrorInfo, type ReactNode } from 'react'
import { toast } from './toast'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/** Catches render errors so one broken screen doesn't blank the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('render error', error, info.componentStack)
    toast(error.message || 'This page hit an error', 'error')
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-md p-10 text-center text-sm">
          <p className="mb-3 font-medium text-destructive">This page hit an error.</p>
          <button
            className="rounded-md border border-border px-3 py-1.5"
            onClick={() => {
              this.setState({ error: null })
              location.reload()
            }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
