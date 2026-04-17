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
});
