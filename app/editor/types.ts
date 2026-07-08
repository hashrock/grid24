export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  id: string;
  pathId: string; // Groups segments into a continuous path
  p1: Point; // Start
  c1: Point; // Control 1
  c2: Point; // Control 2
  p2: Point; // End
  isSmoothP2?: boolean; // Is the connection at p2 smooth?
  isClosed?: boolean; // Is the path closed?
  selected?: boolean;
}

export type PointType = 'p1' | 'c1' | 'c2' | 'p2';

export interface SelectedPoint {
  segmentId: string;
  pointType: PointType;
}

export interface SelectionBox {
  start: Point;
  end: Point;
}

export enum Tool {
  SELECT = 'SELECT',
  PEN = 'PEN',
  SPLIT = 'SPLIT',
  ERASER = 'ERASER'
}

export const SNAP_THRESHOLD = 0.5;
export const HIT_RADIUS = 0.8;

// Grid snapping: placed/dragged points snap to the nearest multiple of this
// (in grid units). 0.5 keeps points on the 24x24 grid / half-grid, matching
// how Tabler icons are drawn. Set to 0 to disable snapping.
export const GRID_SNAP = 0.5;
