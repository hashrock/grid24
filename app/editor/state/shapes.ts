import type { Path, Point, Segment } from '../types';
import { createSegment } from '../utils/bezierHelper';

export type ShapeKind = 'rect' | 'ellipse' | 'line';

/** Cubic-bezier circle constant: control-handle length as a fraction of the radius. */
const KAPPA = 0.5522847498;

/** Snap `b` to the nearest 45° ray from `a` (Shift on the line tool). */
const constrainAngle = (a: Point, b: Point): Point => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const len = Math.hypot(dx, dy);
  // Rounding keeps diagonals on the half-grid instead of leaving float dust.
  const snap = (v: number) => Math.round(v * 2) / 2;
  return { x: snap(a.x + Math.cos(angle) * len), y: snap(a.y + Math.sin(angle) * len) };
};

/** Make the box between `a` and `b` square, keeping the shorter side (Shift). */
const constrainSquare = (a: Point, b: Point): Point => {
  const side = Math.min(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return { x: a.x + Math.sign(b.x - a.x || 1) * side, y: a.y + Math.sign(b.y - a.y || 1) * side };
};

const straight = (id: string, p1: Point, p2: Point): Segment => createSegment(p1, p1, p2, p2, id);

/**
 * Build the path a shape tool drags out between two corners. Ids derive from
 * `seed`, so the result is a pure function of its inputs. Returns null for a
 * degenerate drag (no extent), so a stray click adds nothing.
 */
export function shapePath(
  kind: ShapeKind,
  from: Point,
  to: Point,
  seed: string,
  constrain = false,
): Path | null {
  const end = !constrain ? to : kind === 'line' ? constrainAngle(from, to) : constrainSquare(from, to);
  const id = (i: number) => `${seed}-s${i}`;

  if (kind === 'line') {
    if (from.x === end.x && from.y === end.y) return null;
    return { id: `${seed}-p`, closed: false, segments: [straight(id(0), from, end)] };
  }

  const minX = Math.min(from.x, end.x);
  const maxX = Math.max(from.x, end.x);
  const minY = Math.min(from.y, end.y);
  const maxY = Math.max(from.y, end.y);

  if (maxX === minX || maxY === minY) return null;

  if (kind === 'rect') {
    const corners: Point[] = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    return {
      id: `${seed}-p`,
      closed: true,
      segments: corners.map((p, i) => straight(id(i), p, corners[(i + 1) % 4])),
    };
  }

  // Ellipse: four arcs through the edge midpoints, smooth at every anchor.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const top = { x: cx, y: minY };
  const right = { x: maxX, y: cy };
  const bottom = { x: cx, y: maxY };
  const left = { x: minX, y: cy };
  const arc = (i: number, p1: Point, c1: Point, c2: Point, p2: Point): Segment => ({
    ...createSegment(p1, c1, c2, p2, id(i)),
    isSmoothP2: true,
  });
  return {
    id: `${seed}-p`,
    closed: true,
    segments: [
      arc(0, top, { x: cx + kx, y: minY }, { x: maxX, y: cy - ky }, right),
      arc(1, right, { x: maxX, y: cy + ky }, { x: cx + kx, y: maxY }, bottom),
      arc(2, bottom, { x: cx - kx, y: maxY }, { x: minX, y: cy + ky }, left),
      arc(3, left, { x: minX, y: cy - ky }, { x: cx - kx, y: minY }, top),
    ],
  };
}
