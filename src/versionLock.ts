const tails = new Map<string, Promise<void>>();

export async function withVersionLock<T>(version: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(version) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => {
    release = r;
  });
  const myTail = prev.then(() => mine);
  tails.set(version, myTail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(version) === myTail) {
      tails.delete(version);
    }
  }
}

// Test-only helper. Clears all locks so tests don't leak state between cases.
export function _resetLocksForTest(): void {
  tails.clear();
}
