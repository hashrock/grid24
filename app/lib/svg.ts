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
export function pathToD(path: Path): string {
  const [first] = path.segments;
  if (!first) return "";
  let d = `M ${first.p1.x} ${first.p1.y}`;
  for (const s of path.segments) {
    d += ` C ${s.c1.x} ${s.c1.y}, ${s.c2.x} ${s.c2.y}, ${s.p2.x} ${s.p2.y}`;
  }
  return path.closed ? `${d} Z` : d;
}

export function pathsToD(paths: Path[]): string[] {
  return paths.map(pathToD).filter((d) => d !== "");
}

/** Render a standalone SVG document string (for downloads / raw endpoints). */
export function pathsToSvgString(paths: Path[], size = 24): string {
  const rendered = pathsToD(paths)
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">${rendered}</svg>`;
}
