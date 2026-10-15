import { useEffect, useRef } from "react";
import type { Path, RenderStyle } from "../editor/types";
import { fitToPixels, strokePx } from "./pixelFit";
import { pathsToD } from "./svg";

type Cap = RenderStyle["strokeLinecap"];
type Join = RenderStyle["strokeLinejoin"];

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
  size,
  strokeWidth,
  fit,
  cap = "round",
  join = "round",
  color,
  zoom = 6,
}: {
  paths: Path[];
  size: number;
  strokeWidth: number;
  fit: boolean;
  cap?: Cap;
  join?: Join;
  color: string;
  zoom?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const fitted = fitToPixels(paths, size, strokeWidth, fit, cap);
    const k = size / 24;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.strokeStyle = color;
    ctx.lineWidth = fitted.strokeWidth;
    ctx.lineCap = cap;
    ctx.lineJoin = join;
    for (const d of pathsToD(fitted.paths)) ctx.stroke(new Path2D(d));
  }, [paths, size, strokeWidth, fit, cap, join, color]);

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{ width: size * zoom, height: size * zoom, imageRendering: "pixelated" }}
    />
  );
}

/** The sizes worth checking pixel by pixel: where a stroke design breaks. */
export const LADDER_SIZES = [16, 20, 24, 32];

/**
 * The icon at each of `sizes` in real pixels, each labelled with the stroke
 * width it actually gets there — so the per-size stroke table can be checked
 * at a glance. Every cell is zoomed to roughly `cell` CSS px, by a whole
 * factor so every device pixel stays the same square.
 */
export function PixelLadder({
  paths,
  strokeWidth,
  fit,
  cap,
  join,
  color,
  sizes = LADDER_SIZES,
  cell = 96,
  className = "",
}: {
  paths: Path[];
  strokeWidth: number;
  fit: boolean;
  cap?: Cap;
  join?: Join;
  color: string;
  sizes?: number[];
  cell?: number;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-end justify-center gap-4 ${className}`}>
      {sizes.map((size) => {
        const px = fit ? strokePx(strokeWidth, size) : (strokeWidth * size) / 24;
        return (
          <div key={size} className="flex flex-col items-center gap-1">
            <PixelLoupe
              paths={paths}
              size={size}
              strokeWidth={strokeWidth}
              fit={fit}
              cap={cap}
              join={join}
              color={color}
              zoom={Math.max(1, Math.round(cell / size))}
            />
            <span className="font-mono text-[10px] opacity-50">
              {size}px · {Number(px.toFixed(2))}px
            </span>
          </div>
        );
      })}
    </div>
  );
}
