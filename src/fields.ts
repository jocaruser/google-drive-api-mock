import { StoreError } from './store.ts'

/**
 * Minimal Google `fields` mask: `a,b(c,d),e.f`. Parsed into a tree and applied
 * recursively; a mask key whose value is absent on the resource is omitted
 * (Drive omits e.g. `thumbnailLink` for files that have none). Grammar beyond
 * this subset (wildcards, slashes) fails loudly.
 */
export type FieldMask = Map<string, FieldMask | null>

export function parseFieldMask(spec: string): FieldMask {
  const parser = new MaskParser(spec)
  const mask = parser.parseList()
  if (!parser.done())
    throw new StoreError(400, `Invalid fields mask for the emulator: ${spec}`)
  return mask
}

class MaskParser {
  private index = 0
  private readonly spec: string

  constructor(spec: string) {
    this.spec = spec
  }

  done(): boolean {
    return this.index >= this.spec.length
  }

  private peek(): string {
    return this.spec[this.index] ?? ''
  }

  parseList(): FieldMask {
    const mask: FieldMask = new Map()
    for (;;) {
      this.parseItem(mask)
      if (this.peek() !== ',') return mask
      this.index += 1
    }
  }

  private parseItem(into: FieldMask): void {
    const name = this.parseName()
    if (this.peek() === '.') {
      this.index += 1
      const child: FieldMask = new Map()
      this.parseItem(child)
      into.set(name, child)
      return
    }
    if (this.peek() === '(') {
      this.index += 1
      const child = this.parseList()
      if (this.peek() !== ')')
        throw new StoreError(400, `Unbalanced fields mask: ${this.spec}`)
      this.index += 1
      into.set(name, child)
      return
    }
    into.set(name, null)
  }

  private parseName(): string {
    const match = /^[A-Za-z0-9_]+/.exec(this.spec.slice(this.index))
    if (match === null)
      throw new StoreError(400, `Invalid fields mask for the emulator: ${this.spec}`)
    this.index += match[0].length
    return match[0]
  }
}

export function applyFieldMask(value: unknown, mask: FieldMask | null): unknown {
  if (mask === null) return value
  if (Array.isArray(value)) {
    return value.map((entry) => applyFieldMask(entry, mask))
  }
  if (typeof value !== 'object' || value === null) return value
  const source = value as Record<string, unknown>
  const projected: Record<string, unknown> = {}
  for (const [key, child] of mask) {
    if (source[key] === undefined) continue
    projected[key] = applyFieldMask(source[key], child)
  }
  return projected
}
