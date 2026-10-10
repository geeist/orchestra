import { describe, expect, test } from 'claude-code/testing'

import { MARK_COLUMNS, markCells, PALETTES, paletteFor } from './mark'

/** The cells back as `[glyph, foreground]` pairs. */
function decode(cells: string): [string, number][] {
  const bytes = Uint8Array.from(atob(cells), char => char.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  const out: [string, number][] = []
  for (let at = 0; at < bytes.length; at += 12) {
    out.push([String.fromCodePoint(view.getUint32(at, true)), view.getUint32(at + 4, true)])
  }

  return out
}

describe('mark', () => {
  test('a spinner and the word, one cell each', () => {
    const cells = decode(markCells(0, PALETTES.dark))

    expect(cells).toHaveLength(MARK_COLUMNS)
    expect(cells.map(([glyph]) => glyph).join('')).toBe('⠋ orchestra')
    expect(decode(markCells(1, PALETTES.dark))[0]![0]).toBe('⠙')
  })

  test('the light passes over the word, then rests', () => {
    const { base } = PALETTES.dark
    const lit = (frame: number) => decode(markCells(frame, PALETTES.dark)).map(([, color]) => color)

    expect(lit(7)[0]).toBe(base)
    expect(lit(7).some(color => color > base)).toBe(true)
    expect(lit(20).every(color => color === base)).toBe(true)
  })

  test('light themes get the darker purple', () => {
    expect(paletteFor('light-daltonized')).toBe(PALETTES.light)
    expect(paletteFor('dark')).toBe(PALETTES.dark)
    expect(paletteFor(undefined)).toBe(PALETTES.dark)
  })
})
