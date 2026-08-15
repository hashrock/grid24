import { describe, expect, it } from 'vitest';
import { parsePathData, parsePathDataList } from './pathImport';

/** Rounded endpoint chain of a path, for readable assertions. */
const points = (path: { segments: { p1: { x: number; y: number }; p2: { x: number; y: number } }[] }) => {
  const r = (n: number) => Math.round(n * 100) / 100;
  const out = [[r(path.segments[0].p1.x), r(path.segments[0].p1.y)]];
  for (const s of path.segments) out.push([r(s.p2.x), r(s.p2.y)]);
  return out;
};

describe('parsePathData', () => {
  it('turns each M into its own path', () => {
    const paths = parsePathData('M0 0 L10 0 M0 5 L10 5');
    expect(paths).toHaveLength(2);
    expect(points(paths[0])).toEqual([[0, 0], [10, 0]]);
    expect(points(paths[1])).toEqual([[0, 5], [10, 5]]);
    expect(paths.every((p) => !p.closed)).toBe(true);
  });

  it('gives every path and segment a distinct id', () => {
    const paths = parsePathData('M0 0 L10 0 L10 10 M0 5 L10 5');
    const ids = [...paths.map((p) => p.id), ...paths.flatMap((p) => p.segments.map((s) => s.id))];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stores lines as cubics with collapsed controls', () => {
    const [p] = parsePathData('M0 0 L10 0');
    expect(p.segments[0].c1).toEqual({ x: 0, y: 0 });
    expect(p.segments[0].c2).toEqual({ x: 10, y: 0 });
  });

  it('marks Z as closed on the path, not per segment', () => {
    const [p] = parsePathData('M0 0 L10 0 L10 10 Z');
    expect(p.closed).toBe(true);
    expect(p.segments[0]).not.toHaveProperty('isClosed');
  });

  it('adds the closing segment when Z does not land on the start', () => {
    const [p] = parsePathData('M0 0 L10 0 L10 10 Z');
    expect(points(p)).toEqual([[0, 0], [10, 0], [10, 10], [0, 0]]);
  });

  it('does not add a closing segment when the chain already returns', () => {
    const [p] = parsePathData('M0 0 L10 0 L0 0 Z');
    expect(p.segments).toHaveLength(2);
    expect(p.closed).toBe(true);
  });

  it('closes only the subpath the Z belongs to', () => {
    const paths = parsePathData('M0 0 L10 0 Z M0 5 L10 5');
    expect(paths.map((p) => p.closed)).toEqual([true, false]);
  });

  it('handles relative commands', () => {
    const [p] = parsePathData('m1 1 l5 0 l0 5');
    expect(points(p)).toEqual([[1, 1], [6, 1], [6, 6]]);
  });

  it('handles H and V', () => {
    const [p] = parsePathData('M2 2 H8 V9');
    expect(points(p)).toEqual([[2, 2], [8, 2], [8, 9]]);
  });

  it('treats a repeated M coordinate pair as an implicit L', () => {
    const paths = parsePathData('M0 0 5 0 10 0');
    expect(paths).toHaveLength(1);
    expect(points(paths[0])).toEqual([[0, 0], [5, 0], [10, 0]]);
  });

  it('reflects the previous control for S', () => {
    const [p] = parsePathData('M0 0 C2 4, 8 4, 10 0 S18 -4, 20 0');
    expect(p.segments[1].c1).toEqual({ x: 12, y: -4 });
  });

  it('converts Q to a cubic', () => {
    const [p] = parsePathData('M0 0 Q5 6 10 0');
    const [seg] = p.segments;
    // Control points sit two thirds of the way from each end to the Q control.
    expect(seg.c1.x).toBeCloseTo(10 / 3);
    expect(seg.c1.y).toBeCloseTo(4);
    expect(seg.c2.x).toBeCloseTo(20 / 3);
    expect(seg.c2.y).toBeCloseTo(4);
  });

  it('converts an arc into cubic pieces that reach the endpoint', () => {
    const [p] = parsePathData('M0 0 A5 5 0 0 1 10 0');
    expect(p.segments.length).toBeGreaterThan(0);
    const end = p.segments.at(-1)!.p2;
    expect(end.x).toBeCloseTo(10);
    expect(end.y).toBeCloseTo(0);
  });

  it('treats a zero-radius arc as a straight line', () => {
    const [p] = parsePathData('M0 0 A0 0 0 0 1 10 0');
    expect(p.segments).toHaveLength(1);
    expect(points(p)).toEqual([[0, 0], [10, 0]]);
  });

  it('returns nothing for empty or unusable input', () => {
    expect(parsePathData('')).toEqual([]);
    expect(parsePathData('M0 0')).toEqual([]);
  });
});

describe('parsePathDataList', () => {
  it('flattens several d strings into one document', () => {
    const paths = parsePathDataList(['M0 0 L10 0', 'M0 5 L10 5 M0 9 L10 9']);
    expect(paths).toHaveLength(3);
    expect(new Set(paths.map((p) => p.id)).size).toBe(3);
  });
});
