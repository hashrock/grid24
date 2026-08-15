import { describe, expect, it } from 'vitest';
import {
  expandToControls,
  incomingAt,
  near,
  outgoingAt,
  parseNodeKey,
  pointKey,
  pruneSelection,
  reflect,
  reversePath,
  sameKeys,
} from './geometry';
import { line, pt } from './testFixtures';

describe('node keys', () => {
  it('round-trips', () => {
    expect(parseNodeKey(pointKey('abc', 'c2'))).toEqual({ segmentId: 'abc', type: 'c2' });
  });

  it('survives ids containing a colon', () => {
    expect(parseNodeKey('a:b::p1')).toEqual({ segmentId: 'a:b', type: 'p1' });
  });

  it('rejects malformed keys', () => {
    expect(parseNodeKey('nope')).toBeNull();
    expect(parseNodeKey('abc::p9')).toBeNull();
  });
});

describe('expandToControls', () => {
  it('adds the control attached to each selected anchor', () => {
    expect([...expandToControls(new Set(['a::p1', 'b::p2']))].sort()).toEqual([
      'a::c1',
      'a::p1',
      'b::c2',
      'b::p2',
    ]);
  });

  it('leaves a selected control alone', () => {
    expect([...expandToControls(new Set(['a::c1']))]).toEqual(['a::c1']);
  });
});

describe('connectivity', () => {
  const segments = [line('a', 'P', pt(0, 0), pt(10, 0)), line('b', 'P', pt(10, 0), pt(20, 0))];

  it('treats coincident anchors as one junction', () => {
    expect(near(pt(10, 0), pt(10.0005, 0))).toBe(true);
    expect(near(pt(10, 0), pt(10.01, 0))).toBe(false);
  });

  it('finds the segment arriving at and leaving a junction', () => {
    expect(incomingAt(segments, pt(10, 0))?.id).toBe('a');
    expect(outgoingAt(segments, pt(10, 0))?.id).toBe('b');
    expect(incomingAt(segments, pt(99, 99))).toBeNull();
  });
});

describe('reflect', () => {
  it('mirrors a point through the anchor', () => {
    expect(reflect(pt(8, -4), pt(10, 0))).toEqual(pt(12, 4));
  });
});

describe('reversePath', () => {
  it('flips each segment and the chain order, keeping ids', () => {
    const path = [
      line('a', 'P', pt(0, 0), pt(10, 0)),
      line('b', 'P', pt(10, 0), pt(20, 0)),
      line('c', 'P', pt(20, 0), pt(30, 0)),
    ];
    const reversed = reversePath(path);
    expect(reversed.map((s) => s.id)).toEqual(['c', 'b', 'a']);
    expect(reversed[0].p1).toEqual(pt(30, 0));
    expect(reversed[2].p2).toEqual(pt(0, 0));
  });

  it('moves smoothness with the junction, not the segment', () => {
    // a-b junction is smooth; b-c is not.
    const path = [
      line('a', 'P', pt(0, 0), pt(10, 0), { isSmoothP2: true }),
      line('b', 'P', pt(10, 0), pt(20, 0), { isSmoothP2: false }),
      line('c', 'P', pt(20, 0), pt(30, 0), { isSmoothP2: false }),
    ];
    const reversed = reversePath(path);
    // Reversed chain is c,b,a: the b-c junction is now after c, the a-b after b.
    expect(reversed.map((s) => s.isSmoothP2)).toEqual([false, true, false]);
  });

  it('swaps the control points so the curve keeps its shape', () => {
    const path = [
      { ...line('a', 'P', pt(0, 0), pt(10, 0)), c1: pt(2, 5), c2: pt(8, 5) },
    ];
    const [reversed] = reversePath(path);
    expect(reversed.c1).toEqual(pt(8, 5));
    expect(reversed.c2).toEqual(pt(2, 5));
  });
});

describe('pruneSelection', () => {
  const segments = [line('a', 'P', pt(0, 0), pt(10, 0))];

  it('drops keys whose segment is gone', () => {
    expect([...pruneSelection(new Set(['a::p1', 'gone::p1']), segments)]).toEqual(['a::p1']);
  });

  it('returns the same set when everything is still alive', () => {
    const selection = new Set(['a::p1']);
    expect(pruneSelection(selection, segments)).toBe(selection);
  });
});

describe('sameKeys', () => {
  it('compares by content', () => {
    expect(sameKeys(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameKeys(new Set(['a']), new Set(['a', 'b']))).toBe(false);
    expect(sameKeys(new Set(['a']), new Set(['b']))).toBe(false);
  });
});
