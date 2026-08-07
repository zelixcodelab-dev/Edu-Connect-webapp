import React, { useEffect, useRef, useState } from "react";

/**
 * Full-screen video splash that plays once on app load and then fades out.
 * - Uses `muted` + `playsInline` + `autoPlay` so it works on iOS/Android browsers.
 * - Falls back to a poster image if the browser blocks autoplay.
 * - Auto-dismisses after the video ends (with a hard timeout safety net).
 */
export default function SplashScreen({ onFinish, maxDurationMs = 6000 }) {
  const videoRef = useRef(null);
  const [leaving, setLeaving] = useState(false);

  const dismiss = React.useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    // Match the CSS fade duration before unmounting.
    setTimeout(() => onFinish?.(), 450);
  }, [leaving, onFinish]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // Some browsers reject autoplay on JS-rendered video; try explicitly.
    const tryPlay = v.play?.();
    if (tryPlay && typeof tryPlay.catch === "function") {
      tryPlay.catch(() => {
        // Autoplay blocked — dismiss quickly so the user isn't stuck.
        setTimeout(dismiss, 600);
      });
    }
    const safety = setTimeout(dismiss, maxDurationMs);
    return () => clearTimeout(safety);
  }, [dismiss, maxDurationMs]);

  return (
    <div
      data-testid="splash-screen"
      onClick={dismiss}
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-black transition-opacity duration-500 ${
        leaving ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <video
        ref={videoRef}
        data-testid="splash-video"
        src="/splash.mp4"
        poster="/splash-poster.jpg"
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={dismiss}
        onError={dismiss}
        className="w-full h-full object-contain sm:object-cover"
      />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); dismiss(); }}
        data-testid="splash-skip-btn"
        className="absolute bottom-6 right-6 sm:bottom-8 sm:right-8 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs tracking-wider uppercase px-4 py-2 backdrop-blur transition-colors"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        Skip
      </button>
    </div>
  );
}
