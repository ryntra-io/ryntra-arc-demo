import { createHash } from "node:crypto";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Locale-independent UTF-16 code-unit order for hashes and lock acquisition. */
export function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite number is not canonical JSON.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareCanonicalStrings(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  throw new TypeError("Value is not canonical JSON.");
}

export function hashCanonical(value: unknown): string {
  return `0x${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}
