import { afterEach, describe, expect, test } from "bun:test";
import { clearTimings, createTimingContext, mark, measure } from "./perf";

describe("perf utilities", () => {
  afterEach(() => {
    // Clean up any leftover marks/measures
    performance.clearMarks();
    performance.clearMeasures();
  });

  describe("createTimingContext", () => {
    test("creates context with prefix and empty marks array", () => {
      const ctx = createTimingContext("test:123");
      expect(ctx.prefix).toBe("test:123");
      expect(ctx.marks).toEqual([]);
    });
  });

  describe("mark", () => {
    test("creates mark with prefixed name", () => {
      const ctx = createTimingContext("build:abc");
      mark(ctx, "start");

      const marks = performance.getEntriesByName("build:abc:start");
      expect(marks.length).toBe(1);
      expect(marks[0].entryType).toBe("mark");
    });

    test("tracks mark name in context", () => {
      const ctx = createTimingContext("build:abc");
      mark(ctx, "start");
      mark(ctx, "end");

      expect(ctx.marks).toEqual(["build:abc:start", "build:abc:end"]);
    });

    test("attaches detail metadata", () => {
      const ctx = createTimingContext("build:abc");
      const detail = { version: "1.0.0", modules: 5 };
      const m = mark(ctx, "start", detail);

      expect(m.detail).toEqual(detail);
    });

    test("returns PerformanceMark object", () => {
      const ctx = createTimingContext("build:abc");
      const m = mark(ctx, "start");

      expect(m.name).toBe("build:abc:start");
      expect(m.entryType).toBe("mark");
      expect(typeof m.startTime).toBe("number");
    });
  });

  describe("measure", () => {
    test("measures duration between two marks", async () => {
      const ctx = createTimingContext("test");
      mark(ctx, "start");
      await Bun.sleep(15);
      mark(ctx, "end");

      const duration = measure(ctx, "elapsed", "start", "end");
      expect(duration).toBeGreaterThanOrEqual(10);
    });

    test("creates measure with prefixed name", () => {
      const ctx = createTimingContext("build:xyz");
      mark(ctx, "start");
      mark(ctx, "end");
      measure(ctx, "total", "start", "end");

      const measures = performance.getEntriesByName("build:xyz:total");
      expect(measures.length).toBe(1);
      expect(measures[0].entryType).toBe("measure");
    });

    test("measures from mark to current time when endMark omitted", async () => {
      const ctx = createTimingContext("test");
      mark(ctx, "start");
      await Bun.sleep(15);

      const duration = measure(ctx, "elapsed", "start");
      expect(duration).toBeGreaterThanOrEqual(10);
    });

    test("returns duration as number", () => {
      const ctx = createTimingContext("test");
      mark(ctx, "start");
      mark(ctx, "end");

      const duration = measure(ctx, "elapsed", "start", "end");
      expect(typeof duration).toBe("number");
      expect(duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("clearTimings", () => {
    test("clears all marks in context", () => {
      const ctx = createTimingContext("build:123");
      mark(ctx, "start");
      mark(ctx, "middle");
      mark(ctx, "end");

      expect(performance.getEntriesByName("build:123:start").length).toBe(1);
      expect(performance.getEntriesByName("build:123:middle").length).toBe(1);
      expect(performance.getEntriesByName("build:123:end").length).toBe(1);

      clearTimings(ctx);

      expect(performance.getEntriesByName("build:123:start").length).toBe(0);
      expect(performance.getEntriesByName("build:123:middle").length).toBe(0);
      expect(performance.getEntriesByName("build:123:end").length).toBe(0);
    });

    test("clears all measures with context prefix", () => {
      const ctx = createTimingContext("build:456");
      mark(ctx, "start");
      mark(ctx, "end");
      measure(ctx, "phase1", "start", "end");
      measure(ctx, "total", "start", "end");

      expect(performance.getEntriesByName("build:456:phase1").length).toBe(1);
      expect(performance.getEntriesByName("build:456:total").length).toBe(1);

      clearTimings(ctx);

      expect(performance.getEntriesByName("build:456:phase1").length).toBe(0);
      expect(performance.getEntriesByName("build:456:total").length).toBe(0);
    });

    test("resets marks array in context", () => {
      const ctx = createTimingContext("test");
      mark(ctx, "start");
      mark(ctx, "end");
      expect(ctx.marks.length).toBe(2);

      clearTimings(ctx);
      expect(ctx.marks).toEqual([]);
    });

    test("does not affect other contexts", () => {
      const ctx1 = createTimingContext("build:aaa");
      const ctx2 = createTimingContext("build:bbb");

      mark(ctx1, "start");
      mark(ctx2, "start");

      clearTimings(ctx1);

      expect(performance.getEntriesByName("build:aaa:start").length).toBe(0);
      expect(performance.getEntriesByName("build:bbb:start").length).toBe(1);

      clearTimings(ctx2);
    });
  });

  describe("integration", () => {
    test("full workflow: mark phases, measure, cleanup", async () => {
      const ctx = createTimingContext("build:integration");

      mark(ctx, "start", { buildId: "test-123" });

      mark(ctx, "validation:start");
      await Bun.sleep(5);
      mark(ctx, "validation:end");

      mark(ctx, "processing:start");
      await Bun.sleep(10);
      mark(ctx, "processing:end");

      mark(ctx, "end");

      const validationTime = measure(ctx, "validation", "validation:start", "validation:end");
      const processingTime = measure(ctx, "processing", "processing:start", "processing:end");
      const totalTime = measure(ctx, "total", "start", "end");

      expect(validationTime).toBeGreaterThanOrEqual(0);
      expect(processingTime).toBeGreaterThanOrEqual(5);
      expect(totalTime).toBeGreaterThanOrEqual(validationTime + processingTime);

      // Verify marks exist before cleanup (start, validation:start/end, processing:start/end, end = 6)
      expect(performance.getEntriesByType("mark").filter((m) => m.name.startsWith("build:integration")).length).toBe(6);

      clearTimings(ctx);

      // Verify all cleaned up
      expect(performance.getEntriesByType("mark").filter((m) => m.name.startsWith("build:integration")).length).toBe(0);
      expect(performance.getEntriesByType("measure").filter((m) => m.name.startsWith("build:integration")).length).toBe(0);
    });
  });
});
