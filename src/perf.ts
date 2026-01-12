/**
 * Performance timing utilities using the PerformanceMark API.
 *
 * Provides scoped timing contexts to namespace marks/measures per build or request,
 * with automatic cleanup to prevent memory leaks.
 */

export interface TimingContext {
  prefix: string;
  marks: string[];
}

/**
 * Creates a timing context with a unique prefix for namespacing marks.
 *
 * @param prefix - Unique identifier (e.g., "build:abc12345" or "request:xyz")
 * @returns TimingContext for use with mark/measure/clearTimings
 */
export function createTimingContext(prefix: string): TimingContext {
  return { prefix, marks: [] };
}

/**
 * Creates a performance mark with the context prefix.
 *
 * @param ctx - Timing context from createTimingContext
 * @param name - Mark name (will be prefixed with ctx.prefix)
 * @param detail - Optional metadata to attach to the mark
 * @returns The created PerformanceMark
 */
export function mark(ctx: TimingContext, name: string, detail?: unknown): PerformanceMark {
  const fullName = `${ctx.prefix}:${name}`;
  ctx.marks.push(fullName);
  return performance.mark(fullName, { detail });
}

/**
 * Measures duration between two marks and returns the duration in milliseconds.
 *
 * @param ctx - Timing context from createTimingContext
 * @param name - Measure name (will be prefixed with ctx.prefix)
 * @param startMark - Name of the start mark (without prefix)
 * @param endMark - Name of the end mark (without prefix), defaults to current time if omitted
 * @returns Duration in milliseconds
 */
export function measure(ctx: TimingContext, name: string, startMark: string, endMark?: string): number {
  const fullStart = `${ctx.prefix}:${startMark}`;
  const fullEnd = endMark ? `${ctx.prefix}:${endMark}` : undefined;
  const fullName = `${ctx.prefix}:${name}`;

  const m = fullEnd ? performance.measure(fullName, fullStart, fullEnd) : performance.measure(fullName, fullStart);

  return m.duration;
}

/**
 * Clears all marks and measures associated with this timing context.
 * Should be called when the operation completes to prevent memory leaks.
 *
 * @param ctx - Timing context to clean up
 */
export function clearTimings(ctx: TimingContext): void {
  for (const markName of ctx.marks) {
    performance.clearMarks(markName);
  }

  const measures = performance.getEntriesByType("measure");
  for (const m of measures) {
    if (m.name.startsWith(ctx.prefix)) {
      performance.clearMeasures(m.name);
    }
  }

  ctx.marks = [];
}
