import { describe, expect, it } from 'vitest';
import { docReducer } from './reducer';
import { EMPTY_SELECTION } from './geometry';
import { byId, cornerPair, curve, doc, line, path, pathById, polyline, pt, shape, smoothPair } from './testFixtures';

/**
 * The document reducer. Two things are asserted throughout:
 * what an action produces, and that a no-op returns the *same object* —
 * the history layer relies on that reference to skip recording a step.
 */
describe('docReducer', () => {
  describe('paths/replace', () => {
    it('swaps the whole document and drops the selection', () => {
      const before = doc([polyline('P', [pt(0, 0), pt(10, 0)])], ['P1::p1']);
      const next = docReducer(before, { type: 'paths/replace', paths: [] });
      expect(next.paths).toEqual([]);
      expect(next.selection.size).toBe(0);
    });

    it('is a no-op when clearing an already empty canvas', () => {
      const before = doc([]);
      expect(docReducer(before, { type: 'paths/replace', paths: [] })).toBe(before);
    });
  });

  describe('paths/append', () => {
    it('keeps existing paths', () => {
      const before = doc([polyline('P', [pt(0, 0), pt(10, 0)])]);
      const added = polyline('Q', [pt(0, 5), pt(10, 5)]);
      const next = docReducer(before, { type: 'paths/append', paths: [added] });
      expect(next.paths.map((p) => p.id)).toEqual(['P', 'Q']);
    });

    it('is a no-op for an empty import', () => {
      const before = doc([polyline('P', [pt(0, 0), pt(10, 0)])]);
      expect(docReducer(before, { type: 'paths/append', paths: [] })).toBe(before);
    });
  });

  describe('nodes/translate', () => {
    it('drags the attached control along with its anchor', () => {
      const before = doc([path('P', [curve('a', pt(0, 0), pt(2, 2), pt(8, 0), pt(10, 0))])], ['a::p1']);
      const a = byId(docReducer(before, { type: 'nodes/translate', delta: pt(1, 1) }), 'a');
      expect(a.p1).toEqual(pt(1, 1));
      expect(a.c1).toEqual(pt(3, 3));
      // The far end of the segment stays put.
      expect(a.p2).toEqual(pt(10, 0));
      expect(a.c2).toEqual(pt(8, 0));
    });

    it('leaves untouched paths identical by reference', () => {
      const other = polyline('Q', [pt(0, 5), pt(10, 5)]);
      const before = doc([polyline('P', [pt(0, 0), pt(10, 0)]), other], ['P1::p1']);
      const next = docReducer(before, { type: 'nodes/translate', delta: pt(1, 0) });
      expect(pathById(next, 'Q')).toBe(other);
    });

    it('is a no-op for a zero delta', () => {
      const before = doc([polyline('P', [pt(0, 0), pt(10, 0)])], ['P1::p1']);
      expect(docReducer(before, { type: 'nodes/translate', delta: pt(0, 0) })).toBe(before);
    });

    it('is a no-op when nothing is selected', () => {
      const before = doc([polyline('P', [pt(0, 0), pt(10, 0)])]);
      expect(docReducer(before, { type: 'nodes/translate', delta: pt(1, 1) })).toBe(before);
    });

    describe('handle mirroring', () => {
      it("follow: dragging c2 swings the next segment's c1 across the anchor", () => {
        const before = doc([smoothPair()], ['a::c2']);
        const next = docReducer(before, { type: 'nodes/translate', delta: pt(0, -2), mirror: 'follow' });
        expect(byId(next, 'a').c2).toEqual(pt(8, -6));
        expect(byId(next, 'b').c1).toEqual(pt(12, 6));
      });

      it("follow: dragging c1 swings the previous segment's c2", () => {
        const before = doc([smoothPair()], ['b::c1']);
        const next = docReducer(before, { type: 'nodes/translate', delta: pt(-3, -11), mirror: 'follow' });
        expect(byId(next, 'b').c1).toEqual(pt(12, 4));
        expect(byId(next, 'a').c2).toEqual(pt(8, -4));
      });

      it('follow: a corner junction is not mirrored', () => {
        const before = doc([cornerPair()], ['a::c2']);
        const next = docReducer(before, { type: 'nodes/translate', delta: pt(0, -2), mirror: 'follow' });
        expect(byId(next, 'b').c1).toEqual(pt(15, 15));
      });

      it('follow: mirrors across the seam of a closed path', () => {
        const loop = path(
          'P',
          [
            curve('a', pt(0, 0), pt(0, 0), pt(8, -4), pt(10, 0)),
            curve('b', pt(10, 0), pt(10, 0), pt(2, 4), pt(0, 0), { isSmoothP2: true }),
          ],
          true
        );
        // b closes the loop back onto a's start, so b's c2 pairs with a's c1.
        const next = docReducer(doc([loop], ['b::c2']), {
          type: 'nodes/translate',
          delta: pt(0, 2),
          mirror: 'follow',
        });
        expect(byId(next, 'b').c2).toEqual(pt(2, 6));
        expect(byId(next, 'a').c1).toEqual(pt(-2, -6));
      });

      it('break: Alt-dragging c2 turns the junction into a corner', () => {
        const before = doc([smoothPair()], ['a::c2']);
        const next = docReducer(before, { type: 'nodes/translate', delta: pt(0, -2), mirror: 'break' });
        expect(byId(next, 'a').isSmoothP2).toBe(false);
        expect(byId(next, 'b').c1).toEqual(pt(15, 15));
      });

      it('break: Alt-dragging c1 breaks the junction behind it', () => {
        const before = doc([smoothPair()], ['b::c1']);
        const next = docReducer(before, { type: 'nodes/translate', delta: pt(1, 1), mirror: 'break' });
        expect(byId(next, 'a').isSmoothP2).toBe(false);
      });

      it('none: arrow-key nudges move the handle alone', () => {
        const before = doc([smoothPair()], ['a::c2']);
        const next = docReducer(before, { type: 'nodes/translate', delta: pt(0, -2) });
        expect(byId(next, 'b').c1).toEqual(pt(15, 15));
      });

      it('does not mirror when more than one node is selected', () => {
        const before = doc([smoothPair()], ['a::c2', 'b::c2']);
        const next = docReducer(before, { type: 'nodes/translate', delta: pt(0, -2), mirror: 'follow' });
        expect(byId(next, 'b').c1).toEqual(pt(15, 15));
      });
    });
  });

  describe('nodes/scale', () => {
    const before = doc([polyline('P', [pt(0, 0), pt(10, 0)])], ['P1::p1', 'P1::p2']);
    const from = {
      'P1::p1': pt(0, 0),
      'P1::c1': pt(0, 0),
      'P1::c2': pt(10, 0),
      'P1::p2': pt(10, 0),
    };

    it('scales captured nodes around the fixed origin', () => {
      const next = docReducer(before, { type: 'nodes/scale', origin: pt(0, 0), sx: 2, sy: 1, from });
      expect(byId(next, 'P1').p2).toEqual(pt(20, 0));
      expect(byId(next, 'P1').p1).toEqual(pt(0, 0));
    });

    it('is a no-op at scale 1 — dragging back to the start restores the shape', () => {
      expect(docReducer(before, { type: 'nodes/scale', origin: pt(0, 0), sx: 1, sy: 1, from })).toBe(before);
    });
  });

  describe('nodes/delete', () => {
    // A 4-segment open chain: P1 P2 P3 P4.
    const chain = () => polyline('P', [pt(0, 0), pt(10, 0), pt(20, 0), pt(30, 0), pt(40, 0)]);

    it('removes the segments adjoining a selected anchor', () => {
      const next = docReducer(doc([chain()], ['P4::p2']), { type: 'nodes/delete' });
      expect(shape(next)).toEqual([['P1', 'P2', 'P3']]);
      expect(next.selection.size).toBe(0);
    });

    it('splits the path when the hole is in the middle', () => {
      // Deleting a middle segment genuinely breaks the chain in two.
      const next = docReducer(doc([chain()], ['P2::p1', 'P2::p2']), { type: 'nodes/delete' });
      expect(shape(next)).toEqual([['P1'], ['P3', 'P4']]);
      expect(next.paths.map((p) => p.id)).toEqual(['P', 'P/1']);
      expect(next.paths.every((p) => !p.closed)).toBe(true);
    });

    it('does not collide with a path id that already exists', () => {
      const next = docReducer(doc([chain(), polyline('P/1', [pt(0, 9), pt(1, 9)])], ['P2::p1']), {
        type: 'nodes/delete',
      });
      expect(next.paths.map((p) => p.id)).toEqual(['P', 'P/2', 'P/1']);
    });

    it('opens a closed path without splitting it', () => {
      // Cutting one segment out of a loop leaves a single open chain, rotated
      // so it starts right after the hole.
      const loop = polyline('P', [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 0)], true);
      const next = docReducer(doc([loop], ['P1::p1', 'P1::p2']), { type: 'nodes/delete' });
      expect(shape(next)).toEqual([['P2', 'P3']]);
      expect(pathById(next, 'P').closed).toBe(false);
    });

    it('drops a path entirely when every segment goes', () => {
      const next = docReducer(doc([polyline('P', [pt(0, 0), pt(10, 0)])], ['P1::p1']), {
        type: 'nodes/delete',
      });
      expect(next.paths).toEqual([]);
    });

    it('leaves other paths alone', () => {
      const other = polyline('Q', [pt(0, 5), pt(10, 5)], true);
      const next = docReducer(doc([chain(), other], ['P1::p1']), { type: 'nodes/delete' });
      expect(pathById(next, 'Q')).toBe(other);
    });

    it('retracts control points into their anchors when only handles are selected', () => {
      const before = doc(
        [path('P', [curve('a', pt(0, 0), pt(2, 2), pt(8, 4), pt(10, 0), { isSmoothP2: true })])],
        ['a::c1', 'a::c2']
      );
      const a = byId(docReducer(before, { type: 'nodes/delete' }), 'a');
      expect(a.c1).toEqual(pt(0, 0));
      expect(a.c2).toEqual(pt(10, 0));
      expect(a.isSmoothP2).toBe(false);
      // The anchors themselves survive.
      expect(a.p1).toEqual(pt(0, 0));
      expect(a.p2).toEqual(pt(10, 0));
    });

    it('is a no-op with an empty selection', () => {
      const before = doc([chain()]);
      expect(docReducer(before, { type: 'nodes/delete' })).toBe(before);
    });
  });

  describe('anchor/toggleSmooth', () => {
    it('makes a corner smooth and mirrors the outgoing handle', () => {
      const next = docReducer(doc([cornerPair()], ['a::p2']), { type: 'anchor/toggleSmooth' });
      expect(byId(next, 'a').isSmoothP2).toBe(true);
      expect(byId(next, 'b').c1).toEqual(pt(12, 4));
    });

    it('resolves a p1 selection to the segment arriving at that anchor', () => {
      const next = docReducer(doc([cornerPair()], ['b::p1']), { type: 'anchor/toggleSmooth' });
      expect(byId(next, 'a').isSmoothP2).toBe(true);
    });

    it('turning it back to a corner leaves the handles where they are', () => {
      const next = docReducer(doc([smoothPair()], ['a::p2']), { type: 'anchor/toggleSmooth' });
      expect(byId(next, 'a').isSmoothP2).toBe(false);
      expect(byId(next, 'b').c1).toEqual(pt(15, 15));
    });

    it('takes an explicit anchorKey (Alt+click) over the selection', () => {
      const next = docReducer(doc([cornerPair()], []), {
        type: 'anchor/toggleSmooth',
        anchorKey: 'a::p2',
      });
      expect(byId(next, 'a').isSmoothP2).toBe(true);
    });

    it('gives a mixed selection one common value', () => {
      const p = path('P', [
        line('a', pt(0, 0), pt(10, 0), { isSmoothP2: false }),
        line('b', pt(10, 0), pt(20, 0), { isSmoothP2: true }),
      ]);
      const next = docReducer(doc([p], ['a::p2', 'b::p2']), { type: 'anchor/toggleSmooth' });
      expect(pathById(next, 'P').segments.map((s) => s.isSmoothP2)).toEqual([true, true]);
    });

    it('handles the seam of a closed path', () => {
      const loop = polyline('P', [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 0)], true);
      // P1::p1 is the seam: the arriving segment is the last one, P3.
      const next = docReducer(doc([loop], ['P1::p1']), { type: 'anchor/toggleSmooth' });
      expect(byId(next, 'P3').isSmoothP2).toBe(true);
    });

    it('is a no-op when the selection holds no anchors', () => {
      const before = doc([smoothPair()], ['a::c1']);
      expect(docReducer(before, { type: 'anchor/toggleSmooth' })).toBe(before);
    });
  });

  describe('path/toggleClosed', () => {
    const open = () => polyline('P', [pt(0, 0), pt(10, 0), pt(5, 9)]);

    it('closing snaps the tail back onto the head', () => {
      const next = docReducer(doc([open()], ['P1::p1']), { type: 'path/toggleClosed' });
      expect(pathById(next, 'P').closed).toBe(true);
      expect(byId(next, 'P2').p2).toEqual(pt(0, 0));
    });

    it('reopening only clears the flag', () => {
      const closed = { ...open(), closed: true };
      const next = docReducer(doc([closed], ['P1::p1']), { type: 'path/toggleClosed' });
      expect(pathById(next, 'P').closed).toBe(false);
    });

    it('only touches paths the selection reaches', () => {
      const other = polyline('Q', [pt(0, 20), pt(5, 20)]);
      const next = docReducer(doc([open(), other], ['P1::p1']), { type: 'path/toggleClosed' });
      expect(pathById(next, 'Q')).toBe(other);
    });

    it('is a no-op with an empty selection', () => {
      const before = doc([open()]);
      expect(docReducer(before, { type: 'path/toggleClosed' })).toBe(before);
    });
  });

  describe('path/reverse', () => {
    it('flips direction while keeping ids, so callers can still address segments', () => {
      const p = path('P', [
        line('a', pt(0, 0), pt(10, 0), { isSmoothP2: true }),
        line('b', pt(10, 0), pt(20, 5)),
      ]);
      const next = docReducer(doc([p]), { type: 'path/reverse', pathId: 'P' });
      const segs = pathById(next, 'P').segments;
      expect(segs.map((s) => s.id)).toEqual(['b', 'a']);
      expect(segs[0].p1).toEqual(pt(20, 5));
      expect(segs[1].p2).toEqual(pt(0, 0));
      // Smoothness follows the junction at (10,0), now the middle of the chain.
      expect(segs[0].isSmoothP2).toBe(true);
      expect(segs[1].isSmoothP2).toBe(false);
    });

    it('is a no-op for an unknown path', () => {
      const before = doc([polyline('P', [pt(0, 0), pt(10, 0)])]);
      expect(docReducer(before, { type: 'path/reverse', pathId: 'nope' })).toBe(before);
    });
  });

  describe('segment/split', () => {
    it('replaces the segment in place with the two halves', () => {
      const p = polyline('P', [pt(0, 0), pt(10, 0), pt(20, 0)]);
      const next = docReducer(doc([p]), {
        type: 'segment/split',
        segmentId: 'P1',
        t: 0.5,
        ids: ['x', 'y'],
      });
      expect(shape(next)).toEqual([['x', 'y', 'P2']]);
    });

    it('keeps the original endpoints and joins the halves at the cut', () => {
      const next = docReducer(doc([polyline('P', [pt(0, 0), pt(10, 0)])]), {
        type: 'segment/split',
        segmentId: 'P1',
        t: 0.5,
        ids: ['x', 'y'],
      });
      const [left, right] = pathById(next, 'P').segments;
      expect(left.p1).toEqual(pt(0, 0));
      expect(right.p2).toEqual(pt(10, 0));
      expect(left.p2).toEqual(right.p1);
      expect(left.p2).toEqual(pt(5, 0));
    });

    it('is a no-op for an unknown segment', () => {
      const before = doc([polyline('P', [pt(0, 0), pt(10, 0)])]);
      expect(docReducer(before, { type: 'segment/split', segmentId: 'x', t: 0.5, ids: ['1', '2'] })).toBe(
        before
      );
    });
  });

  describe('segment/erase', () => {
    it('drops the segment and any selection pointing at it', () => {
      const p = polyline('P', [pt(0, 0), pt(10, 0), pt(20, 0)]);
      const next = docReducer(doc([p], ['P1::p1', 'P2::p1']), {
        type: 'segment/erase',
        segmentId: 'P1',
      });
      expect(shape(next)).toEqual([['P2']]);
      expect([...next.selection]).toEqual(['P2::p1']);
    });

    it('splits the path when erasing from the middle', () => {
      const p = polyline('P', [pt(0, 0), pt(10, 0), pt(20, 0), pt(30, 0)]);
      const next = docReducer(doc([p]), { type: 'segment/erase', segmentId: 'P2' });
      expect(shape(next)).toEqual([['P1'], ['P3']]);
    });

    it('is a no-op for an unknown segment', () => {
      const before = doc([polyline('P', [pt(0, 0), pt(10, 0)])]);
      expect(docReducer(before, { type: 'segment/erase', segmentId: 'x' })).toBe(before);
    });
  });

  describe('pen', () => {
    it('commit starts a new path when the id is unknown', () => {
      const next = docReducer(doc([]), {
        type: 'pen/commit',
        id: 'a',
        pathId: 'P',
        from: pt(0, 0),
        control: pt(0, 0),
        to: pt(10, 0),
        closing: false,
      });
      expect(shape(next)).toEqual([['a']]);
      expect(pathById(next, 'P').closed).toBe(false);
      expect([...next.selection]).toEqual(['a::p2']);
    });

    it('commit appends to the path being drawn', () => {
      const before = doc([polyline('P', [pt(0, 0), pt(10, 0)])]);
      const next = docReducer(before, {
        type: 'pen/commit',
        id: 'b',
        pathId: 'P',
        from: pt(10, 0),
        control: pt(12, 4),
        to: pt(20, 0),
        closing: false,
      });
      expect(shape(next)).toEqual([['P1', 'b']]);
      const b = byId(next, 'b');
      expect(b.p1).toEqual(pt(10, 0));
      expect(b.c1).toEqual(pt(12, 4));
      expect(b.p2).toEqual(pt(20, 0));
    });

    it('commit closes the path when the loop is completed', () => {
      const before = doc([polyline('P', [pt(0, 0), pt(10, 0)])]);
      const next = docReducer(before, {
        type: 'pen/commit',
        id: 'b',
        pathId: 'P',
        from: pt(10, 0),
        control: pt(10, 0),
        to: pt(0, 0),
        closing: true,
      });
      expect(pathById(next, 'P').closed).toBe(true);
    });

    it('join bridges to another path and absorbs its segments', () => {
      const before = doc([
        polyline('P', [pt(0, 0), pt(5, 0)]),
        polyline('Q', [pt(9, 0), pt(20, 0)]),
      ]);
      const next = docReducer(before, {
        type: 'pen/join',
        id: 'bridge',
        pathId: 'P',
        from: pt(5, 0),
        control: pt(5, 0),
        target: { pathId: 'Q', end: 'head', point: pt(9, 0) },
      });
      expect(next.paths.map((p) => p.id)).toEqual(['P']);
      expect(shape(next)).toEqual([['P1', 'bridge', 'Q1']]);
      expect(byId(next, 'bridge').p2).toEqual(pt(9, 0));
      expect([...next.selection]).toEqual(['bridge::p2']);
    });

    it('join reverses the target when the bridge lands on its tail', () => {
      const before = doc([
        polyline('P', [pt(0, 0), pt(5, 0)]),
        polyline('Q', [pt(20, 0), pt(9, 0)]),
      ]);
      const next = docReducer(before, {
        type: 'pen/join',
        id: 'bridge',
        pathId: 'P',
        from: pt(5, 0),
        control: pt(5, 0),
        target: { pathId: 'Q', end: 'tail', point: pt(9, 0) },
      });
      // The adopted segment now runs away from the bridge, keeping chain order.
      expect(byId(next, 'Q1').p1).toEqual(pt(9, 0));
      expect(byId(next, 'Q1').p2).toEqual(pt(20, 0));
    });

    it('join is a no-op for an unknown target', () => {
      const before = doc([polyline('P', [pt(0, 0), pt(5, 0)])]);
      expect(
        docReducer(before, {
          type: 'pen/join',
          id: 'bridge',
          pathId: 'P',
          from: pt(5, 0),
          control: pt(5, 0),
          target: { pathId: 'nope', end: 'head', point: pt(9, 0) },
        })
      ).toBe(before);
    });

    it('dragHandle pulls a mirrored pair out of the anchor just placed', () => {
      const before = doc([polyline('P', [pt(0, 0), pt(10, 0)])]);
      const a = byId(docReducer(before, { type: 'pen/dragHandle', segmentId: 'P1', point: pt(13, 4) }), 'P1');
      expect(a.c2).toEqual(pt(7, -4));
      expect(a.isSmoothP2).toBe(true);
    });

    it("dragHandle on a closing segment also swings the start anchor's handle", () => {
      const loop = polyline('P', [pt(0, 0), pt(10, 0), pt(0, 0)], true);
      const next = docReducer(doc([loop]), {
        type: 'pen/dragHandle',
        segmentId: 'P2',
        point: pt(3, 3),
      });
      expect(byId(next, 'P2').c2).toEqual(pt(-3, -3));
      expect(byId(next, 'P1').c1).toEqual(pt(3, 3));
    });

    it('dragHandle with Alt freezes the incoming handle and drops the smooth flag', () => {
      // Handles already pulled out symmetrically, then Alt is pressed.
      const before = doc([
        path('P', [curve('a', pt(0, 0), pt(0, 0), pt(7, -4), pt(10, 0), { isSmoothP2: true })]),
      ]);
      const next = docReducer(before, {
        type: 'pen/dragHandle',
        segmentId: 'a',
        point: pt(20, 20),
        break: true,
      });
      expect(byId(next, 'a').c2).toEqual(pt(7, -4));
      expect(byId(next, 'a').isSmoothP2).toBe(false);
    });

    it('dragHandle with Alt is a no-op once the junction is already a corner', () => {
      // A held Alt fires on every pointer move; none of them may add history.
      const before = doc([
        path('P', [curve('a', pt(0, 0), pt(0, 0), pt(7, -4), pt(10, 0), { isSmoothP2: false })]),
      ]);
      expect(
        docReducer(before, { type: 'pen/dragHandle', segmentId: 'a', point: pt(20, 20), break: true })
      ).toBe(before);
    });

    it('dragHandle with Alt still drives the outgoing handle across a closing seam', () => {
      // The cursor always owns the outgoing handle; Alt only cuts the incoming one.
      const loop = polyline('P', [pt(0, 0), pt(10, 0), pt(0, 0)], true);
      const next = docReducer(doc([loop]), {
        type: 'pen/dragHandle',
        segmentId: 'P2',
        point: pt(3, 3),
        break: true,
      });
      expect(byId(next, 'P1').c1).toEqual(pt(3, 3));
      expect(byId(next, 'P2').c2).toEqual(pt(0, 0));
      // Unset and false both read as "corner"; the flag is optional.
      expect(byId(next, 'P2').isSmoothP2).toBeFalsy();
    });

    it('releasing Alt re-mirrors the pair', () => {
      const before = doc([
        path('P', [curve('a', pt(0, 0), pt(0, 0), pt(7, -4), pt(10, 0), { isSmoothP2: false })]),
      ]);
      const next = docReducer(before, {
        type: 'pen/dragHandle',
        segmentId: 'a',
        point: pt(13, 4),
        break: false,
      });
      expect(byId(next, 'a').c2).toEqual(pt(7, -4));
      expect(byId(next, 'a').isSmoothP2).toBe(true);
    });

    it('dragHandle is a no-op for an unknown segment', () => {
      const before = doc([polyline('P', [pt(0, 0), pt(10, 0)])]);
      expect(docReducer(before, { type: 'pen/dragHandle', segmentId: 'x', point: pt(1, 1) })).toBe(before);
    });
  });

  describe('selection', () => {
    const document = () =>
      doc([polyline('P', [pt(0, 0), pt(10, 0), pt(20, 0)]), polyline('Q', [pt(0, 20), pt(10, 20)])]);

    it('set replaces the selection', () => {
      const next = docReducer(doc(document().paths, ['P1::p1']), {
        type: 'selection/set',
        keys: ['P2::p2'],
      });
      expect([...next.selection]).toEqual(['P2::p2']);
    });

    it('set is a no-op when the keys are unchanged', () => {
      const before = doc(document().paths, ['P1::p1']);
      expect(docReducer(before, { type: 'selection/set', keys: ['P1::p1'] })).toBe(before);
    });

    it('toggle adds and removes (Shift+click)', () => {
      const before = doc(document().paths, ['P1::p1']);
      const added = docReducer(before, { type: 'selection/toggle', keys: ['P2::p2'] });
      expect([...added.selection].sort()).toEqual(['P1::p1', 'P2::p2']);
      const removed = docReducer(added, { type: 'selection/toggle', keys: ['P1::p1'] });
      expect([...removed.selection]).toEqual(['P2::p2']);
    });

    it('path selects every anchor of the clicked path', () => {
      const next = docReducer(document(), { type: 'selection/path', pathId: 'P', additive: false });
      expect([...next.selection].sort()).toEqual(['P1::p1', 'P1::p2', 'P2::p1', 'P2::p2']);
    });

    it('path keeps a wider selection when the path is already fully selected', () => {
      const before = doc(document().paths, ['P1::p1', 'P1::p2', 'P2::p1', 'P2::p2', 'Q1::p1']);
      expect(docReducer(before, { type: 'selection/path', pathId: 'P', additive: false })).toBe(before);
    });

    it('path with Shift deselects a fully selected path', () => {
      const before = doc(document().paths, ['P1::p1', 'P1::p2', 'P2::p1', 'P2::p2', 'Q1::p1']);
      const next = docReducer(before, { type: 'selection/path', pathId: 'P', additive: true });
      expect([...next.selection]).toEqual(['Q1::p1']);
    });

    it('path is a no-op for an unknown path', () => {
      const before = document();
      expect(docReducer(before, { type: 'selection/path', pathId: 'nope', additive: false })).toBe(before);
    });

    it('segment takes just that segment’s two anchors', () => {
      const next = docReducer(document(), { type: 'selection/segment', segmentId: 'P2', additive: false });
      expect([...next.selection].sort()).toEqual(['P2::p1', 'P2::p2']);
    });

    it('segment keeps a wider selection when it is already fully selected', () => {
      const before = doc(document().paths, ['P2::p1', 'P2::p2', 'Q1::p1']);
      expect(docReducer(before, { type: 'selection/segment', segmentId: 'P2', additive: false })).toBe(before);
    });

    it('segment with Shift adds then removes the pair', () => {
      const before = doc(document().paths, ['Q1::p1']);
      const added = docReducer(before, { type: 'selection/segment', segmentId: 'P1', additive: true });
      expect([...added.selection].sort()).toEqual(['P1::p1', 'P1::p2', 'Q1::p1']);
      const removed = docReducer(added, { type: 'selection/segment', segmentId: 'P1', additive: true });
      expect([...removed.selection]).toEqual(['Q1::p1']);
    });

    it('segment is a no-op for an unknown segment', () => {
      const before = document();
      expect(docReducer(before, { type: 'selection/segment', segmentId: 'nope', additive: false })).toBe(before);
    });

    it('box selects anchors inside the marquee, bounds inclusive', () => {
      const next = docReducer(document(), { type: 'selection/box', min: pt(0, 0), max: pt(10, 0) });
      expect([...next.selection].sort()).toEqual(['P1::p1', 'P1::p2', 'P2::p1']);
    });

    it('box in paths mode takes a whole path when any anchor is inside', () => {
      // The box only reaches P's first anchor, but object mode takes all of P
      // — and must not drag Q in, whose anchors are all outside.
      const next = docReducer(document(), {
        type: 'selection/box',
        min: pt(-1, -1),
        max: pt(1, 1),
        mode: 'paths',
      });
      expect([...next.selection].sort()).toEqual(['P1::p1', 'P1::p2', 'P2::p1', 'P2::p2']);
    });

    it('box in paths mode selects nothing when the marquee is empty', () => {
      const before = document();
      expect(
        docReducer(before, { type: 'selection/box', min: pt(50, 50), max: pt(60, 60), mode: 'paths' })
      ).toBe(before);
    });

    it('clear is a no-op when nothing is selected', () => {
      const before = document();
      expect(docReducer(before, { type: 'selection/clear' })).toBe(before);
    });

    it('clear empties a non-empty selection without touching the paths', () => {
      const before = doc(document().paths, ['P1::p1']);
      const next = docReducer(before, { type: 'selection/clear' });
      expect(next.selection).toBe(EMPTY_SELECTION);
      expect(next.paths).toBe(before.paths);
    });
  });
});
