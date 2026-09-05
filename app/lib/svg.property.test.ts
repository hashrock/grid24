import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Path, Point, Segment } from '../editor/types';
import { parseContent, pathsFromStored, pathsToStored, serializeContent } from './svg';

/**
 * Property-based cover for the persistence boundary.
 *
 * The example specs in `svg.test.ts` pin the shapes we care about by hand.
 * These check the two things that have to hold for *every* document: a save
 * followed by a load gives the document back, and a load never throws or
 * invents a malformed one — the D1 column is old enough to hold rows written
 * by editor versions that no longer exist.
 */

// Coordinates stay finite: JSON carries no NaN or Infinity, so a document
// holding one was already unrepresentable before it reached this module.
const arbCoord = fc
  .double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true })
  // `JSON.stringify(-0)` is "0", and the two are the same coordinate — the
  // round trip is not expected to carry the sign of a zero through storage.
  .map((v) => (Object.is(v, -0) ? 0 : v));

const arbPoint: fc.Arbitrary<Point> = fc.record({ x: arbCoord, y: arbCoord });

const arbId = fc.string({ minLength: 1, maxLength: 8 });

/** A segment without its id — the document arbitrary mints those. */
const arbSegmentBody = fc.record({
  p1: arbPoint,
  c1: arbPoint,
  c2: arbPoint,
  p2: arbPoint,
  // The flag is genuinely optional in the model, and unset is not false: the
  // round trip has to carry a `true` and a `false` through storage alike.
  isSmoothP2: fc.option(fc.boolean(), { nil: undefined }),
});

/**
 * A document the editor could actually hold:
 *  - ids are unique (`freshPathId` and `crypto.randomUUID` see to that), so the
 *    index prefix keeps the generated ones distinct while still letting the
 *    arbitrary explore awkward id text;
 *  - no path is empty, because a path with no segments has no `d` and is
 *    dropped by every renderer.
 */
const arbPaths: fc.Arbitrary<Path[]> = fc
  .array(
    fc.record({
      id: arbId,
      closed: fc.boolean(),
      bodies: fc.array(arbSegmentBody, { minLength: 1, maxLength: 4 }),
    }),
    { maxLength: 4 }
  )
  .map((raw) =>
    raw.map(({ id, closed, bodies }, i) => ({
      id: `${i}/${id}`,
      closed,
      segments: bodies.map((body, j) => ({ id: `${i}/${id}#${j}`, ...body }) as Segment),
    }))
  );

describe('paths <-> stored round trip', () => {
  it('survives flattening and regrouping', () => {
    fc.assert(
      fc.property(arbPaths, (paths) => {
        expect(pathsFromStored(pathsToStored(paths))).toEqual(paths);
      })
    );
  });

  it('survives a save and load through JSON', () => {
    fc.assert(
      fc.property(arbPaths, (paths) => {
        expect(parseContent(serializeContent(paths))).toEqual(paths);
      })
    );
  });

  it('writes the grouping onto every stored segment', () => {
    fc.assert(
      fc.property(arbPaths, (paths) => {
        const stored = pathsToStored(paths);
        expect(stored).toHaveLength(paths.reduce((n, p) => n + p.segments.length, 0));
        for (const s of stored) {
          expect(typeof s.pathId).toBe('string');
          expect(typeof s.isClosed).toBe('boolean');
        }
      })
    );
  });
});

// --- Loading data we did not write ----------------------------------------

const arbStoredRow = fc.record({
  id: arbId,
  pathId: fc.option(arbId, { nil: undefined }),
  isClosed: fc.option(fc.boolean(), { nil: undefined }),
  p1: arbPoint,
  c1: arbPoint,
  c2: arbPoint,
  p2: arbPoint,
});

/**
 * Rows as they might actually come back from storage: well-formed ones, ones
 * with a single field of the wrong type or missing entirely (`JSON.stringify`
 * drops an `undefined` member, so that is what a missing column looks like),
 * and outright junk.
 */
const arbCorruptRow = fc.oneof(
  arbStoredRow,
  fc
    .tuple(
      arbStoredRow,
      fc.constantFrom('id', 'pathId', 'isClosed', 'p1', 'c1', 'c2', 'p2'),
      fc.oneof(fc.constant(undefined), fc.integer(), fc.string(), fc.jsonValue())
    )
    .map(([row, key, junk]) => ({ ...row, [key]: junk })),
  fc.jsonValue()
);

/** Everything a caller is allowed to assume about a freshly parsed document. */
const expectWellFormed = (paths: Path[]) => {
  expect(Array.isArray(paths)).toBe(true);
  for (const path of paths) {
    expect(typeof path.id).toBe('string');
    expect(typeof path.closed).toBe('boolean');
    expect(path.segments.length).toBeGreaterThan(0);
    for (const seg of path.segments) {
      expect(typeof seg.id).toBe('string');
      for (const key of ['p1', 'c1', 'c2', 'p2'] as const) {
        expect(Number.isFinite(seg[key].x)).toBe(true);
        expect(Number.isFinite(seg[key].y)).toBe(true);
      }
    }
  }
  // Grouping is by id, so a path id can never repeat. (Segment ids can still
  // collide if the stored data repeats one — re-minting ids for corrupt rows
  // would silently change segment identity, so parsing leaves that alone.)
  const ids = paths.map((p) => p.id);
  expect(new Set(ids).size).toBe(ids.length);
};

describe('parseContent tolerates anything', () => {
  it('never throws on arbitrary text', () => {
    fc.assert(
      fc.property(fc.string(), (content) => {
        expectWellFormed(parseContent(content));
      })
    );
  });

  it('never throws on arbitrary JSON', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expectWellFormed(parseContent(JSON.stringify(value)));
      })
    );
  });

  it('yields a well-formed document from damaged rows', () => {
    fc.assert(
      fc.property(fc.array(arbCorruptRow, { maxLength: 6 }), (rows) => {
        expectWellFormed(parseContent(JSON.stringify(rows)));
      })
    );
  });

  it('yields a document that can be saved and loaded again unchanged', () => {
    fc.assert(
      fc.property(fc.array(arbCorruptRow, { maxLength: 6 }), (rows) => {
        const once = parseContent(JSON.stringify(rows));
        expect(parseContent(serializeContent(once))).toEqual(once);
      })
    );
  });
});
