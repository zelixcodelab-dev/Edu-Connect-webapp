import React, { useEffect, useState } from "react";
import api from "@/lib/api";

/**
 * Renders a protected file (profile photo / lead image) by fetching it with an
 * authenticated request (cookie + Bearer) and turning the response into a blob
 * object URL. This replaces the old ``?auth=<jwt>`` query-string approach
 * (SEC-001) which leaked the token into browser history, server logs and
 * Referer headers.
 *
 * While loading (or on error) it renders ``fallback`` so avatars never flash
 * a broken-image icon.
 */
export function toApiRelative(url) {
  if (!url) return "";
  return url.startsWith("/api") ? url.replace(/^\/api/, "") : url;
}

export default function AuthedImage({ url, alt = "", className = "", testid, fallback = null }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    setSrc(null);
    setFailed(false);
    if (!url) return undefined;
    api
      .get(toApiRelative(url), { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (!url || failed || !src) return fallback;
  return <img src={src} alt={alt} className={className} data-testid={testid} />;
}

/** Download a protected file via an authenticated request. */
export async function downloadAuthedFile(url, filename) {
  const res = await api.get(toApiRelative(url), { responseType: "blob" });
  const objectUrl = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename || "file";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
