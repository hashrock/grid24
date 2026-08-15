import { describe, expect, it } from 'vitest';
import type { Path, StoredSegment } from '../editor/types';
import { parseContent, pathToD, pathsFromStored, pathsToD, pathsToStored, serializeContent } from './svg';

const pt = (x: number, y: number) => ({ x, y });

const stored = (id: string, pathId: string, from: ReturnType<typeof pt>, to: ReturnType<typeof pt>, isClosed?: boolean): StoredSegment => ({
  id,
  pathId,
  p1: { ...from },
  c1: { ...from },
  c2: { ...to },
  p2: { ...to },
  ...(isClosed === undefined ? {} : { isClosed }),
});

const line = (id: string, from: ReturnType<typeof pt>, to: ReturnType<typeof pt>) => ({
  id,
  p1: { ...from },
  c1: { ...from },
  c2: { ...to },
  p2: { ...to },
});

describe('pathsFromStored', () => {
  it('groups by pathId, preserving first-seen order', () => {
    const paths = pathsFromStored([
      stored('a', 'P', pt(0, 0), pt(10, 0)),
      stored('c', 'Q', pt(0, 5), pt(10, 5)),
      stored('b', 'P', pt(10, 0), pt(20, 0)),
    ]);
    expect(paths.map((p) => p.id)).toEqual(['P', 'Q']);
    expect(paths[0].segments.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('lifts the repeated isClosed flag onto the path', () => {
    const [p] = pathsFromStored([
      stored('a', 'P', pt(0, 0), pt(10, 0), true),
      stored('b', 'P', pt(10, 0), pt(0, 0), true),
    ]);
    expect(p.closed).toBe(true);
  });

  it('closes the path when only one legacy segment carries the flag', () => {
    const [p] = pathsFromStored([
      stored('a', 'P', pt(0, 0), pt(10, 0), false),
      stored('b', 'P', pt(10, 0), pt(0, 0), true),
    ]);
    expect(p.closed).toBe(true);
  });

  it('strips the flat-model fields off the segments', () => {
    const [p] = pathsFromStored([stored('a', 'P', pt(0, 0), pt(10, 0), true)]);
    expect(p.segments[0]).not.toHaveProperty('pathId');
    expect(p.segments[0]).not.toHaveProperty('isClosed');
  });

  it('falls back to the segment id when pathId is missing', () => {
    const orphan = { ...stored('a', 'P', pt(0, 0), pt(10, 0)) } as Partial<StoredSegment>;
    delete orphan.pathId;
    expect(pathsFromStored([orphan as StoredSegment])[0].id).toBe('a');
  });
});

describe('round trip', () => {
  const paths: Path[] = [
    { id: 'P', closed: true, segments: [line('a', pt(0, 0), pt(10, 0)), line('b', pt(10, 0), pt(0, 0))] },
    { id: 'Q', closed: false, segments: [line('c', pt(0, 5), pt(10, 5))] },
  ];

  it('survives paths -> stored -> paths unchanged', () => {
    expect(pathsFromStored(pathsToStored(paths))).toEqual(paths);
  });

  it('survives serialize -> parse unchanged', () => {
    expect(parseContent(serializeContent(paths))).toEqual(paths);
  });

  it('writes the flat format old readers expect', () => {
    const flat = pathsToStored(paths);
    expect(flat.map((s) => s.pathId)).toEqual(['P', 'P', 'Q']);
    expect(flat.map((s) => s.isClosed)).toEqual([true, true, false]);
  });
});

describe('parseContent', () => {
  it('returns nothing for junk', () => {
    expect(parseContent('not json')).toEqual([]);
    expect(parseContent('{"nope":1}')).toEqual([]);
    expect(parseContent('')).toEqual([]);
  });

  it('drops entries that are not segments', () => {
    const content = JSON.stringify([stored('a', 'P', pt(0, 0), pt(10, 0)), { id: 'x' }, null, 7]);
    const paths = parseContent(content);
    expect(paths).toHaveLength(1);
    expect(paths[0].segments.map((s) => s.id)).toEqual(['a']);
  });
});

describe('pathToD', () => {
  it('emits one M and a C per segment', () => {
    const p: Path = { id: 'P', closed: false, segments: [line('a', pt(0, 0), pt(10, 0))] };
    expect(pathToD(p)).toBe('M 0 0 C 0 0, 10 0, 10 0');
  });

  it('appends Z for a closed path', () => {
    const p: Path = { id: 'P', closed: true, segments: [line('a', pt(0, 0), pt(10, 0))] };
    expect(pathToD(p)).toMatch(/ Z$/);
  });

  it('skips empty paths rather than emitting an empty d', () => {
    expect(pathsToD([{ id: 'P', closed: false, segments: [] }])).toEqual([]);
  });
});
