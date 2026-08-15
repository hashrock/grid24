import { Bezier } from 'bezier-js';
import { Point, Segment } from '../types';
import { v4 as uuidv4 } from 'uuid';

export const createSegment = (p1: Point, c1: Point, c2: Point, p2: Point, id?: string): Segment => ({
  id: id ?? uuidv4(),
  p1, c1, c2, p2
});

export const segmentToSvgPath = (s: Segment) => {
  return `M ${s.p1.x} ${s.p1.y} C ${s.c1.x} ${s.c1.y}, ${s.c2.x} ${s.c2.y}, ${s.p2.x} ${s.p2.y}`;
};

// Convert our Segment to a Bezier object
export const toBezier = (s: Segment) => {
  return new Bezier(s.p1.x, s.p1.y, s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p2.x, s.p2.y);
};

/**
 * Cut `segment` at curve parameter `t`. Pass `ids` to name the two halves —
 * the reducer does, so splitting stays a pure function of its inputs.
 */
export const splitSegment = (segment: Segment, t: number, ids?: [string, string]): [Segment, Segment] => {
  const b = toBezier(segment);
  const split = b.split(t);

  // split.left and split.right are the new curves
  const left = split.left;
  const right = split.right;

  const seg1 = createSegment(
    { x: left.points[0].x, y: left.points[0].y },
    { x: left.points[1].x, y: left.points[1].y },
    { x: left.points[2].x, y: left.points[2].y },
    { x: left.points[3].x, y: left.points[3].y },
    ids?.[0]
  );
  // The cut lands mid-curve, so the new junction is smooth by construction.
  seg1.isSmoothP2 = true;

  const seg2 = createSegment(
    { x: right.points[0].x, y: right.points[0].y },
    { x: right.points[1].x, y: right.points[1].y },
    { x: right.points[2].x, y: right.points[2].y },
    { x: right.points[3].x, y: right.points[3].y },
    ids?.[1]
  );
  // Second segment inherits original smoothness
  seg2.isSmoothP2 = segment.isSmoothP2;

  return [seg1, seg2];
};

export const findProjectedT = (segment: Segment, point: Point): { t: number, d: number } => {
  const b = toBezier(segment);
  const proj = b.project(point);
  return { t: proj.t !== undefined ? proj.t : 0.5, d: proj.d !== undefined ? proj.d : 999 };
};
