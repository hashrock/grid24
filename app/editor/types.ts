export interface Point {
  x: number;
  y: number;
}

/**
 * One cubic bezier. A segment knows nothing about the path it belongs to —
 * that relationship is the containing `Path`, not a field here.
 */
export interface Segment {
  id: string;
  p1: Point; // Start
  c1: Point; // Control 1
  c2: Point; // Control 2
  p2: Point; // End
  /** Is the junction at p2 smooth? The flag belongs to the *arriving* segment. */
  isSmoothP2?: boolean;
}

/**
 * A continuous chain of segments: `segments[i].p2` meets `segments[i+1].p1`,
 * and a closed path additionally joins the last p2 back to the first p1.
 *
 * Chain order is the array order. Keeping segments nested (rather than flat
 * with a `pathId`) is what makes that invariant structural instead of a
 * convention every call site has to remember.
 */
export interface Path {
  id: string;
  closed: boolean;
  segments: Segment[];
}

/**
 * The flat wire format: what is persisted in D1 and what the public SVG
 * endpoints read. Predates the nested `Path` model, so it carries the grouping
 * as a `pathId` and repeats `isClosed` on every segment of a path.
 *
 * Only `app/lib/svg.ts` should ever touch this — everything else works with
 * `Path[]`.
 */
export interface StoredSegment extends Segment {
  pathId: string;
  isClosed?: boolean;
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
