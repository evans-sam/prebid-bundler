import { afterEach, describe, expect, test } from "bun:test";
import { _resetLocksForTest, withVersionLock } from "./versionLock";

afterEach(() => {
  _resetLocksForTest();
});

describe("withVersionLock", () => {
  test("serializes concurrent calls for the same version", async () => {
    const events: string[] = [];

    const first = withVersionLock("10.20.0", async () => {
      events.push("first:start");
      await Bun.sleep(50);
      events.push("first:end");
      return "first-result";
    });

    const second = withVersionLock("10.20.0", async () => {
      events.push("second:start");
      await Bun.sleep(10);
      events.push("second:end");
      return "second-result";
    });

    const [r1, r2] = await Promise.all([first, second]);

    expect(r1).toBe("first-result");
    expect(r2).toBe("second-result");
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  test("runs concurrently for different versions", async () => {
    const events: string[] = [];

    const a = withVersionLock("10.20.0", async () => {
      events.push("a:start");
      await Bun.sleep(50);
      events.push("a:end");
    });

    const b = withVersionLock("10.19.0", async () => {
      events.push("b:start");
      await Bun.sleep(50);
      events.push("b:end");
    });

    await Promise.all([a, b]);

    expect(events.indexOf("a:start")).toBeLessThan(events.indexOf("a:end"));
    expect(events.indexOf("b:start")).toBeLessThan(events.indexOf("a:end"));
    expect(events.indexOf("a:start")).toBeLessThan(events.indexOf("b:end"));
  });

  test("releases the lock when fn rejects so next acquirer proceeds", async () => {
    const first = withVersionLock("v1", async () => {
      throw new Error("boom");
    });

    await expect(first).rejects.toThrow("boom");

    const second = withVersionLock("v1", async () => "ok");
    expect(await second).toBe("ok");
  });
});
