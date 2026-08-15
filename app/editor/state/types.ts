import type { Point, Segment } from '../types';

/** The four points that make up a cubic segment. */
export type NodeType = 'p1' | 'c1' | 'c2' | 'p2';

/** Identifies one node of one segment: `${segmentId}::${NodeType}`. */
export type NodeKey = string;

/**
 * Everything that is *document* state: saved to the server and restored by
 * undo/redo. Transient UI (tool, viewport, pen draft, hover, render style)
 * deliberately lives outside, in component state.
 */
export interface DocState {
  segments: Segment[];
  selection: ReadonlySet<NodeKey>;
}

/** How dragging one control handle affects its partner across the anchor. */
export type MirrorMode =
  | 'none'   // move the handle alone (arrow-key nudges)
  | 'follow' // keep a smooth junction smooth by mirroring the partner
  | 'break'; // Alt-drag: split the pair, the junction becomes a corner

/**
 * Every way the document can change. Adding a case here forces you to classify
 * it in `HISTORIC` (state/history.ts), so nothing can silently skip undo.
 */
export type DocAction =
  /** Wholesale replace: Clear Canvas, path import, AI generation. */
  | { type: 'segments/replace'; segments: Segment[] }
  /** Append without touching what's already on the canvas (Tabler import). */
  | { type: 'segments/append'; segments: Segment[] }
  /** Move the selection by `delta` (drag or arrow keys). */
  | { type: 'nodes/translate'; delta: Point; mirror?: MirrorMode }
  /** Scale the selection from a fixed origin (transform box handles). */
  | { type: 'nodes/scale'; origin: Point; sx: number; sy: number; from: Record<NodeKey, Point> }
  /** Delete anchors (with their segments) or retract selected handles. */
  | { type: 'nodes/delete' }
  /** Toggle smooth/corner at `anchorKey`, or at every selected anchor. */
  | { type: 'anchor/toggleSmooth'; anchorKey?: NodeKey }
  /** Open/close every path touched by the selection. */
  | { type: 'path/toggleClosed' }
  /** Flip a path's direction, keeping segment ids (used to continue from its head). */
  | { type: 'path/reverse'; pathId: string }
  /** Cut one segment in two at curve parameter `t`. */
  | { type: 'segment/split'; segmentId: string; t: number; ids: [string, string] }
  | { type: 'segment/erase'; segmentId: string }
  /** Pen: append a segment to the path being drawn. */
  | { type: 'pen/commit'; id: string; pathId: string; from: Point; control: Point; to: Point; closing: boolean }
  /** Pen: bridge to a free endpoint of another path and merge the two. */
  | {
      type: 'pen/join';
      id: string;
      pathId: string;
      from: Point;
      control: Point;
      target: { pathId: string; end: 'head' | 'tail'; point: Point };
    }
  /** Pen: pull handles out of the anchor just placed. */
  | { type: 'pen/dragHandle'; segmentId: string; point: Point }
  | { type: 'selection/set'; keys: Iterable<NodeKey> }
  | { type: 'selection/toggle'; keys: Iterable<NodeKey> }
  /** Select every anchor of a path (clicking its stroke). */
  | { type: 'selection/path'; pathId: string; additive: boolean }
  /** Select every anchor inside a marquee rectangle. */
  | { type: 'selection/box'; min: Point; max: Point }
  | { type: 'selection/clear' };

/**
 * `mergeKey` collapses a run of actions into a single undo step: one pointer
 * gesture emits dozens of `nodes/translate`s but should undo as one. The
 * dispatcher owns the key (a fresh id per gesture); the reducer only compares.
 */
export type EditorAction =
  | (DocAction & { mergeKey?: string })
  | { type: 'history/undo' }
  | { type: 'history/redo' };

export interface EditorState {
  doc: DocState;
  past: DocState[];
  future: DocState[];
  lastMergeKey: string | null;
}
