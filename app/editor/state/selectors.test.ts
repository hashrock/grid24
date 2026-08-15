import { describe, expect, it } from 'vitest';
import {
  openEndpoints,
  pathIdOfSegment,
  placedSegments,
  selectedPathIds,
  selectionBounds,
  uniqueSelectedAnchors,
} from './selectors';
import { curve, path, polyline, pt } from './testFixtures';

const document = () => [
  polyline('P', [pt(0, 0), pt(10, 0), pt(20, 0)]),
  polyline('Q', [pt(0, 5), pt(10, 5)]),
];

describe('placedSegments', () => {
  it('flattens segments while keeping their path', () => {
    const placed = placedSegments(document());
    expect(placed.map((i) => [i.path.id, i.segment.id])).toEqual([
      ['P', 'P1'],
      ['P', 'P2'],
      ['Q', 'Q1'],
    ]);
  });
});

describe('selectedPathIds', () => {
  it('reports the paths the selection reaches', () => {
    expect([...selectedPathIds(document(), new Set(['P2::p1']))]).toEqual(['P']);
  });

  it('is empty for an empty selection', () => {
    expect(selectedPathIds(document(), new Set()).size).toBe(0);
  });

  it('ignores keys for segments that are gone', () => {
    expect(selectedPathIds(document(), new Set(['gone::p1'])).size).toBe(0);
  });
});

describe('pathIdOfSegment', () => {
  it('maps a hovered segment back to its path', () => {
    expect(pathIdOfSegment(document(), 'Q1')).toBe('Q');
    expect(pathIdOfSegment(document(), 'nope')).toBeNull();
    expect(pathIdOfSegment(document(), null)).toBeNull();
  });
});

describe('openEndpoints', () => {
  it('reports head and tail of every open path', () => {
    expect(openEndpoints(document())).toEqual([
      { pathId: 'P', end: 'head', point: pt(0, 0) },
      { pathId: 'P', end: 'tail', point: pt(20, 0) },
      { pathId: 'Q', end: 'head', point: pt(0, 5) },
      { pathId: 'Q', end: 'tail', point: pt(10, 5) },
    ]);
  });

  it('skips closed paths — they have no free end', () => {
    const loop = polyline('L', [pt(0, 0), pt(10, 0), pt(0, 0)], true);
    expect(openEndpoints([loop])).toEqual([]);
  });

  it('skips empty paths', () => {
    expect(openEndpoints([path('E', [])])).toEqual([]);
  });
});

describe('selectionBounds', () => {
  it('includes the controls attached to selected anchors', () => {
    const paths = [path('P', [curve('a', pt(0, 0), pt(-2, -3), pt(8, 0), pt(10, 0))])];
    // Selecting p1 pulls c1 in, which reaches further than the anchor itself.
    expect(selectionBounds(paths, new Set(['a::p1']))).toEqual({
      minX: -2,
      maxX: 0,
      minY: -3,
      maxY: 0,
      width: 2,
      height: 3,
    });
  });

  it('is null when nothing is selected', () => {
    expect(selectionBounds(document(), new Set())).toBeNull();
  });

  it('is null when the selection points at nothing that exists', () => {
    expect(selectionBounds(document(), new Set(['gone::p1']))).toBeNull();
  });
});

describe('uniqueSelectedAnchors', () => {
  it('counts coincident anchors of adjacent segments once', () => {
    // P1::p2 and P2::p1 are the same point (10,0).
    expect(uniqueSelectedAnchors(document(), new Set(['P1::p2', 'P2::p1']))).toBe(1);
  });

  it('counts distinct anchors separately', () => {
    expect(uniqueSelectedAnchors(document(), new Set(['P1::p1', 'P2::p2']))).toBe(2);
  });

  it('maps a control point to the anchor it hangs from', () => {
    const paths = [path('P', [curve('a', pt(0, 0), pt(2, 2), pt(8, 0), pt(10, 0))])];
    expect(uniqueSelectedAnchors(paths, new Set(['a::c1', 'a::p1']))).toBe(1);
  });

  it('is zero for an empty selection', () => {
    expect(uniqueSelectedAnchors(document(), new Set())).toBe(0);
  });
});
