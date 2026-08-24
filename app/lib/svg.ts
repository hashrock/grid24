import type { Path, Point, Segment, StoredSegment } from "../editor/types";

/**
 * The boundary between the editor's nested `Path[]` model and the flat
 * `StoredSegment[]` format persisted in D1. Nothing outside this module should
 * deal in `StoredSegment`.
 */

const isPoint = (v: unknown): v is Point =>
  typeof v === "object" && v !== null &&
  typeof (v as Point).x === "number" && typeof (v as Point).y === "number";

const isStoredSegment = (v: unknown): v is StoredSegment => {
  if (typeof v !== "object" || v === null) return false;
  const s = v as StoredSegment;
  return isPoint(s.p1) && isPoint(s.c1) && isPoint(s.c2) && isPoint(s.p2);
};

/** Group flat segments into paths, preserving first-seen order. */
export function pathsFromStored(stored: StoredSegment[]): Path[] {
  const order: string[] = [];
  const groups = new Map<string, StoredSegment[]>();
  for (const s of stored) {
    const pathId = s.pathId ?? s.id;
    if (!groups.has(pathId)) {
      groups.set(pathId, []);
      order.push(pathId);
    }
    groups.get(pathId)!.push(s);
  }
  return order.map((id) => {
    const segs = groups.get(id)!;
    return {
      id,
      // Older data repeats the flag per segment; any one of them means closed.
      closed: segs.some((s) => s.isClosed === true),
      segments: segs.map(({ pathId: _pathId, isClosed: _isClosed, ...seg }) => seg as Segment),
    };
  });
}

/** Flatten back to the stored format. */
export function pathsToStored(paths: Path[]): StoredSegment[] {
  const out: StoredSegment[] = [];
  for (const path of paths) {
    for (const seg of path.segments) {
      out.push({ ...seg, pathId: path.id, isClosed: path.closed });
    }
  }
  return out;
}

/** Parse stored JSON content into the editor model; tolerant of bad data. */
export function parseContent(content: string): Path[] {
  try {
    const v = JSON.parse(content);
    if (!Array.isArray(v)) return [];
    return pathsFromStored(v.filter(isStoredSegment));
  } catch {
    return [];
  }
}

/** Serialize the editor model for storage. */
export function serializeContent(paths: Path[]): string {
  return JSON.stringify(pathsToStored(paths));
}

/**
 * One SVG `d` string per path. Caps and joins only read correctly when a whole
 * path is drawn as a single `d`, so never emit one `d` per segment.
 */
/**
 * Coordinates as emitted. Three decimals on a 24-unit grid is finer than a
 * screen pixel at any size an icon is used at, and it keeps a `d` produced by
 * curve maths readable instead of a wall of 5.895430500338414.
 */
const n = (v: number): string => String(Math.round(v * 1000) / 1000);

export function pathToD(path: Path): string {
  const [first] = path.segments;
  if (!first) return "";
  let d = `M ${n(first.p1.x)} ${n(first.p1.y)}`;
  for (const s of path.segments) {
    d += ` C ${n(s.c1.x)} ${n(s.c1.y)}, ${n(s.c2.x)} ${n(s.c2.y)}, ${n(s.p2.x)} ${n(s.p2.y)}`;
  }
  return path.closed ? `${d} Z` : d;
}

export function pathsToD(paths: Path[]): string[] {
  return paths.map(pathToD).filter((d) => d !== "");
}

/**
 * Render a standalone SVG document string (for downloads / copy-paste).
 *
 * Presentation attributes are hoisted onto the root, the way Tabler ships its
 * icons: every `<path>` is then just its `d`, which is what makes the markup
 * readable on the public page instead of one unreadable line.
 */
export function pathsToSvgString(paths: Path[], size = 24): string {
  const open =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"\n` +
    `     fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`;
  const body = pathsToD(paths).map((d) => `  <path d="${d}" />`);
  return [open, ...body, "</svg>"].join("\n");
}

/** A safe PascalCase identifier from a user-supplied icon name. */
export function componentName(name: string, fallback = "Icon"): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const joined = parts
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
  // An identifier can't start with a digit, and an all-symbol name yields none.
  return /^[A-Za-z]/.test(joined) ? joined : fallback;
}

/** The same icon as a React component, for pasting straight into a codebase. */
export function pathsToJsxString(paths: Path[], name = "Icon"): string {
  return [
    `export function ${componentName(name)}(props: React.SVGProps<SVGSVGElement>) {`,
    `  return (`,
    `    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={24} height={24}`,
    `         fill="none" stroke="currentColor" strokeWidth={2}`,
    `         strokeLinecap="round" strokeLinejoin="round" {...props}>`,
    ...pathsToD(paths).map((d) => `      <path d="${d}" />`),
    `    </svg>`,
    `  );`,
    `}`,
  ].join("\n");
}

/** The icon as a `data:` URI — for CSS `url()` and `<img src>`. */
export function pathsToDataUri(paths: Path[], color = "currentColor"): string {
  const svg = pathsToSvgString(paths).replace(/currentColor/g, color);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
