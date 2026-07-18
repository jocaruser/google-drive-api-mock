/**
 * Minimal Google `fields` mask: `a,b(c,d),e.f`. Parsed into a tree and applied
 * recursively; a mask key whose value is absent on the resource is omitted
 * (Drive omits e.g. `thumbnailLink` for files that have none). Grammar beyond
 * this subset (wildcards, slashes) fails loudly.
 */
export type FieldMask = Map<string, FieldMask | null>;
export declare function parseFieldMask(spec: string): FieldMask;
export declare function applyFieldMask(value: unknown, mask: FieldMask | null): unknown;
