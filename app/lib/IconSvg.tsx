import type { Segment } from "../editor/types";
import { segmentsToPaths } from "./svg";

/** Renders a stroke icon (24x24 grid) as inline SVG. Uses currentColor. */
export function IconSvg({
  segments,
  size = 32,
  strokeWidth = 2,
  strokeLinecap = "round",
  strokeLinejoin = "round",
  className,
}: {
  segments: Segment[];
  size?: number;
  strokeWidth?: number;
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
  className?: string;
}) {
  const paths = segmentsToPaths(segments);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap={strokeLinecap}
      strokeLinejoin={strokeLinejoin}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
