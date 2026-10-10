// The mark the band draws while a worker runs: a braille spinner and the
// word, in purple, with a light passing over the word. On the terminal it is
// one Raster that a timer repaints through `$.ui.blit`, so a frame never
// redraws the tree around it; other surfaces draw it still.

export const MARK_KEY = 'mark'
export const FRAME_MS = 100

const SPIN = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏']
const WORD = [...' orchestra']
export const MARK_COLUMNS = 1 + WORD.length
/** The light crosses the word in SWEEP frames, then rests until the cycle ends. */
const SWEEP = 14
const CYCLE = 30
/** How many cells to either side the light reaches. */
const REACH = 2.5
/** The terminal's own background. */
const DEFAULT = 0x01000000

/** The purple and the light that passes over it, raw colors since a Raster takes no theme keys. */
export type Palette = { base: number; light: number }

export const PALETTES = {
  dark: { base: 0xaf87ff, light: 0xf0e8ff },
  light: { base: 0x8250df, light: 0xc4a8ff },
} satisfies Record<string, Palette>

/** The palette for the person's `theme` setting: the light themes by name, every other the dark one. */
export function paletteFor(theme: unknown): Palette {
  return typeof theme === 'string' && theme.startsWith('light') ? PALETTES.light : PALETTES.dark
}

export function frameAt(now: number): number {
  return Math.floor(now / FRAME_MS)
}

/** One frame of the mark, packed as a Raster's `cells` are. */
export function markCells(frame: number, palette: Palette): string {
  const glyphs = [SPIN[frame % SPIN.length]!, ...WORD]
  const step = frame % CYCLE
  // From before the word's first letter to past its last, then out of sight.
  const center = step < SWEEP ? -REACH + (step / (SWEEP - 1)) * (glyphs.length + 2 * REACH - 1) : -100
  const view = new DataView(new ArrayBuffer(glyphs.length * 12))

  glyphs.forEach((glyph, index) => {
    const lit = index === 0 ? 0 : Math.max(0, 1 - Math.abs(index - center) / REACH)
    view.setUint32(index * 12, glyph.codePointAt(0)!, true)
    view.setUint32(index * 12 + 4, mix(palette.base, palette.light, lit), true)
    view.setUint32(index * 12 + 8, DEFAULT, true)
  })

  return btoa(String.fromCharCode(...new Uint8Array(view.buffer)))
}

/** `from` moved toward `to` by `amount`, 0 to 1, channel by channel. */
function mix(from: number, to: number, amount: number): number {
  let color = 0
  for (const shift of [16, 8, 0]) {
    const a = (from >> shift) & 0xff
    const b = (to >> shift) & 0xff
    color |= Math.round(a + (b - a) * amount) << shift
  }

  return color
}
