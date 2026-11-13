import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Stops a crash in one part of the app from blanking the rest — most importantly, a broken
 * feature must never take down the Show screen on a Sunday.
 *
 *   <ErrorBoundary name="Timers" compact>…</ErrorBoundary>
 *
 * `resetKey`: when it changes (e.g. the selected view), the boundary tries again.
 */
export class ErrorBoundary extends Component<{ name?: string; compact?: boolean; resetKey?: unknown; children: ReactNode; fallback?: (error: Error, retry: () => void) => ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn(`[ui] ${this.props.name ?? 'A part of the app'} crashed:`, error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: unknown }): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  retry = (): void => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.retry)
    const name = this.props.name ?? 'This part of the app'
    return (
      <div className={`crash ${this.props.compact ? 'compact' : ''}`} role="alert" data-testid="crash">
        <div className="crash-card">
          <h3>{name} hit a problem</h3>
          {!this.props.compact && <div className="dim">What is on screen is not affected, and the rest of the app still works. You can try again, or carry on and tell your tech lead after the service.</div>}
          <pre>{String(error?.message ?? error)}</pre>
          <div className="row"><button type="button" className="btn sm" onClick={this.retry}>Try again</button></div>
        </div>
      </div>
    )
  }
}
