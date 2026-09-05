/**
 * The first `${base}${separator}${n}`, counting from 1, that `taken` does not
 * hold.
 *
 * Deriving the new id from the old one rather than minting a random one keeps
 * renaming deterministic: the same input renames the same way every time, so a
 * document that had an id rewritten can be saved and reloaded without the ids
 * drifting on each pass.
 */
export const freshId = (taken: ReadonlySet<string>, base: string, separator: string): string => {
  let i = 1;
  while (taken.has(`${base}${separator}${i}`)) i++;
  return `${base}${separator}${i}`;
};
