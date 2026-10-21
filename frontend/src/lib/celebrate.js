/**
 * App-wide celebratory feedback store.
 *
 * A single centered overlay (see CelebrationOverlay.jsx) renders a big animated
 * checkmark on any successful create/update/edit/delete, and a matching animated
 * error message when something fails — one coherent success/error language.
 *
 * Wiring:
 *   - The axios response interceptor (lib/api.js) calls `celebrate()` for every
 *     user-initiated mutating request (POST/PUT/PATCH/DELETE) that succeeds.
 *   - sonner's `toast.success` / `toast.error` are patched here (once) so the
 *     existing per-screen calls fold into the same system instead of doubling:
 *       • success toasts that accompany a CRUD call are swallowed (the centered
 *         celebration already fired); standalone successes (e.g. "Link copied")
 *         still show as a normal toast.
 *       • error toasts are restyled into the centered animated error treatment.
 *   - When the overlay isn't mounted (e.g. the standalone public apply page),
 *     everything falls back to the original sonner toasts.
 */
import { toast as sonnerToast } from "sonner";
import { playSuccessCue } from "@/lib/feedbackSound";

const origSuccess = sonnerToast.success.bind(sonnerToast);
const origError = sonnerToast.error.bind(sonnerToast);

const listeners = new Set();
let overlayMounted = false;
let current = null; // { id, kind: 'success' | 'error', caption, message }
let lastCelebrationAt = 0;

function emit() {
  listeners.forEach((l) => {
    try { l(); } catch { /* noop */ }
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot() {
  return current;
}

export function setOverlayMounted(v) {
  overlayMounted = !!v;
}

export function isOverlayMounted() {
  return overlayMounted;
}

export function recentlyCelebrated(windowMs = 1600) {
  return Date.now() - lastCelebrationAt < windowMs;
}

/** Fire the centered feedback. `kind` is 'success' or 'error'. */
export function celebrate({
  kind = "success",
  caption = "Saved",
  message = null,
  milestone = false,
  title = null,
  subtitle = null,
} = {}) {
  if (kind === "success") lastCelebrationAt = Date.now();
  current = { id: Date.now() + Math.random(), kind, caption, message, milestone, title, subtitle };
  if (kind === "success") {
    try { playSuccessCue({ milestone: !!milestone }); } catch { /* best-effort */ }
  }
  emit();
}

export function dismissCelebration(id) {
  if (current && current.id === id) {
    current = null;
    emit();
  }
}

// --- Patch sonner (once) so existing call sites fold into the new system -----
sonnerToast.success = (msg, opts) => {
  if (overlayMounted) {
    // A CRUD celebration just fired from the interceptor — don't double up.
    if (recentlyCelebrated()) return undefined;
    // Standalone success (copy, small confirmations) keeps the classic toast.
    return origSuccess(msg, opts);
  }
  return origSuccess(msg, opts);
};

sonnerToast.error = (msg, opts) => {
  if (overlayMounted) {
    celebrate({
      kind: "error",
      caption: "Didn't go through",
      message: typeof msg === "string" ? msg : null,
    });
    return undefined;
  }
  return origError(msg, opts);
};
