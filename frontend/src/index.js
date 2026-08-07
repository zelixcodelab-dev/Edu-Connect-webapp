import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

// Suppress benign ResizeObserver loop warning surfaced by Recharts in dev.
// CRA's react-error-overlay catches window errors — we squelch this specific
// one so it never paints the red overlay during development. Production builds
// don't include the overlay, so this is purely cosmetic.
if (typeof window !== "undefined") {
  const RESIZE_OBSERVER_WARNS = [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
  ];
  const swallow = (msg) => RESIZE_OBSERVER_WARNS.some((m) => String(msg).includes(m));
  window.addEventListener("error", (e) => {
    if (swallow(e.message)) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (swallow(e.reason?.message)) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  });
  // CRA's react-error-overlay also hooks console.error, so filter at that layer.
  const origError = window.console.error;
  window.console.error = (...args) => {
    if (args.length && swallow(args[0])) return;
    origError.apply(window.console, args);
  };
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register service worker for PWA installability + offline shell.
// Only runs in production to avoid stale caches during local dev.
if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .catch((err) => console.warn("[sw] registration failed:", err));
  });
}

