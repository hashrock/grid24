import { describe, expect, it } from 'vitest';
import { shapePath } from './shapes';
import { createEditorState, editorReducer } from './history';

const P = (x: number, y: number) => ({ x, y });

describe('shapePath', () => {
  it('builds a closed rectangle of four chained straight segments', () => {
    const path = shapePath('rect', P(8, 6), P(2, 2), 's')!;
    expect(path.closed).toBe(true);
    expect(path.segments).toHaveLength(4);
    path.segments.forEach((seg, i) => {
      expect(seg.p2).toEqual(path.segments[(i + 1) % 4].p1);
      expect(seg.c1).toEqual(seg.p1);
      expect(seg.c2).toEqual(seg.p2);
    });
    const xs = path.segments.map((s) => s.p1.x);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([2, 8]);
  });

  it('constrains a rectangle to a square with Shift', () => {
    const path = shapePath('rect', P(2, 2), P(10, 5), 's', true)!;
    const xs = path.segments.map((s) => s.p1.x);
    const ys = path.segments.map((s) => s.p1.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(3);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(3);
  });

  it('builds a closed smooth four-arc ellipse through the edge midpoints', () => {
    const path = shapePath('ellipse', P(2, 4), P(12, 10), 's')!;
    expect(path.segments).toHaveLength(4);
    expect(path.segments.every((s) => s.isSmoothP2)).toBe(true);
    expect(path.segments[0].p1).toEqual(P(7, 4));
    expect(path.segments[0].p2).toEqual(P(12, 7));
    path.segments.forEach((seg, i) => expect(seg.p2).toEqual(path.segments[(i + 1) % 4].p1));
  });

  it('snaps a line to 45° steps with Shift', () => {
    const path = shapePath('line', P(4, 4), P(12, 6), 's', true)!;
    expect(path.segments[0].p2).toEqual(P(12, 4));
    const diag = shapePath('line', P(4, 4), P(10, 9), 's', true)!;
    const { p2 } = diag.segments[0];
    expect(p2.x - 4).toBeCloseTo(p2.y - 4, 5);
  });

  it('ignores zero-extent drags', () => {
    expect(shapePath('rect', P(3, 3), P(3, 9), 's')).toBeNull();
    expect(shapePath('ellipse', P(3, 3), P(9, 3), 's')).toBeNull();
    expect(shapePath('line', P(3, 3), P(3, 3), 's')).toBeNull();
  });
});

describe('shape/add', () => {
  it('appends the shape, selects its anchors, and undoes in one step', () => {
    const path = shapePath('rect', P(2, 2), P(8, 8), 's')!;
    const added = editorReducer(createEditorState([]), { type: 'shape/add', path });
    expect(added.doc.paths).toHaveLength(1);
    expect(added.doc.selection.size).toBe(8);
    expect(editorReducer(added, { type: 'history/undo' }).doc.paths).toHaveLength(0);
  });
});
