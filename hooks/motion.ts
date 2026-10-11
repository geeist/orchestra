// What moves on the board: Clawd, the crab who keeps it, each lane's track,
// and the icons of the running and the next issue. Each is a sprite, plain
// data a Raster's cells are drawn from at any moment, so the timer repaints
// it through `$.ui.blit` and never redraws the tree around it. Only the
// terminal draws a Raster; the other surfaces draw the still versions,
// which this module spells too. Pure, so the tests cover it whole.

import type { OrchestraBoard, OrchestraTone } from '../types'
import { frameAt, MARK_COLUMNS, markCells, paletteFor } from './mark'
import type { Palette } from './mark'

/** How Clawd feels about the board. */
export type Mood = 'ready' | 'working' | 'stuck' | 'asleep' | 'party'

/** One issue on a lane's track. `doneAt` is when this session saw it turn done. */
export type Stop = { tone: OrchestraTone; isNext: boolean; doneAt?: number }

/** What a Raster draws. `loop` replays what happened at the times it names, for the preview. */
export type Sprite =
  | { kind: 'mark' }
  | { kind: 'clawd'; mood: Mood; cheerAt?: number; loop?: number }
  | { kind: 'track'; stops: Stop[]; gap: number; loop?: number }
  | { kind: 'icon'; stop: Stop; loop?: number }

/** Raw colors, since a Raster takes no theme keys. */
export type Colors = {
  mark: Palette
  claude: number
  tones: Record<OrchestraTone, number>
  /** The dotted line ahead of the work done. */
  rail: number
  /** What a light passing over a color moves it toward. */
  light: number
  sparkles: readonly number[]
}

const COLORS = {
  dark: {
    claude: 0xd77757,
    tones: { done: 0x4eba65, running: 0xaf87ff, ready: 0xb1b9f9, held: 0xffc107, waiting: 0x8a8a8a },
    rail: 0x4e4e4e,
    light: 0xf0e8ff,
    sparkles: [0xffd75f, 0xff87d7, 0x87d7ff, 0xafff87, 0xaf87ff],
  },
  light: {
    claude: 0xd77757,
    tones: { done: 0x2c7a39, running: 0x8250df, ready: 0x5769f7, held: 0x966c1e, waiting: 0x8a8a8a },
    rail: 0xbcbcbc,
    light: 0xc4a8ff,
    sparkles: [0xd7a700, 0xd7008f, 0x0087d7, 0x5f8700, 0x8250df],
  },
}

/** The colors for the person's `theme` setting: the light themes by name, every other the dark one. */
export function colorsFor(theme: unknown): Colors {
  const isLight = typeof theme === 'string' && theme.startsWith('light')

  return { mark: paletteFor(theme), ...(isLight ? COLORS.light : COLORS.dark) }
}

// ── Timing ──────────────────────────────────────────────────────────────

/** A finished issue's line fills up to its stop, ... */
const FILL_MS = 600
/** ... a sparkle pops on the stop, ... */
const SPARK_MS = 900
/** ... and once it was the lane's last, confetti crosses the track. */
const CONFETTI_MS = 1600
/** How long Clawd cheers an issue done. */
const CHEER_MS = 3000
/** How long the preview waits before it plays a scenario's finish again. */
export const REPLAY_MS = 6000

/** Milliseconds since `at`, wrapped into `loop` when one is given. */
function since(at: number, now: number, loop: number | undefined): number {
  const elapsed = now - at

  return loop === undefined ? elapsed : ((elapsed % loop) + loop) % loop
}

// ── Cells ───────────────────────────────────────────────────────────────

type Cell = { glyph: string; color: number }

/** The terminal's own color. */
const DEFAULT = 0x01000000
const BLANK: Cell = { glyph: ' ', color: DEFAULT }

const SPIN = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏']
const SPARKLE = ['✦', '✧', '✦']
const CONFETTI = ['✦', '⋆', '✧', '·', '✦', '⋆']

/** The glyph of each tone, as the rows draw it too. */
export const GLYPHS: Record<OrchestraTone, string> = { done: '✓', running: '◐', ready: '○', held: '⏸', waiting: '·' }

/** The size a sprite's Raster takes. */
export function sizeOf(sprite: Sprite): { columns: number; rows: number } {
  switch (sprite.kind) {
    case 'mark':
      return { columns: MARK_COLUMNS, rows: 1 }
    case 'clawd':
      return { columns: CLAWD_COLUMNS, rows: CLAWD_ROWS }
    case 'track':
      return { columns: Math.min(512, trackColumns(sprite.stops.length, sprite.gap)), rows: 1 }
    case 'icon':
      return { columns: 1, rows: 1 }
  }
}

/** The sprite's cells at `now`, packed as a Raster's `cells` are. */
export function cellsOf(sprite: Sprite, now: number, colors: Colors): string {
  switch (sprite.kind) {
    case 'mark':
      return markCells(frameAt(now), colors.mark)
    case 'clawd':
      return pack(clawdCells(sprite, now, colors))
    case 'track':
      return pack(trackCells(sprite, now, colors).slice(0, sizeOf(sprite).columns))
    case 'icon':
      return pack([stopCell(sprite.stop, now, colors, sprite.loop)])
  }
}

function pack(cells: readonly Cell[]): string {
  const view = new DataView(new ArrayBuffer(cells.length * 12))
  cells.forEach((cell, index) => {
    view.setUint32(index * 12, cell.glyph.codePointAt(0)!, true)
    view.setUint32(index * 12 + 4, cell.color, true)
    view.setUint32(index * 12 + 8, DEFAULT, true)
  })

  return btoa(String.fromCharCode(...new Uint8Array(view.buffer)))
}

// ── Clawd ───────────────────────────────────────────────────────────────

export const CLAWD_COLUMNS = 15
export const CLAWD_ROWS = 3

/** Clawd standing still, as the surfaces without a Raster draw him. */
export const CLAWD = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ']
const BODY = 9

/** How Clawd stands in one frame: where, eyes, claws and legs. */
type Pose = { x: number; isBlinking: boolean; claws: 'down' | 'up' | 'wave'; step: 0 | 1 }

/** The mood the board puts Clawd in. */
export function moodOf(board: OrchestraBoard | null): Mood {
  if (board === null) return 'ready'
  if (board.problem !== undefined) return 'stuck'
  if (board.issues.length === 0) return 'asleep'
  if (board.running !== undefined) return 'working'
  if (board.issues.every(one => one.tone === 'done')) return 'party'
  if (board.next !== undefined) return 'ready'
  if (board.issues.some(one => one.tone === 'held')) return 'stuck'

  return 'asleep'
}

/** When the board last saw an issue turn done, which Clawd cheers. */
export function cheerOf(board: OrchestraBoard | null): number | undefined {
  const times = (board?.issues ?? []).flatMap(one => (one.doneAt === undefined ? [] : [one.doneAt]))

  return times.length === 0 ? undefined : Math.max(...times)
}

function clawdCells(sprite: Extract<Sprite, { kind: 'clawd' }>, now: number, colors: Colors): Cell[] {
  const frame = frameAt(now)
  const isCheering = sprite.cheerAt !== undefined && since(sprite.cheerAt, now, sprite.loop) < CHEER_MS
  const mood = isCheering ? 'cheer' : sprite.mood
  const pose = poseOf(mood, frame)
  const grid: Cell[][] = Array.from({ length: CLAWD_ROWS }, () => Array.from({ length: CLAWD_COLUMNS }, () => BLANK))
  const put = (row: number, column: number, glyph: string, color: number) => {
    if (row >= 0 && row < CLAWD_ROWS && column >= 0 && column < CLAWD_COLUMNS) grid[row]![column] = { glyph, color }
  }

  bodyOf(pose).forEach((line, row) =>
    [...line].forEach((glyph, column) => {
      if (glyph !== ' ') put(row, pose.x + column, glyph, colors.claude)
    }),
  )

  switch (mood) {
    case 'stuck':
      if (Math.floor(frame / 5) % 2 === 0) put(0, pose.x + BODY + 1, '?', colors.tones.held)
      break
    case 'asleep':
      for (const lag of [0, 15]) {
        const rise = Math.floor(((frame + lag) % 30) / 10)
        put(2 - rise, pose.x + BODY + rise, rise === 2 ? 'Z' : 'z', colors.tones.waiting)
      }
      break
    case 'party':
    case 'cheer': {
      const count = mood === 'cheer' ? 4 : 2
      const beat = Math.floor(frame / (mood === 'cheer' ? 2 : 4))
      for (let index = 0; index < count; index += 1) {
        const roll = hash(beat * 31 + index)
        const isLeft = index % 2 === 0
        const column = isLeft ? roll % pose.x : pose.x + BODY + (roll % (CLAWD_COLUMNS - pose.x - BODY))
        put(roll % CLAWD_ROWS, column, SPARKLE[(roll >>> 4) % SPARKLE.length]!, colors.sparkles[(roll >>> 8) % colors.sparkles.length]!)
      }
      break
    }
  }

  return grid.flat()
}

/** Each mood's way of standing, frame by frame (100ms each). */
function poseOf(mood: Mood | 'cheer', frame: number): Pose {
  const still: Pose = { x: 3, isBlinking: frame % 45 < 2, claws: 'down', step: 0 }
  switch (mood) {
    case 'ready':
      // A step to the side and back every eight seconds: a crab walks sideways.
      return { ...still, x: frame % 160 < 80 ? 3 : 4, step: frame % 80 < 2 ? 1 : 0 }
    case 'working': {
      // Scuttles from side to side, a column every other frame.
      const at = Math.floor(frame / 2) % 12
      return { ...still, x: at <= 6 ? at : 12 - at, step: at % 2 === 0 ? 0 : 1 }
    }
    case 'stuck':
      return { ...still, claws: Math.floor(frame / 4) % 2 === 0 ? 'wave' : 'down' }
    case 'asleep':
      return { ...still, isBlinking: true }
    case 'party':
      return { ...still, claws: Math.floor(frame / 5) % 2 === 0 ? 'up' : 'down', step: Math.floor(frame / 5) % 2 === 0 ? 1 : 0 }
    case 'cheer':
      return { ...still, isBlinking: false, claws: Math.floor(frame / 2) % 2 === 0 ? 'up' : 'down', step: Math.floor(frame / 2) % 2 === 0 ? 1 : 0 }
  }
}

function bodyOf(pose: Pose): string[] {
  const [head, middle, legs] = CLAWD as [string, string, string]
  const eyes = pose.isBlinking ? head.replace('▛', '█').replace('▜', '█') : head
  const left = pose.claws === 'up'
  const right = pose.claws !== 'down'

  return [
    `${left ? '▗' : ' '}${eyes.slice(1, -1)}${right ? '▖' : ' '}`,
    `${left ? ' ' : '▝'}${middle.slice(1, -1)}${right ? ' ' : '▘'}`,
    pose.step === 0 ? legs : '  ▝▝ ▘▘  ',
  ]
}

/** A number from `n` that looks random, the same each time. */
function hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0

  return (x ^ (x >>> 16)) >>> 0
}

// ── Tracks and icons ────────────────────────────────────────────────────

/** How many columns a track of `count` stops takes, `gap` of line between each two. */
export function trackColumns(count: number, gap: number): number {
  return Math.max(1, count + Math.max(0, count - 1) * gap)
}

/** The line between two stops that fits `count` stops in `columns`: one to four cells. */
export function gapFor(count: number, columns: number): number {
  if (count <= 1) return 0

  return Math.max(1, Math.min(4, Math.floor((columns - count) / (count - 1))))
}

/** A track's glyphs and tones, as a still drawing spells it: the line into a stop done or running is solid. */
export function trackGlyphs(stops: readonly Stop[], gap: number): { glyph: string; tone: OrchestraTone | 'rail' }[] {
  return stops.flatMap((stop, index) => {
    const isReached = stop.tone === 'done' || stop.tone === 'running'
    const line = Array.from({ length: index === 0 ? 0 : gap }, () =>
      isReached ? { glyph: '━', tone: stop.tone } : { glyph: '┄', tone: 'rail' as const },
    )

    return [...line, { glyph: GLYPHS[stop.tone], tone: stop.tone }]
  })
}

function trackCells(sprite: Extract<Sprite, { kind: 'track' }>, now: number, colors: Colors): Cell[] {
  const { stops, gap, loop } = sprite
  const frame = frameAt(now)
  const cells: Cell[] = []

  stops.forEach((stop, index) => {
    if (index > 0) cells.push(...lineInto(stop, gap, now, frame, colors, loop))
    cells.push(stopCell(stop, now, colors, loop))
  })

  // The lane's last issue done: confetti crosses the track once its sparkle is over.
  const times = stops.flatMap(stop => (stop.doneAt === undefined ? [] : [stop.doneAt]))
  if (stops.length > 0 && stops.every(stop => stop.tone === 'done') && times.length > 0) {
    const elapsed = since(Math.max(...times), now, loop) - FILL_MS - SPARK_MS
    if (elapsed >= 0 && elapsed < CONFETTI_MS) {
      const head = Math.round((elapsed / CONFETTI_MS) * (cells.length + CONFETTI.length)) - 1
      CONFETTI.forEach((glyph, behind) => {
        const at = head - behind
        if (at >= 0 && at < cells.length) {
          cells[at] = { glyph, color: colors.sparkles[(behind + frame) % colors.sparkles.length]! }
        }
      })
    }
  }

  return cells
}

/** The line leading into `stop`: filling as it turns done, a light running along it into a running stop. */
function lineInto(stop: Stop, gap: number, now: number, frame: number, colors: Colors, loop: number | undefined): Cell[] {
  const rail: Cell = { glyph: '┄', color: colors.rail }
  if (stop.tone === 'running') {
    const step = frame % 16
    const center = step < 10 ? -1.5 + (step / 9) * (gap + 2) : -100
    return Array.from({ length: gap }, (_, at) => ({
      glyph: '━',
      color: mix(colors.tones.running, colors.light, Math.max(0, 1 - Math.abs(at - center) / 1.5)),
    }))
  }
  if (stop.tone !== 'done') return Array.from({ length: gap }, () => rail)

  const elapsed = stop.doneAt === undefined ? Infinity : since(stop.doneAt, now, loop)
  const filled = elapsed >= FILL_MS ? gap : Math.floor((elapsed / FILL_MS) * (gap + 1))

  return Array.from({ length: gap }, (_, at) => (at < filled ? { glyph: '━', color: colors.tones.done } : rail))
}

/** A stop, or a row's icon: the running one spins, the next one breathes, one just done sparkles. */
export function stopCell(stop: Stop, now: number, colors: Colors, loop?: number): Cell {
  const color = colors.tones[stop.tone]
  switch (stop.tone) {
    case 'running':
      return { glyph: SPIN[frameAt(now) % SPIN.length]!, color }
    case 'ready': {
      if (!stop.isNext) return { glyph: GLYPHS.ready, color }
      const breath = (1 - Math.cos((2 * Math.PI * (now % 2400)) / 2400)) / 2
      return { glyph: GLYPHS.ready, color: mix(color, colors.light, breath * 0.8) }
    }
    case 'done': {
      const elapsed = stop.doneAt === undefined ? Infinity : since(stop.doneAt, now, loop)
      if (elapsed < FILL_MS) return { glyph: GLYPHS.ready, color: colors.rail }
      if (elapsed < FILL_MS + SPARK_MS) {
        const at = Math.floor(((elapsed - FILL_MS) / SPARK_MS) * SPARKLE.length)
        return { glyph: SPARKLE[at]!, color: at % 2 === 0 ? colors.sparkles[0]! : colors.light }
      }
      return { glyph: GLYPHS.done, color }
    }
    default:
      return { glyph: GLYPHS[stop.tone], color }
  }
}

/** Whether a stop moves: it runs, is next, or turned done in this session. */
export function isMoving(stop: Stop): boolean {
  return stop.tone === 'running' || stop.isNext || stop.doneAt !== undefined
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
