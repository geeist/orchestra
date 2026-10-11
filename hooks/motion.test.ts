import { describe, expect, test } from 'claude-code/testing'

import type { OrchestraBoard, OrchestraIssue } from '../types'
import { cellsOf, CLAWD_COLUMNS, colorsFor, gapFor, isMoving, moodOf, sizeOf, trackGlyphs } from './motion'
import type { Sprite, Stop } from './motion'

const COLORS = colorsFor('dark')

/** A sprite's glyphs at `now`, a string per row. */
function glyphs(sprite: Sprite, now: number): string[] {
  const bytes = Uint8Array.from(atob(cellsOf(sprite, now, COLORS)), char => char.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  const { columns, rows } = sizeOf(sprite)
  const text = Array.from({ length: columns * rows }, (_, at) => String.fromCodePoint(words[at * 3]!))

  return Array.from({ length: rows }, (_, row) => text.slice(row * columns, (row + 1) * columns).join(''))
}

const issue = (tone: OrchestraIssue['tone'], extra: Partial<OrchestraIssue> = {}): OrchestraIssue => ({
  path: `p-${Math.random()}`,
  feature: 'f',
  slug: 's',
  title: 't',
  tone,
  reason: '',
  ...extra,
})

const boardOf = (issues: OrchestraIssue[], extra: Partial<OrchestraBoard> = {}): OrchestraBoard => ({ issues, recent: [], ...extra })

describe('moodOf', () => {
  test('works while a worker runs, dances once all is done, waits with a next issue', () => {
    const running = { id: 'j', issue: 'p', slug: 's', title: 't', tab: '', minutes: 1, phase: 'running', isMine: true } as const

    expect(moodOf(boardOf([issue('running')], { running }))).toBe('working')
    expect(moodOf(boardOf([issue('done'), issue('done')]))).toBe('party')
    expect(moodOf(boardOf([issue('ready')], { next: 'p' }))).toBe('ready')
  })

  test('asks for help when an issue is held or the issues fail to read, sleeps when all wait', () => {
    expect(moodOf(boardOf([issue('held'), issue('waiting')]))).toBe('stuck')
    expect(moodOf(boardOf([], { problem: 'gh is offline' }))).toBe('stuck')
    expect(moodOf(boardOf([issue('waiting')]))).toBe('asleep')
    expect(moodOf(boardOf([]))).toBe('asleep')
  })
})

describe('Clawd', () => {
  test('stands in the middle, three rows tall', () => {
    const rows = glyphs({ kind: 'clawd', mood: 'ready' }, 500)

    expect(rows).toEqual(['    ▐▛███▜▌    ', '   ▝▜█████▛▘   ', '     ▘▘ ▝▝     '])
    expect(rows.every(row => [...row].length === CLAWD_COLUMNS)).toBe(true)
  })

  test('scuttles sideways while a worker runs', () => {
    const at = (now: number) => glyphs({ kind: 'clawd', mood: 'working' }, now)[1]!.indexOf('▝')

    expect([0, 200, 400, 600].map(at)).toEqual([0, 1, 2, 3])
  })

  test('sleeps with z rising, and waves a question when stuck', () => {
    expect(glyphs({ kind: 'clawd', mood: 'asleep' }, 0).join('')).toMatch(/z/)
    expect(glyphs({ kind: 'clawd', mood: 'asleep' }, 0)[0]).toContain('▐█████▌')
    expect(glyphs({ kind: 'clawd', mood: 'stuck' }, 0)[0]).toContain('?')
  })

  test('cheers an issue done for three seconds, sparkles around', () => {
    const cheering = glyphs({ kind: 'clawd', mood: 'ready', cheerAt: 1000 }, 1000).join('')
    const after = glyphs({ kind: 'clawd', mood: 'ready', cheerAt: 1000 }, 4500).join('')

    expect(cheering).toMatch(/[✦✧]/)
    expect(after).not.toMatch(/[✦✧]/)
  })
})

describe('tracks', () => {
  const stops: Stop[] = [
    { tone: 'done', isNext: false },
    { tone: 'running', isNext: false },
    { tone: 'ready', isNext: true },
    { tone: 'held', isNext: false },
    { tone: 'waiting', isNext: false },
  ]

  test('the line into a stop done or running is solid, the rest dotted', () => {
    expect(glyphs({ kind: 'track', stops, gap: 2 }, 0)).toEqual(['✓━━⠋┄┄○┄┄⏸┄┄·'])
    expect(trackGlyphs(stops, 2).map(one => one.glyph).join('')).toBe('✓━━◐┄┄○┄┄⏸┄┄·')
  })

  test('a gap of one to four cells fits the stops in the pane', () => {
    expect(gapFor(1, 80)).toBe(0)
    expect(gapFor(4, 80)).toBe(4)
    expect(gapFor(30, 80)).toBe(1)
    expect(gapFor(90, 80)).toBe(1)
  })

  test('an issue just done: the line fills, the stop sparkles, then confetti once it closed the lane', () => {
    const done: Stop[] = [
      { tone: 'done', isNext: false },
      { tone: 'done', isNext: false, doneAt: 1000 },
    ]
    const at = (now: number) => glyphs({ kind: 'track', stops: done, gap: 4 }, now)[0]

    expect(at(1000)).toBe('✓┄┄┄┄○')
    expect(at(1300)).toBe('✓━━┄┄○')
    expect(at(1700)).toBe('✓━━━━✦')
    expect(at(2600)).toBe('✦━━━━✓')
    expect(at(9000)).toBe('✓━━━━✓')
  })

  test('the preview replays a finish in a loop', () => {
    const done: Stop[] = [{ tone: 'done', isNext: false, doneAt: 1000 }]

    expect(glyphs({ kind: 'track', stops: done, gap: 0, loop: 6000 }, 7700)).toEqual(['✦'])
  })

  test('only a stop that runs, is next or turned done here moves', () => {
    expect(stops.map(isMoving)).toEqual([false, true, true, false, false])
    expect(isMoving({ tone: 'done', isNext: false, doneAt: 1 })).toBe(true)
  })
})
