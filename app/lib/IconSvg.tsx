import type { Path } from "../editor/types";
import { pathsToD } from "./svg";

/** Renders a stroke icon (24x24 grid) as inline SVG. Uses currentColor. */
export function IconSvg({
  paths,
  size = 32,
  strokeWidth = 2,
  strokeLinecap = "round",
  strokeLinejoin = "round",
  className,
}: {
  paths: Path[];
  size?: number;
  strokeWidth?: number;
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
  className?: string;
}) {
  const ds = pathsToD(paths);
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
      {ds.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
