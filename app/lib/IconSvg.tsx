import { useMemo } from "react";
import type { Path } from "../editor/types";
import { fitToPixels } from "./pixelFit";
import { pathsToD } from "./svg";

/**
 * Renders a stroke icon (24x24 grid) as inline SVG. Uses currentColor.
 * Pixel-fitted to `size` unless `fit` is off — see `pixelFit.ts`.
 */
export function IconSvg({
  paths,
  size = 32,
  strokeWidth = 2,
  strokeLinecap = "round",
  strokeLinejoin = "round",
  fit = true,
  className,
}: {
  paths: Path[];
  size?: number;
  strokeWidth?: number;
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
  fit?: boolean;
  className?: string;
}) {
  const fitted = useMemo(
    () => fitToPixels(paths, size, strokeWidth, fit),
    [paths, size, strokeWidth, fit],
  );
  const ds = pathsToD(fitted.paths);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={fitted.strokeWidth}
      strokeLinecap={strokeLinecap}
      strokeLinejoin={strokeLinejoin}
    >
      {ds.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
