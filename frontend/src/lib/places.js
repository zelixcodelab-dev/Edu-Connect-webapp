// Canonical place catalogue for the Colleges feature.
// The 10 cities here drive: (1) the Colleges page place filter, (2) the
// Add/Edit dialog dropdown, (3) the place filters on the Public application
// form + Paste application + Student admission form.

export const COLLEGE_PLACES = [
  "Bangalore",
  "Mangalore",
  "Mysore",
  "Erode",
  "Salem",
  "Coimbatore",
  "Chennai",
  "Kochi",
  "Thrissur",
  "Malappuram",
];

// Common aliases → canonical name. Used by ``normalizePlace`` to auto-tidy
// legacy free-text rows on next save (the user opted into auto-normalize).
const PLACE_ALIASES = {
  "blr": "Bangalore",
  "bengaluru": "Bangalore",
  "banglore": "Bangalore",
  "mng": "Mangalore",
  "mangaluru": "Mangalore",
  "mysuru": "Mysore",
  "cbe": "Coimbatore",
  "kovai": "Coimbatore",
  "chen": "Chennai",
  "chennai-tn": "Chennai",
  "madras": "Chennai",
  "cochin": "Kochi",
  "ernakulam": "Kochi",
  "trichur": "Thrissur",
  "mlp": "Malappuram",
  "manjeri": "Malappuram",  // close enough for the operator workflow
};

const CANON_LOWER = new Set(COLLEGE_PLACES.map((p) => p.toLowerCase()));

/**
 * Normalise an arbitrary place string against the catalogue.
 * - Returns the canonical 10-city name when there's a confident match
 * - Returns the original (trimmed) string otherwise — preserves free text
 *   so "Other" entries are kept intact
 */
export function normalizePlace(raw) {
  if (raw == null) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (CANON_LOWER.has(lower)) {
    // Find the canonical capitalisation (e.g. "bangalore" → "Bangalore")
    return COLLEGE_PLACES.find((p) => p.toLowerCase() === lower) || trimmed;
  }
  if (PLACE_ALIASES[lower]) return PLACE_ALIASES[lower];
  return trimmed;
}

/**
 * Place value to render in a Select. If the stored place is one of the 10
 * canonical cities, return it as-is. Otherwise return "Other".
 */
export function placeForSelect(raw) {
  const norm = normalizePlace(raw);
  return COLLEGE_PLACES.includes(norm) ? norm : (norm ? "Other" : "");
}
