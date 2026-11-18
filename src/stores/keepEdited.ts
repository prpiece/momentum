/**
 * Runs calls of `fn` one after another. Overlapping hydrates would otherwise see each other's `set` as an edit made during
 * their read and keep the older values; a queued one starts (and takes its "then" snapshot) only after the previous has set.
 */
export function serially<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  const call = (...args: A): Promise<void> => {
    const run = tail.then(async () => {
      const before = kept;
      await fn(...args);
      // Kept rows may now differ from SQLite's merged row (a pull's per-field merge): re-read once, behind the pending writes (R2).
      if (kept !== before) void call(...args).catch(() => undefined);
    });
    tail = run.catch(() => undefined); // a failed hydrate rejects to its own caller only
    return run;
  };
  return call;
}

let kept = 0; // bumped whenever a hydrate keeps a store version over the loaded one

/**
 * A hydrate's read can't have seen edits made while it was in flight (SYNC-14). Entries whose store value changed since
 * `then` (edited, added, or deleted) keep the store's version over the loaded one.
 */
export function keepEdited<T>(loaded: Record<string, T>, then: Record<string, T>, now: Record<string, T>): Record<string, T> {
  for (const id of new Set([...Object.keys(then), ...Object.keys(now)])) {
    if (now[id] === then[id]) continue;
    kept++;
    if (id in now) loaded[id] = now[id];
    else delete loaded[id];
  }
  return loaded;
}
