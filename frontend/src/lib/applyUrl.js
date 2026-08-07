/* Resolves the public admission-form URL.
 *
 * When `REACT_APP_APPLY_PUBLIC_URL` is set (e.g. `https://apply.kmfoundation.co.in`)
 * every "share this referral" link AND every in-app redirect to the apply form
 * points to that domain using the short path format `…/ref=<slug>`. When unset,
 * we fall back to the original same-origin `/apply?ref=<slug>` path so local
 * dev + preview deployments keep working unchanged.
 *
 * Use `buildApplyUrl(ref)` to compose a referral URL.
 * Use `slugifyRef(name)` / `linkedUserRef(user)` for human-readable slugs.
 * Use `navigateToApply(nav, ref)` to drive in-app + cross-origin redirects from
 * a `useNavigate()` hook.
 */

function rawBase() {
  return (process.env.REACT_APP_APPLY_PUBLIC_URL || "").trim();
}

function normalizedBase() {
  let base = rawBase();
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base.replace(/\/+$/, "");
}

/** Human-readable referral slug — mirrors the backend `slugify()` in
 * routers/applications.py: lowercase, dash-separated, a-z 0-9 only. */
export function slugifyRef(name) {
  if (!name) return "";
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Preferred referral ref for a linked "user" account: the human-readable
 * slug of their linked client name (e.g. `john-doe`), falling back to the
 * client UUID when the name can't be slugified. */
export function linkedUserRef(user) {
  if (!user?.linked_client_id) return null;
  return slugifyRef(user.linked_client_name) || user.linked_client_id;
}

/** Returns the absolute or relative URL to open the apply form, optionally
 * pre-tagging a sub-agent / associate-consultant referral via `ref`.
 * Configured apply domain → `https://apply.example.com/ref=john-doe`.
 * Same-origin fallback → `https://<origin>/apply?ref=john-doe`. */
export function buildApplyUrl(ref) {
  const base = normalizedBase();
  if (base) return ref ? `${base}/ref=${encodeURIComponent(ref)}` : `${base}/`;
  // Fallback: same-origin SPA route
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/apply${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
}

/** True when the public apply URL is configured to a different origin than
 * the page that's currently rendering. Useful to decide between `nav(...)`
 * (client-side route) and `window.location.assign(...)` (full reload). */
export function applyIsCrossOrigin() {
  const base = normalizedBase();
  if (!base) return false;
  if (typeof window === "undefined") return false;
  try {
    const target = new URL(base);
    return target.origin !== window.location.origin;
  } catch {
    return false;
  }
}

/** Navigate the user to the apply form, optionally with `ref`. Uses the
 * supplied react-router `useNavigate()` for same-origin redirects and a
 * full `window.location.assign` for cross-origin ones. Pass `replace=true`
 * to mimic `nav(url, { replace: true })`. */
export function navigateToApply(nav, ref, { replace = false } = {}) {
  const target = buildApplyUrl(ref);
  if (applyIsCrossOrigin()) {
    if (typeof window === "undefined") return;
    if (replace) window.location.replace(target);
    else window.location.assign(target);
    return;
  }
  // Same-origin → reuse SPA navigation (strip the absolute prefix so
  // react-router treats it as an internal path).
  const path = target.startsWith("http")
    ? new URL(target).pathname + new URL(target).search
    : target;
  nav(path, replace ? { replace: true } : undefined);
}
