import { Component } from "react";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "#151210",
            color: "#eae2d3",
            fontFamily: '"Cascadia Mono", Consolas, monospace',
            fontSize: 12,
            padding: 28,
            whiteSpace: "pre-wrap",
            overflow: "auto",
          }}
        >
          <div
            style={{
              fontFamily: '"Palatino Linotype", Georgia, serif',
              fontSize: 22,
              marginBottom: 4,
              color: "#e2543e",
            }}
          >
            The app crashed
          </div>
          <div style={{ color: "#a89c8a", marginBottom: 16 }}>
            Copy the details below if you want to report it.
          </div>
          <div style={{ color: "#e08a7e" }}>
            {String(this.state.error?.message ?? this.state.error)}
          </div>
          <div style={{ marginTop: 14, color: "#72675a" }}>
            {this.state.error?.stack ?? ""}
          </div>
          <button
            onClick={() => location.reload()}
            style={{
              marginTop: 20,
              padding: "6px 14px",
              background: "#e2543e",
              color: "#fff",
              border: "none",
              borderRadius: 3,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
