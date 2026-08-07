// Pure utilities + token maps used by the Dashboard overview tiles.
// Extracted from Dashboard.jsx to keep the page slim.

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function rangeFor(preset) {
  const now = new Date();
  if (preset === "this_month") {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: isoDate(s), end: isoDate(now), label: "This month" };
  }
  if (preset === "last_30") {
    const s = new Date(now); s.setDate(now.getDate() - 29);
    return { start: isoDate(s), end: isoDate(now), label: "Last 30 days" };
  }
  if (preset === "last_90") {
    const s = new Date(now); s.setDate(now.getDate() - 89);
    return { start: isoDate(s), end: isoDate(now), label: "Last 90 days" };
  }
  if (preset === "ytd") {
    const s = new Date(now.getFullYear(), 0, 1);
    return { start: isoDate(s), end: isoDate(now), label: "Year to date" };
  }
  return null;
}

export function withinFilter(dateStr, filter) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter === "today") return d >= startOfDay;
  if (filter === "weekly") {
    const s = new Date(startOfDay); s.setDate(s.getDate() - 6);
    return d >= s;
  }
  if (filter === "monthly") {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    return d >= s;
  }
  return true;
}

// Build N-month buckets ending at "now" given list of {date, value}.
export function monthlyBuckets(dates) {
  const now = new Date();
  const buckets = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      month: d.toLocaleDateString("en-US", { month: "short" }),
      count: 0,
      value: 0,
    });
  }
  const idx = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
  dates.forEach(({ date, value }) => {
    if (!date) return;
    const d = new Date(date);
    if (isNaN(d.getTime())) return;
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    if (idx[k] !== undefined) {
      buckets[idx[k]].count += 1;
      buckets[idx[k]].value += value || 0;
    }
  });
  return buckets;
}

// Build buckets across ALL months present in `dates`, padded to the current
// month so the chart trails to "today". Caps at the latest 24 months.
export function allTimeMonthlyBuckets(dates) {
  const valid = dates.map((d) => ({ ...d, _d: d.date ? new Date(d.date) : null }))
    .filter((d) => d._d && !isNaN(d._d.getTime()));
  if (!valid.length) return [];
  const now = new Date();
  let min = valid[0]._d;
  valid.forEach((v) => { if (v._d < min) min = v._d; });
  const start = new Date(min.getFullYear(), min.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const map = new Map();
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
    map.set(key, {
      key,
      month: cursor.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      count: 0,
      value: 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  valid.forEach(({ _d, value }) => {
    const k = `${_d.getFullYear()}-${_d.getMonth()}`;
    if (map.has(k)) {
      const b = map.get(k);
      b.count += 1;
      b.value += value || 0;
    }
  });
  const out = Array.from(map.values());
  return out.length > 24 ? out.slice(-24) : out;
}

// ---- Visual token maps ----

export const PALETTES = {
  amber: { bg: "bg-amber-50 dark:bg-amber-500/15", icon: "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400" },
  violet: { bg: "bg-violet-50 dark:bg-violet-500/15", icon: "bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-400" },
  emerald: { bg: "bg-emerald-50 dark:bg-emerald-500/15", icon: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" },
  rose: { bg: "bg-rose-50 dark:bg-rose-500/15", icon: "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400" },
  sky: { bg: "bg-sky-50 dark:bg-sky-500/15", icon: "bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-400" },
  stone: { bg: "bg-muted", icon: "bg-muted text-foreground" },
};

export const FILTER_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export const STATUS_BADGE = {
  inquiry: "bg-muted text-foreground",
  enrolled: "bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400",
  completed: "bg-sky-100/60 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400",
};

export const CLIENT_TYPE_LABEL = {
  sub_agent_associate: "Sub Agent / Associate",
  associate_consultant: "Associate Consultant",
  km_blr_office: "KM BLR Office",
  km_tcr_office: "KM TCR Office",
  km_kmly_office: "KM KMLY Office",
};

export const LEDGER_TYPE_LABEL = { sub_agent: "Sub Agent", associate: "Associate", km: "KM" };
export const LEDGER_TYPE_COLOR = { sub_agent: "#7c3aed", associate: "#d97706", km: "#059669" };
