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
}

export interface SelectionBox {
  start: Point;
  end: Point;
}

/**
 * How the strokes are *rendered*. Purely a preview setting — it isn't part of
 * the saved vector data, so changing it never alters the icon's geometry.
 */
export interface RenderStyle {
  /** Stroke width in grid units (Tabler icons use 2). */
  strokeWidth: number;
  /** Shape of open path ends. */
  strokeLinecap: 'butt' | 'round' | 'square';
  /** Shape of the corners where segments meet. */
  strokeLinejoin: 'miter' | 'round' | 'bevel';
}

export const DEFAULT_RENDER_STYLE: RenderStyle = {
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export enum Tool {
  SELECT = 'SELECT',
  PEN = 'PEN',
  SPLIT = 'SPLIT',
  ERASER = 'ERASER'
}

// Primary (accent) color for all overlay UI: selected paths, anchors,
// handles, marquee, transform controls. Matches the Figma/Illustrator
// convention of a single blue accent for "active" state.
export const PRIMARY_COLOR = '#3b82f6';

// Hit tolerances in *screen pixels* — converted to SVG units per zoom level
// so targets stay the same physical size regardless of zoom.
export const ANCHOR_HIT_PX = 8;
export const PATH_HOVER_PX = 6;

// Grid snapping: placed/dragged points snap to the nearest multiple of this
// (in grid units). 0.5 keeps points on the 24x24 grid / half-grid, matching
// how Tabler icons are drawn. Set to 0 to disable snapping.
export const GRID_SNAP = 0.5;
