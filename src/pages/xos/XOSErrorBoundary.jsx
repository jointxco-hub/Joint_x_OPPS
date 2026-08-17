import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

// Route-level error boundary for XOS module pages, mirroring
// RouteErrorBoundary's pattern (components/common/RouteErrorBoundary.jsx)
// but scoped to the XOS visual language and offering a way back to
// Overview - one broken module (e.g. Files) must not blank the whole
// workspace or strand the client with only a reload button.
export default class XOSErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error?.message || 'Unknown render error' };
  }

  componentDidCatch(error, info) {
    console.error(`[XOSErrorBoundary] ${this.props.pageName || 'Module'} failed to render`, error?.message || error);
    if (import.meta.env.DEV) {
      console.error('stack:', error?.stack);
      console.error('componentStack:', info?.componentStack);
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, errorMessage: '' });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center px-5 py-16 text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-white">
            <AlertTriangle className="h-5 w-5 text-zinc-500" />
          </div>
          <h2 className="text-base font-semibold text-zinc-950">
            {this.props.pageName ? `${this.props.pageName} couldn't load` : "This couldn't load"}
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
            Something went wrong. Try again, or head back to your overview.
          </p>
          {import.meta.env.DEV && this.state.errorMessage && (
            <p className="mt-3 max-w-sm rounded-lg bg-zinc-100 p-2 font-mono text-xs text-zinc-500">
              {this.state.errorMessage}
            </p>
          )}
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
            <Link
              to="/"
              className="inline-flex h-9 items-center rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              Return to Overview
            </Link>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
