import { Bezier } from 'bezier-js';
import { Point, Segment } from '../types';
import { v4 as uuidv4 } from 'uuid';

export const createSegment = (p1: Point, c1: Point, c2: Point, p2: Point, pathId?: string, isClosed: boolean = false): Segment => ({
  id: uuidv4(),
  pathId: pathId || uuidv4(),
  p1, c1, c2, p2,
  isClosed
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
    segment.pathId,
    segment.isClosed
  );
  // Preserve smoothness if splitting
  seg1.isSmoothP2 = true;

  const seg2 = createSegment(
    { x: right.points[0].x, y: right.points[0].y },
    { x: right.points[1].x, y: right.points[1].y },
    { x: right.points[2].x, y: right.points[2].y },
    { x: right.points[3].x, y: right.points[3].y },
    segment.pathId,
    segment.isClosed
  );
  // Second segment inherits original smoothness
  seg2.isSmoothP2 = segment.isSmoothP2;

  if (ids) {
    seg1.id = ids[0];
    seg2.id = ids[1];
  }

  return [seg1, seg2];
};

export const findProjectedT = (segment: Segment, point: Point): { t: number, d: number } => {
  const b = toBezier(segment);
  const proj = b.project(point);
  return { t: proj.t !== undefined ? proj.t : 0.5, d: proj.d !== undefined ? proj.d : 999 };
};

export const parsePathData = (d: string): Segment[] => {
  const segments: Segment[] = [];
  const cleanD = d.replace(/[\n\r]/g, '').replace(/\s+/g, ' ').trim();

  // Capture command + args
  const commands = cleanD.match(/([a-zA-Z])([^a-zA-Z]*)/g);

  if (!commands) return [];

  let currentPoint: Point = { x: 0, y: 0 };
  let currentPathId = uuidv4();
  let pathStartIndex = 0; // Index in 'segments' where current path started
  let startPointOfPath: Point = { x: 0, y: 0 };

  commands.forEach((cmdStr) => {
    const type = cmdStr[0].toUpperCase(); // Normalize case
    const args = cmdStr.slice(1).trim().split(/[\s,]+/).filter(s => s !== '').map(parseFloat);

    if (type === 'M') {
      currentPoint = { x: args[0], y: args[1] };
      currentPathId = uuidv4();
      pathStartIndex = segments.length;
      startPointOfPath = { ...currentPoint };
    } else if (type === 'L') {
      const p2 = { x: args[0], y: args[1] };
      segments.push(createSegment(
        { ...currentPoint },
        { ...currentPoint },
        { ...p2 },
        p2,
        currentPathId
      ));
      currentPoint = p2;
    } else if (type === 'C') {
      const c1 = { x: args[0], y: args[1] };
      const c2 = { x: args[2], y: args[3] };
      const p2 = { x: args[4], y: args[5] };
      segments.push(createSegment(
        { ...currentPoint },
        c1,
        c2,
        p2,
        currentPathId
      ));
      currentPoint = p2;
    } else if (type === 'Z') {
        // Mark all segments in current path as closed
        for (let i = pathStartIndex; i < segments.length; i++) {
            segments[i].isClosed = true;
        }
        // Often Z implies a line back to start if not already there,
        // but simplified editors often just snap the last point.
        // Let's ensure connectivity: if currentPoint != startPointOfPath, add a closing segment?
        // For simplicity, we just mark closed.
        // If exact geometry is needed, we should modify the last segment or add a line.
        // Let's assume Z just closes logically.

        // Actually, let's force the last segment to end at startPoint
        if (segments.length > pathStartIndex) {
             const lastSeg = segments[segments.length - 1];
             // If distance is significant, add line segment. If small, snap.
             if (Math.hypot(lastSeg.p2.x - startPointOfPath.x, lastSeg.p2.y - startPointOfPath.y) > 0.01) {
                 // Add closing line
                  segments.push(createSegment(
                    { ...currentPoint },
                    { ...currentPoint },
                    { ...startPointOfPath },
                    { ...startPointOfPath },
                    currentPathId,
                    true
                  ));
             } else {
                 // Snap
                 lastSeg.p2 = { ...startPointOfPath };
                 lastSeg.c2 = { ...lastSeg.c2 }; // trigger update if needed
             }
        }
    }
  });

  return segments;
};
