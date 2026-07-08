import type { Segment } from "../editor/types";

/**
 * Group the editor's flat Segment[] into SVG path `d` strings.
 * Segments that share a `pathId` form one continuous path (in array order);
 * a closed path gets a trailing `Z`.
 */
export function segmentsToPaths(segments: Segment[]): string[] {
  const order: string[] = [];
  const groups = new Map<string, Segment[]>();
  for (const s of segments) {
    if (!groups.has(s.pathId)) {
      groups.set(s.pathId, []);
      order.push(s.pathId);
    }
    groups.get(s.pathId)!.push(s);
  }

  const paths: string[] = [];
  for (const pathId of order) {
    const segs = groups.get(pathId)!;
    if (segs.length === 0) continue;
    const first = segs[0];
    let d = `M ${first.p1.x} ${first.p1.y}`;
    for (const s of segs) {
      d += ` C ${s.c1.x} ${s.c1.y}, ${s.c2.x} ${s.c2.y}, ${s.p2.x} ${s.p2.y}`;
    }
    if (segs.some((s) => s.isClosed)) d += " Z";
    paths.push(d);
  }
  return paths;
}

/** Parse stored JSON content into Segment[]; tolerant of bad data. */
export function parseContent(content: string): Segment[] {
  try {
    const v = JSON.parse(content);
    return Array.isArray(v) ? (v as Segment[]) : [];
  } catch {
    return [];
  }
}

/** Render a standalone SVG document string (for downloads / raw endpoints). */
export function segmentsToSvgString(segments: Segment[], size = 32): string {
  const paths = segmentsToPaths(segments)
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${paths}</svg>`;
}
