import React, { useRef, useState, useCallback } from "react";
import { CaretDoubleRight, Check } from "@phosphor-icons/react";

const KNOB = 52;

// Drag-to-confirm slider, used on mobile for check-in / check-out.
export const SwipeButton = ({ label, confirmedLabel, onConfirm, disabled, tone = "amber", tid }) => {
  const trackRef = useRef(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);

  const maxX = useCallback(() => {
    const w = trackRef.current?.offsetWidth || 0;
    return Math.max(0, w - KNOB - 6);
  }, []);

  const move = (clientX) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const px = clientX - rect.left - KNOB / 2;
    setX(Math.min(maxX(), Math.max(0, px)));
  };

  const onDown = (e) => {
    if (disabled || done) return;
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!dragging) return;
    move(e.clientX);
  };
  const onUp = async () => {
    if (!dragging) return;
    setDragging(false);
    if (x >= maxX() - 8) {
      setX(maxX());
      setDone(true);
      try {
        await onConfirm?.();
      } finally {
        setTimeout(() => {
          setDone(false);
          setX(0);
        }, 600);
      }
    } else {
      setX(0);
    }
  };

  const toneCls =
    tone === "amber"
      ? "bg-gradient-to-r from-amber-400 to-orange-500 text-white"
      : "bg-muted text-foreground border border-border";
  const knobToneCls = tone === "amber" ? "text-orange-600" : "text-foreground";

  return (
    <div
      ref={trackRef}
      data-testid={tid}
      className={`relative h-14 rounded-full overflow-hidden select-none touch-none ${toneCls} ${disabled ? "opacity-60" : ""}`}
    >
      <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold tracking-wide pointer-events-none">
        {done ? (confirmedLabel || "Done") : label}
      </div>
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="absolute top-1 left-1 h-12 w-12 rounded-full bg-white shadow-md flex items-center justify-center cursor-grab active:cursor-grabbing"
        style={{ transform: `translateX(${x}px)`, transition: dragging ? "none" : "transform 0.25s ease" }}
      >
        {done ? <Check size={22} weight="bold" className={knobToneCls} /> : <CaretDoubleRight size={22} weight="bold" className={knobToneCls} />}
      </div>
    </div>
  );
};

export default SwipeButton;
