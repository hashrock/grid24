import { describe, expect, it } from 'vitest';
import { docReducer } from './reducer';
import { EMPTY_SELECTION } from './geometry';
import { byId, curve, doc, line, pt, smoothPair } from './testFixtures';

/**
 * The document reducer. Two things are asserted throughout:
 * what an action produces, and that a no-op returns the *same object* —
 * the history layer relies on that reference to skip recording a step.
 */
describe('docReducer', () => {
  describe('segments/replace', () => {
    it('swaps the whole document and drops the selection', () => {
      const before = doc([line('a', 'P', pt(0, 0), pt(10, 0))], ['a::p1']);
      const next = docReducer(before, { type: 'segments/replace', segments: [] });
      expect(next.segments).toEqual([]);
      expect(next.selection.size).toBe(0);
    });

    it('is a no-op when clearing an already empty canvas', () => {
      const before = doc([]);
      expect(docReducer(before, { type: 'segments/replace', segments: [] })).toBe(before);
    });
  });

  describe('segments/append', () => {
    it('keeps existing segments', () => {
      const before = doc([line('a', 'P', pt(0, 0), pt(10, 0))]);
      const added = line('b', 'Q', pt(0, 5), pt(10, 5));
      const next = docReducer(before, { type: 'segments/append', segments: [added] });
      expect(next.segments.map((s) => s.id)).toEqual(['a', 'b']);
    });

    it('is a no-op for an empty import', () => {
      const before = doc([line('a', 'P', pt(0, 0), pt(10, 0))]);
      expect(docReducer(before, { type: 'segments/append', segments: [] })).toBe(before);
    });
  });

  describe('nodes/translate', () => {
    it('drags the attached control along with its anchor', () => {
      const before = doc([curve('a', 'P', pt(0, 0), pt(2, 2), pt(8, 0), pt(10, 0))], ['a::p1']);
      const a = byId(docReducer(before, { type: 'nodes/translate', delta: pt(1, 1) }), 'a');
      expect(a.p1).toEqual(pt(1, 1));
      expect(a.c1).toEqual(pt(3, 3));
      // The far end of the segment stays put.
      expect(a.p2).toEqual(pt(10, 0));
      expect(a.c2).toEqual(pt(8, 0));
    });

    it('leaves unselected segments untouched by reference', () => {
      const before = doc(
        [line('a', 'P', pt(0, 0), pt(10, 0)), line('b', 'Q', pt(0, 5), pt(10, 5))],
        ['a::p1']
      );
      const next = docReducer(before, { type: 'nodes/translate', delta: pt(1, 0) });
      expect(byId(next, 'b')).toBe(byId(before, 'b'));
    });

    it('is a no-op for a zero delta', () => {
      const before = doc([line('a', 'P', pt(0, 0), pt(10, 0))], ['a::p1']);
      expect(docReducer(before, { type: 'nodes/translate', delta: pt(0, 0) })).toBe(before);
    });

    it('is a no-op when nothing is selected', () => {
      const before = doc([line('a', 'P', pt(0, 0), pt(10, 0))]);
      expect(docReducer(before, { type: 'nodes/translate', delta: pt(1, 1) })).toBe(before);
    });

    describe('handle mirroring', () => {
      it("follow: dragging c2 swings the next segment's c1 across the anchor", () => {
        const before = doc(smoothPair(), ['a::c2']);
        const next = docReducer(before, {
          type: 'nodes/translate',
          delta: pt(0, -2),
          mirror: 'follow',
        });
        expect(byId(next, 'a').c2).toEqual(pt(8, -6));
        expect(byId(next, 'b').c1).toEqual(pt(12, 6));
      });

      it("follow: dragging c1 swings the previous segment's c2", () => {
        const before = doc(smoothPair(), ['b::c1']);
        const next = docReducer(before, {
          type: 'nodes/translate',
          delta: pt(-3, -11),
          mirror: 'follow',
        });
        expect(byId(next, 'b').c1).toEqual(pt(12, 4));
        expect(byId(next, 'a').c2).toEqual(pt(8, -4));
      });

      it('follow: a corner junction is not mirrored', () => {
        const corner = smoothPair().map((s) => (s.id === 'a' ? { ...s, isSmoothP2: false } : s));
        const before = doc(corner, ['a::c2']);
        const next = docReducer(before, {
          type: 'nodes/translate',
          delta: pt(0, -2),
          mirror: 'follow',
        });
        expect(byId(next, 'b').c1).toEqual(pt(15, 15));
      });

      it('break: Alt-dragging c2 turns the junction into a corner', () => {
        const before = doc(smoothPair(), ['a::c2']);
        const next = docReducer(before, {
          type: 'nodes/translate',
          delta: pt(0, -2),
          mirror: 'break',
        });
        expect(byId(next, 'a').isSmoothP2).toBe(false);
        expect(byId(next, 'b').c1).toEqual(pt(15, 15));
      });

      it('break: Alt-dragging c1 breaks the junction behind it', () => {
        const before = doc(smoothPair(), ['b::c1']);
        const next = docReducer(before, {
          type: 'nodes/translate',
          delta: pt(1, 1),
          mirror: 'break',
        });
        expect(byId(next, 'a').isSmoothP2).toBe(false);
      });

      it('none: arrow-key nudges move the handle alone', () => {
        const before = doc(smoothPair(), ['a::c2']);
        const next = docReducer(before, { type: 'nodes/translate', delta: pt(0, -2) });
        expect(byId(next, 'b').c1).toEqual(pt(15, 15));
      });

      it('does not mirror when more than one node is selected', () => {
        const before = doc(smoothPair(), ['a::c2', 'b::c2']);
        const next = docReducer(before, {
          type: 'nodes/translate',
          delta: pt(0, -2),
          mirror: 'follow',
        });
        expect(byId(next, 'b').c1).toEqual(pt(15, 15));
      });
    });
  });

  describe('nodes/scale', () => {
    const before = doc([line('a', 'P', pt(0, 0), pt(10, 0))], ['a::p1', 'a::p2']);
    const from = {
      'a::p1': pt(0, 0),
      'a::c1': pt(0, 0),
      'a::c2': pt(10, 0),
      'a::p2': pt(10, 0),
    };

    it('scales captured nodes around the fixed origin', () => {
      const next = docReducer(before, {
        type: 'nodes/scale',
        origin: pt(0, 0),
        sx: 2,
        sy: 1,
        from,
      });
      expect(byId(next, 'a').p2).toEqual(pt(20, 0));
      expect(byId(next, 'a').p1).toEqual(pt(0, 0));
    });

    it('is a no-op at scale 1 — dragging back to the start restores the shape', () => {
      expect(
        docReducer(before, { type: 'nodes/scale', origin: pt(0, 0), sx: 1, sy: 1, from })
      ).toBe(before);
    });
  });

  describe('nodes/delete', () => {
    it('removes the segments adjoining a selected anchor and reopens the path', () => {
      const closed = [
        line('a', 'P', pt(0, 0), pt(10, 0), { isClosed: true }),
        line('b', 'P', pt(10, 0), pt(0, 0), { isClosed: true }),
      ];
      const next = docReducer(doc(closed, ['a::p2']), { type: 'nodes/delete' });
      expect(next.segments.map((s) => s.id)).toEqual(['b']);
      expect(byId(next, 'b').isClosed).toBe(false);
      expect(next.selection.size).toBe(0);
    });

    it('leaves other paths closed', () => {
      const segments = [
        line('a', 'P', pt(0, 0), pt(10, 0), { isClosed: true }),
        line('b', 'Q', pt(0, 5), pt(10, 5), { isClosed: true }),
      ];
      const next = docReducer(doc(segments, ['a::p1']), { type: 'nodes/delete' });
      expect(byId(next, 'b').isClosed).toBe(true);
    });

    it('retracts control points into their anchors when only handles are selected', () => {
      const before = doc([curve('a', 'P', pt(0, 0), pt(2, 2), pt(8, 4), pt(10, 0), {
        isSmoothP2: true,
      })], ['a::c1', 'a::c2']);
      const a = byId(docReducer(before, { type: 'nodes/delete' }), 'a');
      expect(a.c1).toEqual(pt(0, 0));
      expect(a.c2).toEqual(pt(10, 0));
      expect(a.isSmoothP2).toBe(false);
      // The anchors themselves survive.
      expect(a.p1).toEqual(pt(0, 0));
      expect(a.p2).toEqual(pt(10, 0));
    });

    it('is a no-op with an empty selection', () => {
      const before = doc([line('a', 'P', pt(0, 0), pt(10, 0))]);
      expect(docReducer(before, { type: 'nodes/delete' })).toBe(before);
    });
  });

  describe('anchor/toggleSmooth', () => {
    it('makes a corner smooth and mirrors the outgoing handle', () => {
      const corner = smoothPair().map((s) => (s.id === 'a' ? { ...s, isSmoothP2: false } : s));
      const next = docReducer(doc(corner, ['a::p2']), { type: 'anchor/toggleSmooth' });
      expect(byId(next, 'a').isSmoothP2).toBe(true);
      expect(byId(next, 'b').c1).toEqual(pt(12, 4));
    });

    it('resolves a p1 selection to the segment arriving at that anchor', () => {
      const corner = smoothPair().map((s) => (s.id === 'a' ? { ...s, isSmoothP2: false } : s));
      const next = docReducer(doc(corner, ['b::p1']), { type: 'anchor/toggleSmooth' });
      expect(byId(next, 'a').isSmoothP2).toBe(true);
    });

    it('turning it back to a corner leaves the handles where they are', () => {
      const next = docReducer(doc(smoothPair(), ['a::p2']), { type: 'anchor/toggleSmooth' });
      expect(byId(next, 'a').isSmoothP2).toBe(false);
      expect(byId(next, 'b').c1).toEqual(pt(15, 15));
    });

    it('takes an explicit anchorKey (Alt+click) over the selection', () => {
      const corner = smoothPair().map((s) => (s.id === 'a' ? { ...s, isSmoothP2: false } : s));
      const next = docReducer(doc(corner, []), { type: 'anchor/toggleSmooth', anchorKey: 'a::p2' });
      expect(byId(next, 'a').isSmoothP2).toBe(true);
    });

    it('gives a mixed selection one common value', () => {
      const segments = [
        line('a', 'P', pt(0, 0), pt(10, 0), { isSmoothP2: false }),
        line('b', 'P', pt(10, 0), pt(20, 0), { isSmoothP2: true }),
      ];
      const next = docReducer(doc(segments, ['a::p2', 'b::p2']), { type: 'anchor/toggleSmooth' });
      expect(next.segments.map((s) => s.isSmoothP2)).toEqual([true, true]);
    });

    it('is a no-op when the selection holds no anchors', () => {
      const before = doc(smoothPair(), ['a::c1']);
      expect(docReducer(before, { type: 'anchor/toggleSmooth' })).toBe(before);
    });
  });

  describe('path/toggleClosed', () => {
    const open = [
      line('a', 'P', pt(0, 0), pt(10, 0)),
      line('b', 'P', pt(10, 0), pt(5, 9)),
    ];

    it('closing snaps the tail back onto the head', () => {
      const next = docReducer(doc(open, ['a::p1']), { type: 'path/toggleClosed' });
      expect(next.segments.every((s) => s.isClosed)).toBe(true);
      expect(byId(next, 'b').p2).toEqual(pt(0, 0));
    });

    it('reopening only clears the flag', () => {
      const closed = open.map((s) => ({ ...s, isClosed: true }));
      const next = docReducer(doc(closed, ['a::p1']), { type: 'path/toggleClosed' });
      expect(next.segments.every((s) => s.isClosed)).toBe(false);
    });

    it('only touches paths the selection reaches', () => {
      const segments = [...open, line('c', 'Q', pt(0, 20), pt(5, 20))];
      const next = docReducer(doc(segments, ['a::p1']), { type: 'path/toggleClosed' });
      expect(byId(next, 'c').isClosed).toBe(false);
    });

    it('is a no-op with an empty selection', () => {
      const before = doc(open);
      expect(docReducer(before, { type: 'path/toggleClosed' })).toBe(before);
    });
  });

  describe('path/reverse', () => {
    it('flips direction while keeping ids, so callers can still address segments', () => {
      const segments = [
        line('a', 'P', pt(0, 0), pt(10, 0), { isSmoothP2: true }),
        line('b', 'P', pt(10, 0), pt(20, 5)),
      ];
      const next = docReducer(doc(segments), { type: 'path/reverse', pathId: 'P' });
      expect(next.segments.map((s) => s.id)).toEqual(['b', 'a']);
      expect(next.segments[0].p1).toEqual(pt(20, 5));
      expect(next.segments[1].p2).toEqual(pt(0, 0));
      // Smoothness follows the junction at (10,0), now the middle of the chain.
      expect(next.segments[0].isSmoothP2).toBe(true);
      expect(next.segments[1].isSmoothP2).toBe(false);
    });

    it('is a no-op for an unknown path', () => {
      const before = doc([line('a', 'P', pt(0, 0), pt(10, 0))]);
      expect(docReducer(before, { type: 'path/reverse', pathId: 'nope' })).toBe(before);
    });
  });

  describe('segment/split', () => {
    it('replaces the segment in place with the two halves', () => {
      const segments = [
        line('a', 'P', pt(0, 0), pt(10, 0)),
        line('b', 'P', pt(10, 0), pt(20, 0)),
      ];
      const next = docReducer(doc(segments), {
        type: 'segment/split',
        segmentId: 'a',
        t: 0.5,
        ids: ['a1', 'a2'],
      });
      expect(next.segments.map((s) => s.id)).toEqual(['a1', 'a2', 'b']);
    });

    it('keeps the original endpoints and joins the halves at the cut', () => {
      const next = docReducer(doc([line('a', 'P', pt(0, 0), pt(10, 0))]), {
        type: 'segment/split',
        segmentId: 'a',
        t: 0.5,
        ids: ['a1', 'a2'],
      });
      const [left, right] = next.segments;
      expect(left.p1).toEqual(pt(0, 0));
      expect(right.p2).toEqual(pt(10, 0));
      expect(left.p2).toEqual(right.p1);
      expect(left.p2).toEqual(pt(5, 0));
    });

    it('is a no-op for an unknown segment', () => {
      const before = doc([line('a', 'P', pt(0, 0), pt(10, 0))]);
      expect(
        docReducer(before, { type: 'segment/split', segmentId: 'x', t: 0.5, ids: ['1', '2'] })
      ).toBe(before);
    });
  });

  describe('segment/erase', () => {
    it('drops the segment and any selection pointing at it', () => {
      const segments = [
        line('a', 'P', pt(0, 0), pt(10, 0)),
        line('b', 'P', pt(10, 0), pt(20, 0)),
      ];
      const next = docReducer(doc(segments, ['a::p1', 'b::p1']), {
        type: 'segment/erase',
        segmentId: 'a',
      });
      expect(next.segments.map((s) => s.id)).toEqual(['b']);
      expect([...next.selection]).toEqual(['b::p1']);
    });

    it('is a no-op for an unknown segment', () => {
      const before = doc([line('a', 'P', pt(0, 0), pt(10, 0))]);
      expect(docReducer(before, { type: 'segment/erase', segmentId: 'x' })).toBe(before);
    });
  });

  describe('pen', () => {
    it('commit appends a segment and selects its new anchor', () => {
      const before = doc([line('a', 'P', pt(0, 0), pt(10, 0))]);
      const next = docReducer(before, {
        type: 'pen/commit',
        id: 'b',
        pathId: 'P',
        from: pt(10, 0),
        control: pt(12, 4),
        to: pt(20, 0),
        closing: false,
      });
      const b = byId(next, 'b');
      expect(b.p1).toEqual(pt(10, 0));
      expect(b.c1).toEqual(pt(12, 4));
      expect(b.p2).toEqual(pt(20, 0));
      expect(b.isClosed).toBe(false);
      expect([...next.selection]).toEqual(['b::p2']);
    });

    it('commit marks the whole path closed when the loop is completed', () => {
      const before = doc([line('a', 'P', pt(0, 0), pt(10, 0))]);
      const next = docReducer(before, {
        type: 'pen/commit',
        id: 'b',
        pathId: 'P',
        from: pt(10, 0),
        control: pt(10, 0),
        to: pt(0, 0),
        closing: true,
      });
      expect(next.segments.every((s) => s.isClosed)).toBe(true);
    });

    it('join bridges to another path and adopts its segments', () => {
      const segments = [
        line('a', 'P', pt(0, 0), pt(5, 0)),
        line('b', 'Q', pt(9, 0), pt(20, 0)),
      ];
      const next = docReducer(doc(segments), {
        type: 'pen/join',
        id: 'bridge',
        pathId: 'P',
        from: pt(5, 0),
        control: pt(5, 0),
        target: { pathId: 'Q', end: 'head', point: pt(9, 0) },
      });
      expect(next.segments.map((s) => s.id)).toEqual(['a', 'bridge', 'b']);
      expect(next.segments.every((s) => s.pathId === 'P')).toBe(true);
      expect(byId(next, 'bridge').p2).toEqual(pt(9, 0));
      expect([...next.selection]).toEqual(['bridge::p2']);
    });

    it('join reverses the target when the bridge lands on its tail', () => {
      const segments = [
        line('a', 'P', pt(0, 0), pt(5, 0)),
        line('b', 'Q', pt(20, 0), pt(9, 0)),
      ];
      const next = docReducer(doc(segments), {
        type: 'pen/join',
        id: 'bridge',
        pathId: 'P',
        from: pt(5, 0),
        control: pt(5, 0),
        target: { pathId: 'Q', end: 'tail', point: pt(9, 0) },
      });
      // The adopted segment now runs away from the bridge, keeping chain order.
      expect(byId(next, 'b').p1).toEqual(pt(9, 0));
      expect(byId(next, 'b').p2).toEqual(pt(20, 0));
    });

    it('dragHandle pulls a mirrored pair out of the anchor just placed', () => {
      const before = doc([line('a', 'P', pt(0, 0), pt(10, 0))]);
      const a = byId(docReducer(before, { type: 'pen/dragHandle', segmentId: 'a', point: pt(13, 4) }), 'a');
      expect(a.c2).toEqual(pt(7, -4));
      expect(a.isSmoothP2).toBe(true);
    });

    it("dragHandle on a closing segment also swings the start anchor's handle", () => {
      const segments = [
        line('a', 'P', pt(0, 0), pt(10, 0), { isClosed: true }),
        line('b', 'P', pt(10, 0), pt(0, 0), { isClosed: true }),
      ];
      const next = docReducer(doc(segments), {
        type: 'pen/dragHandle',
        segmentId: 'b',
        point: pt(3, 3),
      });
      expect(byId(next, 'b').c2).toEqual(pt(-3, -3));
      expect(byId(next, 'a').c1).toEqual(pt(3, 3));
    });

    it('dragHandle is a no-op for an unknown segment', () => {
      const before = doc([line('a', 'P', pt(0, 0), pt(10, 0))]);
      expect(docReducer(before, { type: 'pen/dragHandle', segmentId: 'x', point: pt(1, 1) })).toBe(
        before
      );
    });
  });

  describe('selection', () => {
    const segments = [
      line('a', 'P', pt(0, 0), pt(10, 0)),
      line('b', 'P', pt(10, 0), pt(20, 0)),
      line('c', 'Q', pt(0, 20), pt(10, 20)),
    ];

    it('set replaces the selection', () => {
      const next = docReducer(doc(segments, ['a::p1']), {
        type: 'selection/set',
        keys: ['b::p2'],
      });
      expect([...next.selection]).toEqual(['b::p2']);
    });

    it('set is a no-op when the keys are unchanged', () => {
      const before = doc(segments, ['a::p1']);
      expect(docReducer(before, { type: 'selection/set', keys: ['a::p1'] })).toBe(before);
    });

    it('toggle adds and removes (Shift+click)', () => {
      const before = doc(segments, ['a::p1']);
      const added = docReducer(before, { type: 'selection/toggle', keys: ['b::p2'] });
      expect([...added.selection].sort()).toEqual(['a::p1', 'b::p2']);
      const removed = docReducer(added, { type: 'selection/toggle', keys: ['a::p1'] });
      expect([...removed.selection]).toEqual(['b::p2']);
    });

    it('path selects every anchor of the clicked path', () => {
      const next = docReducer(doc(segments), {
        type: 'selection/path',
        pathId: 'P',
        additive: false,
      });
      expect([...next.selection].sort()).toEqual(['a::p1', 'a::p2', 'b::p1', 'b::p2']);
    });

    it('path keeps a wider selection when the path is already fully selected', () => {
      const before = doc(segments, ['a::p1', 'a::p2', 'b::p1', 'b::p2', 'c::p1']);
      expect(docReducer(before, { type: 'selection/path', pathId: 'P', additive: false })).toBe(
        before
      );
    });

    it('path with Shift deselects a fully selected path', () => {
      const before = doc(segments, ['a::p1', 'a::p2', 'b::p1', 'b::p2', 'c::p1']);
      const next = docReducer(before, { type: 'selection/path', pathId: 'P', additive: true });
      expect([...next.selection]).toEqual(['c::p1']);
    });

    it('box selects anchors inside the marquee, bounds inclusive', () => {
      const next = docReducer(doc(segments), {
        type: 'selection/box',
        min: pt(0, 0),
        max: pt(10, 0),
      });
      expect([...next.selection].sort()).toEqual(['a::p1', 'a::p2', 'b::p1']);
    });

    it('clear is a no-op when nothing is selected', () => {
      const before = doc(segments);
      expect(docReducer(before, { type: 'selection/clear' })).toBe(before);
    });

    it('clear empties a non-empty selection', () => {
      const next = docReducer(doc(segments, ['a::p1']), { type: 'selection/clear' });
      expect(next.selection).toBe(EMPTY_SELECTION);
      expect(next.segments).toBe(segments);
    });
  });
});
