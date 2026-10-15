import { useEffect, useRef } from "react";
import type { Path } from "../editor/types";
import { fitToPixels } from "./pixelFit";
import { pathsToD } from "./svg";

/** The size a stroke design breaks at first, so the one worth inspecting. */
const LOUPE_SIZE = 16;

/**
 * The icon rasterized at `size` real pixels, then blown up without smoothing,
 * so you can see which pixels a stroke actually lights — the thing an inline
 * `<svg>` scaled up with CSS can never show, because it re-renders as vector.
 *
 * Drawn straight onto the canvas (no SVG string, no image decode), so it can
 * keep up with the editor redrawing on every drag frame.
 */
export function PixelLoupe({
  paths,
  size = LOUPE_SIZE,
  strokeWidth,
  fit,
  color,
  zoom = 6,
}: {
  paths: Path[];
  size?: number;
  strokeWidth: number;
  fit: boolean;
  color: string;
  zoom?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const fitted = fitToPixels(paths, size, strokeWidth, fit);
    const k = size / 24;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.strokeStyle = color;
    ctx.lineWidth = fitted.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const d of pathsToD(fitted.paths)) ctx.stroke(new Path2D(d));
  }, [paths, size, strokeWidth, fit, color]);

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{ width: size * zoom, height: size * zoom, imageRendering: "pixelated" }}
    />
  );
}

/** The same icon at 16px, as drawn and pixel-fitted, side by side. */
export function FitComparison({
  paths,
  strokeWidth,
  color,
  zoom,
  labels = ["raw", "fit"],
}: {
  paths: Path[];
  strokeWidth: number;
  color: string;
  zoom?: number;
  labels?: [string, string];
}) {
  return (
    <div className="flex flex-wrap justify-center gap-6">
      {[false, true].map((fit, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <PixelLoupe paths={paths} strokeWidth={strokeWidth} fit={fit} color={color} zoom={zoom} />
          <span className="font-mono text-[10px] opacity-50">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}
