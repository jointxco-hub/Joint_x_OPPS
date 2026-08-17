import { Component } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";

// Route-level error boundary. Before this existed, nothing in App.jsx
// caught render-time errors, so any uncaught exception thrown while
// rendering a page (e.g. a call to an undefined helper function) unmounted
// the entire React tree - the app just went blank, with no indication
// anything had gone wrong short of opening devtools. This wraps every
// page route so a bug in one page degrades to a recoverable in-page
// message instead of a blank screen. Mirrors the existing
// OrderDrawerErrorBoundary pattern in src/pages/Orders.jsx.
export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error?.message || "Unknown render error" };
  }

  componentDidCatch(error, info) {
    console.error(`[RouteErrorBoundary] ${this.props.pageName || "Page"} failed to render`, error?.message || error);
    if (import.meta.env.DEV) {
      console.error("stack:", error?.stack);
      console.error("componentStack:", info?.componentStack);
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, errorMessage: "" });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-lg px-4 py-16 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <h2 className="font-semibold text-foreground">
            {this.props.pageName ? `${this.props.pageName} could not load` : "This page could not load"}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Something went wrong rendering this page. Reloading usually fixes it - if it keeps happening, let Jasper know.
          </p>
          {import.meta.env.DEV && this.state.errorMessage && (
            <p className="mt-3 rounded-lg bg-secondary/60 p-2 font-mono text-xs text-muted-foreground">{this.state.errorMessage}</p>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mx-auto mt-5 flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <RefreshCw className="h-4 w-4" />
            Reload page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
