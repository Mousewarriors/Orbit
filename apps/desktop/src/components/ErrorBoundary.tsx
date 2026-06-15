import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly error: Error | null;
  readonly stack: string | null;
}

/**
 * Visible React error boundary.
 *
 * Without this, any uncaught error thrown while rendering the launcher or the
 * Settings tree unmounts the whole React subtree and paints a *silent blank
 * window* — exactly the failure mode that made a broken Settings route look like
 * an empty page. This catches the error, logs it for devtools, and renders a
 * legible fallback so a renderer crash can never be invisible again.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // `console.error` is allow-listed by the lint config and shows in devtools.
    console.error('[orbit] renderer error:', error, info.componentStack);
    this.setState({ stack: info.componentStack ?? null });
  }

  private reset = (): void => {
    this.setState({ error: null, stack: null });
  };

  override render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="orbit-error-boundary" role="alert">
        <h1 className="orbit-error-boundary-title">Something went wrong</h1>
        <p className="orbit-error-boundary-msg">{error.message || String(error)}</p>
        {stack && <pre className="orbit-error-boundary-stack">{stack.trim()}</pre>}
        <button type="button" className="orbit-error-boundary-retry" onClick={this.reset}>
          Try again
        </button>
      </div>
    );
  }
}
