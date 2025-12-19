import {coerce, valid} from "semver";

export function parseVersion(version: unknown): string | null {
    if (!version || typeof version !== "string") {
        return null;
    }
    return valid(coerce(version));
}
