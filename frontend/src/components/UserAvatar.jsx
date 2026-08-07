import React from "react";
import { photoSrc } from "@/pages/Clients";

/** Small avatar circle with photo fallback → initials. Sized presets:
 *  - xs: 16px (chips)
 *  - sm: 20px (assignee chips, notifications)
 *  - md: 24px (list rows)
 *  - lg: 32px (headers)
 *
 *  Renders an <img> when ``photoUrl`` is present (auth-signed via ``photoSrc``);
 *  otherwise a coloured amber-gradient circle with 1-2 char initials.
 */
const SIZES = {
  xs: { box: "w-4 h-4", text: "text-[8px]" },
  sm: { box: "w-5 h-5", text: "text-[9px]" },
  md: { box: "w-6 h-6", text: "text-[10px]" },
  lg: { box: "w-8 h-8", text: "text-xs" },
};

function initialsOf(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

export default function UserAvatar({
  name,
  photoUrl,
  size = "sm",
  className = "",
  testid,
}) {
  const s = SIZES[size] || SIZES.sm;
  const hasPhoto = !!photoUrl;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 font-semibold text-white bg-amber-gradient ${s.box} ${s.text} ${className}`}
      data-testid={testid}
      aria-label={name || "user"}
      title={name || undefined}
    >
      {hasPhoto ? (
        <img
          src={photoSrc(photoUrl)}
          alt={name || "user"}
          className="w-full h-full object-cover"
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
