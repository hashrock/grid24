import { describe, expect, it } from 'vitest';
import {
  expandToControls,
  freshPathId,
  incomingAt,
  locateSegment,
  mapPaths,
  mapSegments,
  near,
  outgoingAt,
  parseNodeKey,
  pointKey,
  pruneSelection,
  reflect,
  removeSegments,
  reversePath,
  sameKeys,
} from './geometry';
import { curve, line, path, polyline, pt } from './testFixtures';

describe('node keys', () => {
  it('round-trips', () => {
    expect(parseNodeKey(pointKey('abc', 'c2'))).toEqual({ segmentId: 'abc', type: 'c2' });
  });

  it('survives ids containing a colon', () => {
    expect(parseNodeKey('a::b::p1')).toEqual({ segmentId: 'a::b', type: 'p1' });
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

describe('structure-preserving maps', () => {
  const paths = [polyline('P', [pt(0, 0), pt(10, 0), pt(20, 0)]), polyline('Q', [pt(0, 5), pt(10, 5)])];

  it('returns the same array when no path changed', () => {
    expect(mapPaths(paths, (p) => p)).toBe(paths);
    expect(mapSegments(paths, (s) => s)).toBe(paths);
  });

  it('keeps untouched paths identical by reference', () => {
    const next = mapSegments(paths, (s) => (s.id === 'P1' ? { ...s, isSmoothP2: true } : s));
    expect(next).not.toBe(paths);
    expect(next[1]).toBe(paths[1]);
    expect(next[0]).not.toBe(paths[0]);
    expect(next[0].segments[1]).toBe(paths[0].segments[1]);
  });
});

describe('lookups', () => {
  const paths = [polyline('P', [pt(0, 0), pt(10, 0), pt(20, 0)]), polyline('Q', [pt(0, 5), pt(10, 5)])];

  it('locates a segment with its path and index', () => {
    const found = locateSegment(paths, 'P2');
    expect(found?.path.id).toBe('P');
    expect(found?.index).toBe(1);
    expect(locateSegment(paths, 'nope')).toBeNull();
  });

  it('finds the segments arriving at and leaving a point', () => {
    expect(incomingAt(paths, pt(10, 0))?.id).toBe('P1');
    expect(outgoingAt(paths, pt(10, 0))?.id).toBe('P2');
    expect(incomingAt(paths, pt(99, 99))).toBeNull();
  });

  it('treats coincident anchors as one junction', () => {
    expect(near(pt(10, 0), pt(10.0005, 0))).toBe(true);
    expect(near(pt(10, 0), pt(10.01, 0))).toBe(false);
  });
});

describe('freshPathId', () => {
  it('derives an unused id from the base', () => {
    expect(freshPathId(new Set(['P', 'P/1', 'P/2']), 'P')).toBe('P/3');
    expect(freshPathId(new Set(), 'P')).toBe('P/1');
  });
});

describe('reflect', () => {
  it('mirrors a point through the anchor', () => {
    expect(reflect(pt(8, -4), pt(10, 0))).toEqual(pt(12, 4));
  });
});

describe('reversePath', () => {
  it('flips each segment and the chain order, keeping ids', () => {
    const reversed = reversePath(polyline('P', [pt(0, 0), pt(10, 0), pt(20, 0), pt(30, 0)]));
    expect(reversed.segments.map((s) => s.id)).toEqual(['P3', 'P2', 'P1']);
    expect(reversed.segments[0].p1).toEqual(pt(30, 0));
    expect(reversed.segments[2].p2).toEqual(pt(0, 0));
    expect(reversed.id).toBe('P');
  });

  it('moves smoothness with the junction, not the segment', () => {
    // The a-b junction is smooth; b-c is not.
    const p = path('P', [
      line('a', pt(0, 0), pt(10, 0), { isSmoothP2: true }),
      line('b', pt(10, 0), pt(20, 0), { isSmoothP2: false }),
      line('c', pt(20, 0), pt(30, 0), { isSmoothP2: false }),
    ]);
    // Reversed chain is c,b,a: the b-c junction now sits after c, a-b after b.
    expect(reversePath(p).segments.map((s) => s.isSmoothP2)).toEqual([false, true, false]);
  });

  it('swaps the control points so the curve keeps its shape', () => {
    const p = path('P', [curve('a', pt(0, 0), pt(2, 5), pt(8, 5), pt(10, 0))]);
    const [reversed] = reversePath(p).segments;
    expect(reversed.c1).toEqual(pt(8, 5));
    expect(reversed.c2).toEqual(pt(2, 5));
  });
});

describe('removeSegments', () => {
  const chain = () => polyline('P', [pt(0, 0), pt(10, 0), pt(20, 0), pt(30, 0), pt(40, 0)]);

  it('returns the path untouched when nothing matches', () => {
    const p = chain();
    expect(removeSegments(p, new Set(['nope']), new Set())).toEqual([p]);
  });

  it('keeps one path when the hole is at an end', () => {
    const out = removeSegments(chain(), new Set(['P1']), new Set());
    expect(out.map((p) => p.segments.map((s) => s.id))).toEqual([['P2', 'P3', 'P4']]);
  });

  it('splits into two when the hole is in the middle', () => {
    const out = removeSegments(chain(), new Set(['P2']), new Set(['P']));
    expect(out.map((p) => p.segments.map((s) => s.id))).toEqual([['P1'], ['P3', 'P4']]);
    expect(out.map((p) => p.id)).toEqual(['P', 'P/1']);
  });

  it('splits into three across two holes', () => {
    const out = removeSegments(chain(), new Set(['P2', 'P4']), new Set(['P']));
    expect(out.map((p) => p.segments.map((s) => s.id))).toEqual([['P1'], ['P3']]);
  });

  it('rotates a closed path so one cut leaves a single open chain', () => {
    const loop = polyline('P', [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10), pt(0, 0)], true);
    const out = removeSegments(loop, new Set(['P2']), new Set(['P']));
    expect(out).toHaveLength(1);
    expect(out[0].segments.map((s) => s.id)).toEqual(['P3', 'P4', 'P1']);
    expect(out[0].closed).toBe(false);
  });

  it('returns nothing when the whole path goes', () => {
    expect(removeSegments(polyline('P', [pt(0, 0), pt(10, 0)]), new Set(['P1']), new Set())).toEqual([]);
  });

  it('avoids ids already taken by earlier results', () => {
    const out = removeSegments(chain(), new Set(['P2']), new Set(['P', 'P/1']));
    expect(out.map((p) => p.id)).toEqual(['P', 'P/2']);
  });
});

describe('pruneSelection', () => {
  const paths = [polyline('P', [pt(0, 0), pt(10, 0)])];

  it('drops keys whose segment is gone', () => {
    expect([...pruneSelection(new Set(['P1::p1', 'gone::p1']), paths)]).toEqual(['P1::p1']);
  });

  it('returns the same set when everything is still alive', () => {
    const selection = new Set(['P1::p1']);
    expect(pruneSelection(selection, paths)).toBe(selection);
  });
});

describe('sameKeys', () => {
  it('compares by content', () => {
    expect(sameKeys(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameKeys(new Set(['a']), new Set(['a', 'b']))).toBe(false);
    expect(sameKeys(new Set(['a']), new Set(['b']))).toBe(false);
  });
});
