import { useCallback, useEffect, useRef, useState } from "react";

interface BoundingBoxProps {
  videoWidth: number;
  videoHeight: number;
  containerRef: React.RefObject<HTMLDivElement>;
  onBoxDrawn: (bbox: { x: number; y: number; w: number; h: number }) => void;
  onClear: () => void;
  disabled?: boolean;
  mask?: { points: [number, number][] } | null;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function BoundingBox({
  videoWidth,
  videoHeight,
  containerRef,
  onBoxDrawn,
  onClear,
  disabled = false,
  mask = null,
}: BoundingBoxProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const startRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [box, setBox] = useState<Box | null>(null);
  const [activeBox, setActiveBox] = useState<Box | null>(null);

  /** Resize canvas to match the container dimensions. */
  const syncSize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const { width, height } = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }, [containerRef]);

  /** Convert a mouse event to normalized 0-1 coords relative to video dimensions. */
  const toNormalized = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | MouseEvent): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;

      return {
        x: Math.max(0, Math.min(1, px)),
        y: Math.max(0, Math.min(1, py)),
      };
    },
    [],
  );

  /** Draw the current state onto the canvas. */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    // Draw bounding box (finalized or in-progress)
    const renderBox = activeBox ?? box;
    if (renderBox) {
      const bx = renderBox.x * cw;
      const by = renderBox.y * ch;
      const bw = renderBox.w * cw;
      const bh = renderBox.h * ch;

      // Semi-transparent fill
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fillRect(bx, by, bw, bh);

      // Dashed white border
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);
    }

    // Draw mask contour
    if (mask && mask.points.length > 0) {
      ctx.beginPath();
      const [firstX, firstY] = mask.points[0];
      ctx.moveTo(firstX * cw, firstY * ch);

      for (let i = 1; i < mask.points.length; i++) {
        const [mx, my] = mask.points[i];
        ctx.lineTo(mx * cw, my * ch);
      }

      ctx.closePath();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [box, activeBox, mask]);

  /** Sync canvas size on mount and whenever the container resizes. */
  useEffect(() => {
    syncSize();

    const observer = new ResizeObserver(() => {
      syncSize();
      paint();
    });

    const container = containerRef.current;
    if (container) observer.observe(container);

    return () => observer.disconnect();
  }, [syncSize, paint, containerRef]);

  /** Repaint whenever the box, active drawing, or mask changes. */
  useEffect(() => {
    paint();
  }, [paint]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (disabled) return;

      const pos = toNormalized(e);
      drawingRef.current = true;
      startRef.current = pos;
      setActiveBox({ x: pos.x, y: pos.y, w: 0, h: 0 });
    },
    [disabled, toNormalized],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current || disabled) return;

      const pos = toNormalized(e);
      const sx = startRef.current.x;
      const sy = startRef.current.y;

      // Normalize so x,y is always the top-left corner
      const x = Math.min(sx, pos.x);
      const y = Math.min(sy, pos.y);
      const w = Math.abs(pos.x - sx);
      const h = Math.abs(pos.y - sy);

      setActiveBox({ x, y, w, h });
    },
    [disabled, toNormalized],
  );

  const handleMouseUp = useCallback(() => {
    if (!drawingRef.current || disabled) return;
    drawingRef.current = false;

    if (activeBox && activeBox.w > 0.005 && activeBox.h > 0.005) {
      setBox(activeBox);
      onBoxDrawn(activeBox);
    }

    setActiveBox(null);
  }, [disabled, activeBox, onBoxDrawn]);

  const handleDoubleClick = useCallback(() => {
    if (disabled) return;
    setBox(null);
    setActiveBox(null);
    onClear();
  }, [disabled, onClear]);

  /** Catch mouseup outside the canvas so a drag isn't stuck. */
  useEffect(() => {
    const onGlobalMouseUp = () => {
      if (drawingRef.current) {
        drawingRef.current = false;
        setActiveBox((prev) => {
          if (prev && prev.w > 0.005 && prev.h > 0.005) {
            setBox(prev);
            onBoxDrawn(prev);
          }
          return null;
        });
      }
    };

    window.addEventListener("mouseup", onGlobalMouseUp);
    return () => window.removeEventListener("mouseup", onGlobalMouseUp);
  }, [onBoxDrawn]);

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: disabled ? "none" : "auto",
        cursor: disabled ? "default" : "crosshair",
      }}
    />
  );
}

export default BoundingBox;
