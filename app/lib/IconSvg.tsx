import type { Segment } from "../editor/types";
import { segmentsToPaths } from "./svg";

/** Renders a stroke icon (32x32 grid) as inline SVG. Uses currentColor. */
export function IconSvg({
  segments,
  size = 32,
  strokeWidth = 2,
  className,
}: {
  segments: Segment[];
  size?: number;
  strokeWidth?: number;
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
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
