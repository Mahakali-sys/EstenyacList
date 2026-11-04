import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

function banner(text: string) {
  const d = document.createElement("div");
  d.style.cssText =
    "position:fixed;inset:auto 0 0 0;z-index:99998;background:#b0443a;color:#fff8f2;font:11px 'Cascadia Mono',Consolas,monospace;padding:6px 10px;white-space:pre-wrap;border-top:2px solid #7d2f27";
  d.textContent = text;
  document.body.appendChild(d);
}

window.addEventListener("error", (e) => {
  banner(`ERROR: ${e.message} @ ${e.filename}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  banner(
    "UNHANDLED: " +
      String((e.reason && (e.reason.stack || e.reason.message)) || e.reason),
  );
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
