import { useEffect, useRef, useState } from "react";
import type { BBox } from "../api/client";

/**
 * transparent canvas laid over the video. users drag to draw a rectangle;
 * the rectangle is emitted in normalized 0-1 coordinates (top-left origin).
 *
 * the canvas element takes the same CSS box as the video, so the ratio of
 * the draw-area to the video is 1:1.
 */
export function BBoxCanvas({
  width,
  height,
  value,
  onChange,
}: {
  width: number;
  height: number;
  value: BBox | null;
  onChange: (b: BBox | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ x0: number; y0: number } | null>(
    null,
  );

  // commit the finalized box once mouseup fires globally (so releasing off the
  // canvas still completes the gesture)
  useEffect(() => {
    if (!dragging) return;
    const up = () => setDragging(null);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [dragging]);

  const toNorm = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  };

  const onDown = (e: React.MouseEvent) => {
    const p = toNorm(e);
    setDragging({ x0: p.x, y0: p.y });
    onChange({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    const p = toNorm(e);
    const x = Math.min(p.x, dragging.x0);
    const y = Math.min(p.y, dragging.y0);
    const w = Math.abs(p.x - dragging.x0);
    const h = Math.abs(p.y - dragging.y0);
    onChange({
      x: Math.max(0, x),
      y: Math.max(0, y),
      w: Math.min(1 - x, w),
      h: Math.min(1 - y, h),
    });
  };

  return (
    <div
      ref={ref}
      className="bbox"
      style={{ width, height }}
      onMouseDown={onDown}
      onMouseMove={onMove}
    >
      {/* crosshair corner marks for visual guidance */}
      <CornerMark edge="tl" />
      <CornerMark edge="tr" />
      <CornerMark edge="bl" />
      <CornerMark edge="br" />

      {value && value.w > 0.005 && (
        <div
          className="bbox__rect"
          style={{
            left: `${value.x * 100}%`,
            top: `${value.y * 100}%`,
            width: `${value.w * 100}%`,
            height: `${value.h * 100}%`,
          }}
        >
          <span className="bbox__coords mono">
            {(value.x * 100).toFixed(0)},{(value.y * 100).toFixed(0)} ·
            {" "}
            {(value.w * 100).toFixed(0)}×{(value.h * 100).toFixed(0)}
          </span>
        </div>
      )}
    </div>
  );
}

function CornerMark({ edge }: { edge: "tl" | "tr" | "bl" | "br" }) {
  return <span className={`bbox__corner bbox__corner--${edge}`} />;
}
