import {test, expect, describe} from "bun:test";
import {parseVersion} from "./utils";

describe("parseVersion", () => {
    test("parses valid semver string", () => {
        expect(parseVersion("10.20.0")).toBe("10.20.0");
        expect(parseVersion("1.0.0")).toBe("1.0.0");
        expect(parseVersion("0.0.1")).toBe("0.0.1");
    });

    test("coerces partial versions", () => {
        expect(parseVersion("10.20")).toBe("10.20.0");
        expect(parseVersion("10")).toBe("10.0.0");
    });

    test("handles version with v prefix", () => {
        expect(parseVersion("v10.20.0")).toBe("10.20.0");
    });

    test("returns null for invalid input", () => {
        expect(parseVersion(null)).toBe(null);
        expect(parseVersion(undefined)).toBe(null);
        expect(parseVersion("")).toBe(null);
        expect(parseVersion(123)).toBe(null);
        expect(parseVersion({})).toBe(null);
        expect(parseVersion([])).toBe(null);
    });

    test("returns null for non-version strings", () => {
        expect(parseVersion("not-a-version")).toBe(null);
        expect(parseVersion("abc")).toBe(null);
    });
});
