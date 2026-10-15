import { useEffect, useRef } from "react";
import type { Path } from "../editor/types";
import { renderIconSvg } from "./svgServe";

/**
 * The icon rasterized at `size` real pixels, then blown up without smoothing,
 * so you can see which pixels a stroke actually lights — the thing an inline
 * `<svg>` scaled up with CSS can never show, because it re-renders as vector.
 */
export function PixelLoupe({
  paths,
  size,
  strokeWidth,
  fit,
  color,
  zoom = 6,
}: {
  paths: Path[];
  size: number;
  strokeWidth: number;
  fit: boolean;
  /** A concrete paint: an `<img>`-decoded SVG has no `currentColor` to inherit. */
  color: string;
  zoom?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const svg = renderIconSvg(paths, { size, color, strokeWidth, fit });
    const img = new Image();
    img.onload = () => {
      const ctx = ref.current?.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
    };
    img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    return () => {
      img.onload = null;
    };
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
