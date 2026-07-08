import type { Point, Segment } from "../editor/types";

/**
 * Robust SVG path -> Segment[] importer.
 *
 * Supports absolute & relative M/L/H/V/C/S/Q/T/A/Z. Lines are stored as
 * cubics with coincident control points (matching the editor's convention);
 * arcs are converted to cubic bezier chunks. Each subpath (every M) becomes a
 * new pathId so `segmentsToPaths` groups them correctly.
 */

const uid = () => crypto.randomUUID();

type Seg = Omit<Segment, "selected">;

function seg(
  pathId: string,
  p1: Point,
  c1: Point,
  c2: Point,
  p2: Point,
  isClosed = false
): Seg {
  return { id: uid(), pathId, p1, c1, c2, p2, isClosed };
}

// --- Arc (A/a) -> cubic beziers -------------------------------------------
// Endpoint -> center parameterisation, then split into <=90deg cubic pieces.
function arcToCubics(
  p0: Point,
  rx: number,
  ry: number,
  xAxisRotationDeg: number,
  largeArc: number,
  sweep: number,
  p: Point
): { c1: Point; c2: Point; end: Point }[] {
  if (rx === 0 || ry === 0) {
    // Degenerate arc -> straight line.
    return [{ c1: { ...p0 }, c2: { ...p }, end: { ...p } }];
  }
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (p0.x - p.x) / 2;
  const dy = (p0.y - p.y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // Correct out-of-range radii.
  let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const sign = largeArc !== sweep ? 1 : -1;
  let num =
    rx * rx * (ry * ry) - rx * rx * (y1p * y1p) - ry * ry * (x1p * x1p);
  const den = rx * rx * (y1p * y1p) + ry * ry * (x1p * x1p);
  num = Math.max(0, num);
  const co = sign * Math.sqrt(num / den);
  const cxp = (co * (rx * y1p)) / ry;
  const cyp = (co * -(ry * x1p)) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p.y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry
  );
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const segCount = Math.ceil(Math.abs(dTheta) / (Math.PI / 2));
  const delta = dTheta / segCount;
  const t = ((4 / 3) * Math.tan(delta / 4));

  const out: { c1: Point; c2: Point; end: Point }[] = [];
  let th = theta1;
  let cur = { ...p0 };
  for (let i = 0; i < segCount; i++) {
    const th2 = th + delta;
    const cos1 = Math.cos(th);
    const sin1 = Math.sin(th);
    const cos2 = Math.cos(th2);
    const sin2 = Math.sin(th2);

    const e = (ct: number, st: number): Point => ({
      x: cx + cosPhi * rx * ct - sinPhi * ry * st,
      y: cy + sinPhi * rx * ct + cosPhi * ry * st,
    });
    const d = (ct: number, st: number): Point => ({
      x: cosPhi * rx * -st - sinPhi * ry * ct,
      y: sinPhi * rx * -st + cosPhi * ry * ct,
    });

    const end = e(cos2, sin2);
    const d1 = d(cos1, sin1);
    const d2 = d(cos2, sin2);
    const c1 = { x: cur.x + t * d1.x, y: cur.y + t * d1.y };
    const c2 = { x: end.x - t * d2.x, y: end.y - t * d2.y };
    out.push({ c1, c2, end });
    cur = end;
    th = th2;
  }
  return out;
}

// --- Tokeniser -------------------------------------------------------------
const TOKEN_RE = /([a-zA-Z])|(-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;

const PARAMS: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

export function pathToSegments(d: string): Seg[] {
  const segments: Seg[] = [];
  const nums: (string | number)[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(d))) {
    nums.push(m[1] ? m[1] : parseFloat(m[2]));
  }

  let i = 0;
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let pathId = uid();
  let subpathStartIdx = 0;
  let prevCubicCtrl: Point | null = null; // for S/s reflection
  let cmd = "";

  const num = () => nums[i++] as number;

  while (i < nums.length) {
    const tok = nums[i];
    if (typeof tok === "string") {
      cmd = tok;
      i++;
    } else if (cmd === "M" || cmd === "m") {
      // Implicit repeat of M/m acts as L/l.
      cmd = cmd === "M" ? "L" : "l";
    }
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const isCurve = upper === "C" || upper === "S";

    if (upper === "M") {
      let x = num();
      let y = num();
      if (rel) {
        x += cur.x;
        y += cur.y;
      }
      cur = { x, y };
      start = { x, y };
      pathId = uid();
      subpathStartIdx = segments.length;
      prevCubicCtrl = null;
      continue;
    }
    if (upper === "Z") {
      // Close: mark subpath segments closed, snap/line back to start.
      for (let k = subpathStartIdx; k < segments.length; k++) {
        segments[k].isClosed = true;
      }
      if (Math.hypot(cur.x - start.x, cur.y - start.y) > 0.001) {
        segments.push(
          seg(pathId, { ...cur }, { ...cur }, { ...start }, { ...start }, true)
        );
      }
      cur = { ...start };
      prevCubicCtrl = null;
      continue;
    }

    const p1 = { ...cur };
    let c1: Point, c2: Point, end: Point;

    if (upper === "L") {
      let x = num();
      let y = num();
      if (rel) { x += cur.x; y += cur.y; }
      end = { x, y };
      c1 = { ...p1 };
      c2 = { ...end };
    } else if (upper === "H") {
      let x = num();
      if (rel) x += cur.x;
      end = { x, y: cur.y };
      c1 = { ...p1 };
      c2 = { ...end };
    } else if (upper === "V") {
      let y = num();
      if (rel) y += cur.y;
      end = { x: cur.x, y };
      c1 = { ...p1 };
      c2 = { ...end };
    } else if (upper === "C") {
      let c1x = num(), c1y = num(), c2x = num(), c2y = num(), ex = num(), ey = num();
      if (rel) { c1x += cur.x; c1y += cur.y; c2x += cur.x; c2y += cur.y; ex += cur.x; ey += cur.y; }
      c1 = { x: c1x, y: c1y };
      c2 = { x: c2x, y: c2y };
      end = { x: ex, y: ey };
    } else if (upper === "S") {
      let c2x = num(), c2y = num(), ex = num(), ey = num();
      if (rel) { c2x += cur.x; c2y += cur.y; ex += cur.x; ey += cur.y; }
      c1 = prevCubicCtrl
        ? { x: 2 * cur.x - prevCubicCtrl.x, y: 2 * cur.y - prevCubicCtrl.y }
        : { ...p1 };
      c2 = { x: c2x, y: c2y };
      end = { x: ex, y: ey };
    } else if (upper === "Q" || upper === "T") {
      // Quadratic -> cubic (T reflects previous, but we only track cubic ctrl;
      // approximate T's control as the current point).
      let qx: number, qy: number, ex: number, ey: number;
      if (upper === "Q") {
        qx = num(); qy = num(); ex = num(); ey = num();
        if (rel) { qx += cur.x; qy += cur.y; ex += cur.x; ey += cur.y; }
      } else {
        ex = num(); ey = num();
        if (rel) { ex += cur.x; ey += cur.y; }
        qx = cur.x; qy = cur.y;
      }
      c1 = { x: cur.x + (2 / 3) * (qx - cur.x), y: cur.y + (2 / 3) * (qy - cur.y) };
      c2 = { x: ex + (2 / 3) * (qx - ex), y: ey + (2 / 3) * (qy - ey) };
      end = { x: ex, y: ey };
    } else if (upper === "A") {
      const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
      let ex = num(), ey = num();
      if (rel) { ex += cur.x; ey += cur.y; }
      const cubics = arcToCubics(cur, rx, ry, rot, large, sweep, { x: ex, y: ey });
      for (const cc of cubics) {
        segments.push(seg(pathId, { ...cur }, cc.c1, cc.c2, cc.end));
        cur = cc.end;
      }
      prevCubicCtrl = null;
      continue;
    } else {
      // Unknown command — bail out of this parse gracefully.
      break;
    }

    segments.push(seg(pathId, p1, c1, c2, end));
    cur = end;
    prevCubicCtrl = isCurve ? c2 : null;
  }

  return segments;
}

/** Parse several <path> `d` strings into one combined Segment[]. */
export function pathsToSegments(ds: string[]): Seg[] {
  const out: Seg[] = [];
  for (const d of ds) out.push(...pathToSegments(d));
  return out;
}
