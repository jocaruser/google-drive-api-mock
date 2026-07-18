import { StoreError } from "./store.js";
export function parseFieldMask(spec) {
    const parser = new MaskParser(spec);
    const mask = parser.parseList();
    if (!parser.done())
        throw new StoreError(400, `Invalid fields mask for the emulator: ${spec}`);
    return mask;
}
class MaskParser {
    index = 0;
    spec;
    constructor(spec) {
        this.spec = spec;
    }
    done() {
        return this.index >= this.spec.length;
    }
    peek() {
        return this.spec[this.index] ?? '';
    }
    parseList() {
        const mask = new Map();
        for (;;) {
            this.parseItem(mask);
            if (this.peek() !== ',')
                return mask;
            this.index += 1;
        }
    }
    parseItem(into) {
        const name = this.parseName();
        if (this.peek() === '.') {
            this.index += 1;
            const child = new Map();
            this.parseItem(child);
            into.set(name, child);
            return;
        }
        if (this.peek() === '(') {
            this.index += 1;
            const child = this.parseList();
            if (this.peek() !== ')')
                throw new StoreError(400, `Unbalanced fields mask: ${this.spec}`);
            this.index += 1;
            into.set(name, child);
            return;
        }
        into.set(name, null);
    }
    parseName() {
        const match = /^[A-Za-z0-9_]+/.exec(this.spec.slice(this.index));
        if (match === null)
            throw new StoreError(400, `Invalid fields mask for the emulator: ${this.spec}`);
        this.index += match[0].length;
        return match[0];
    }
}
export function applyFieldMask(value, mask) {
    if (mask === null)
        return value;
    if (Array.isArray(value)) {
        return value.map((entry) => applyFieldMask(entry, mask));
    }
    if (typeof value !== 'object' || value === null)
        return value;
    const source = value;
    const projected = {};
    for (const [key, child] of mask) {
        if (source[key] === undefined)
            continue;
        projected[key] = applyFieldMask(source[key], child);
    }
    return projected;
}
