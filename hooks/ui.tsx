import type { Color, Elements, RenderElement, RenderSurface } from 'claude-code'

import type {
  OrchestraBoard,
  OrchestraIssue,
  OrchestraJob,
  OrchestraReport,
  OrchestraShown,
  OrchestraTone,
  OrchestraWorker,
} from '../types'
import { MARK_COLUMNS, MARK_KEY } from './mark'
import { CLAWD, cheerOf, gapFor, isMoving, moodOf, sizeOf, trackGlyphs } from './motion'
import type { Sprite, Stop } from './motion'
import { noIssues } from './text'

// What orchestra draws, as plain functions of the surface's elements and the
// values in `$.state`: the board pane (/orchestra), the band above the
// prompt while a worker runs (in the worker's session too), the heartbeat
// line under a running `wait`, and the result rows of its three tools. The
// render hooks live in register.tsx and hand the buttons their handlers.

/** The surface's elements; only the terminal draws a Raster. */
export type Els = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button' | 'Link' | 'Markdown'> &
  Partial<Pick<Elements['terminal'], 'Raster'>>

/** What the buttons do. */
export type Handlers = {
  dispatch: (path: string | undefined) => void
  focus: (tab: string) => void
  abandon: (job: string) => void
  release: (job: string) => void
  board: () => void
}

export const PANE = 'orchestra'

type Tone = { icon: string; color: Color }

/** orchestra's own color: a running worker, the band. */
const PURPLE: Color = 'merged'

const TONES: Record<OrchestraTone, Tone> = {
  done: { icon: '✓', color: 'success' },
  running: { icon: '◐', color: PURPLE },
  ready: { icon: '○', color: 'suggestion' },
  held: { icon: '⏸', color: 'warning' },
  waiting: { icon: '·', color: 'inactive' },
}

/** A pane narrower than this draws no Clawd: the words need the room. */
const CLAWD_MIN_COLUMNS = 56

/** The longest a row's note gets before it is cut. */
const NOTE_COLUMNS = 24

/**
 * Draws a sprite: its cells at this moment where the surface draws a Raster,
 * which the timer then repaints by `key`; undefined where none draws.
 */
export type Motion = (key: string, sprite: Sprite) => string | undefined

/** A finished job's outcome: done is green, one that needs a person amber, the rest red. */
function outcomeTone(outcome: string): Tone {
  if (outcome === 'done') return { icon: '✓', color: 'success' }
  if (outcome === 'blocked' || outcome === 'abandoned') return { icon: '?', color: 'warning' }
  return { icon: '✗', color: 'error' }
}

// ── The board pane ──────────────────────────────────────────────────────

/** Clawd and how the board stands on top, then a lane per feature, each with its track, then the last jobs. */
export function pane(el: Els, board: OrchestraBoard | null, columns: number, on: Handlers, motion: Motion): RenderElement {
  const { Box, Text } = el
  const slugs = slugWidth(board?.issues ?? [])
  const isDrawn = board !== null && board.problem === undefined

  return (
    <Box flexDirection="column" width={columns}>
      {header(el, board, columns, on, motion)}
      {isDrawn ? features(board.issues).map(([feature, title]) => lane(el, board, feature, title, columns, slugs, on, motion)) : null}
      {!isDrawn || board.recent.length === 0 ? null : (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Recent</Text>
          {board.recent.map(job => recentRow(el, job, slugs))}
        </Box>
      )}
    </Box>
  )
}

/** Clawd, how the board stands, and the buttons that move it on. */
function header(el: Els, board: OrchestraBoard | null, columns: number, on: Handlers, motion: Motion): RenderElement {
  const { Box, Text, Button } = el
  const job = board?.running
  const canDispatch = board !== null && job === undefined && board.next !== undefined

  return (
    <Box key="header" flexDirection="row" gap={2}>
      {columns < CLAWD_MIN_COLUMNS ? null : clawd(el, board, motion)}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold color={PURPLE}>
            orchestra
          </Text>
          <Text dimColor wrap="truncate-end">
            {summaryOf(board)}
          </Text>
        </Box>
        {status(el, board)}
      </Box>
      <Box flexDirection="column" flexShrink={0}>
        {canDispatch ? (
          <Button key="next" label="Dispatch next" variant="primary" hotkey="n" onPress={() => on.dispatch(undefined)} />
        ) : null}
        {job === undefined || job.tab === '' ? null : (
          <Button key="focus" label="Focus tab" hotkey="f" onPress={() => on.focus(job.tab)} />
        )}
        {job === undefined ? null : <Button key="abandon" label="Abandon" onPress={() => on.abandon(job.id)} />}
      </Box>
    </Box>
  )
}

/** Clawd, who scuttles while a worker runs, waits, waves for help, sleeps or dances. */
function clawd(el: Els, board: OrchestraBoard | null, motion: Motion): RenderElement {
  const { Box, Text } = el
  const cheerAt = cheerOf(board)
  const sprite: Sprite = { kind: 'clawd', mood: moodOf(board), ...(cheerAt === undefined ? {} : { cheerAt }) }

  return drawn(el, motion, 'clawd', sprite, () => (
    <Box key="clawd" flexDirection="column" flexShrink={0}>
      {CLAWD.map((line, row) => (
        <Text key={`clawd:${row}`} color="claude">
          {line}
        </Text>
      ))}
    </Box>
  ))
}

/** The two lines beside Clawd: what runs, what is next, or why nothing can start. */
function status(el: Els, board: OrchestraBoard | null): RenderElement[] {
  const { Box, Text } = el
  const line = (key: string, text: string, color?: Color) => (
    <Text key={key} color={color} dimColor={color === undefined} wrap="wrap">
      {text}
    </Text>
  )
  if (board === null) return [line('status', 'Reading the issues…')]
  if (board.problem !== undefined) return [line('status', board.problem, 'warning')]
  if (board.issues.length === 0) return [line('status', noIssues(board.tracker))]

  const job = board.running
  if (job !== undefined) {
    return [
      <Box key="status" flexDirection="row" gap={1}>
        <Text color={PURPLE}>{TONES.running.icon}</Text>
        <Text bold>{linked(el, job.slug, job.url)}</Text>
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor wrap="truncate-end">
            {job.title}
          </Text>
        </Box>
      </Box>,
      <Text key="heartbeat" dimColor wrap="truncate-end">
        {heartbeat(job)}
      </Text>,
    ]
  }

  const next = board.issues.find(one => one.path === board.next)
  if (next !== undefined) {
    return [
      <Box key="status" flexDirection="row" gap={1}>
        <Text color={TONES.ready.color}>Next up</Text>
        <Text bold>{linked(el, next.slug, next.url)}</Text>
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor wrap="truncate-end">
            {next.title}
          </Text>
        </Box>
      </Box>,
    ]
  }

  const held = board.issues.filter(one => one.tone === 'held').length
  if (board.issues.every(one => one.tone === 'done')) return [line('status', 'Every issue is done ✦', 'success')]
  if (held > 0) {
    return [
      line('status', `Nothing can start: ${held === 1 ? 'an issue is' : `${held} issues are`} held`, 'warning'),
      line('hint', 'Its worker ended without finishing. Change the issue, or Release it.'),
    ]
  }

  return [line('status', 'Nothing can start: every issue waits on another, or on triage')]
}

/** One feature: its name and how far it got, its track, and a row per issue until every one is done. */
function lane(
  el: Els,
  board: OrchestraBoard,
  feature: string,
  title: string | undefined,
  columns: number,
  slugs: number,
  on: Handlers,
  motion: Motion,
): RenderElement {
  const { Box, Text } = el
  const issues = board.issues.filter(one => one.feature === feature)
  const done = issues.filter(one => one.tone === 'done').length
  const isDone = done === issues.length
  const stops = issues.map(one => stopOf(one, board.next))
  const gap = gapFor(stops.length, columns)
  const key = `track:${feature}`

  return (
    <Box key={`lane:${feature}`} flexDirection="column" marginTop={1}>
      <Box flexDirection="row" gap={1}>
        <Text bold>{feature === '' ? 'Other issues' : feature}</Text>
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor wrap="truncate-end">
            {title ?? ''}
          </Text>
        </Box>
        <Text color={isDone ? TONES.done.color : undefined} dimColor={!isDone}>
          {`${isDone ? `${TONES.done.icon} ` : ''}${done}/${issues.length} done`}
        </Text>
      </Box>
      {drawn(el, motion, key, { kind: 'track', stops, gap }, () => stillTrack(el, key, stops, gap))}
      {isDone ? null : issues.map(one => issueRow(el, one, board, slugs, on, motion))}
    </Box>
  )
}

/** A track drawn still: the line and the stops in their tones' colors. */
function stillTrack(el: Els, key: string, stops: readonly Stop[], gap: number): RenderElement {
  const { Text } = el
  const runs: { text: string; tone: OrchestraTone | 'rail' }[] = []
  for (const { glyph, tone } of trackGlyphs(stops, gap)) {
    const last = runs.at(-1)
    if (last?.tone === tone) last.text += glyph
    else runs.push({ text: glyph, tone })
  }

  return (
    <Text key={key} wrap="truncate-end">
      {runs.map((run, at) => (
        <Text key={`${key}:${at}`} color={run.tone === 'rail' ? 'inactive' : TONES[run.tone].color}>
          {run.text}
        </Text>
      ))}
    </Text>
  )
}

/** One issue: its icon, its name, its title, a note where one helps, and the button that moves it. */
function issueRow(
  el: Els,
  one: OrchestraIssue,
  board: OrchestraBoard,
  slugs: number,
  on: Handlers,
  motion: Motion,
): RenderElement {
  const { Box, Text, Button } = el
  const tone = TONES[one.tone]
  const isNext = one.path === board.next
  const stop = stopOf(one, board.next)
  const note = noteOf(one, isNext, board.running)
  const heldBy = one.heldBy
  const icon = () => <Text color={tone.color}>{tone.icon}</Text>

  return (
    <Box key={`issue:${one.path}`} flexDirection="row" gap={1} paddingLeft={2}>
      {isMoving(stop) ? drawn(el, motion, `icon:${one.path}`, { kind: 'icon', stop }, icon) : icon()}
      <Box width={slugs} flexShrink={0}>
        <Text bold={isNext} dimColor={one.tone === 'done'} wrap="truncate-end">
          {linked(el, one.slug, one.url)}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {one.title}
        </Text>
      </Box>
      {note === undefined ? null : (
        <Text color={note.color} dimColor={note.color === undefined}>
          {note.text}
        </Text>
      )}
      {one.tone === 'ready' ? (
        <Button key={`start:${one.path}`} label="Start" onPress={() => on.dispatch(one.path)} />
      ) : null}
      {heldBy === undefined ? null : (
        <Button key={`release:${one.path}`} label="Release" onPress={() => on.release(heldBy)} />
      )}
    </Box>
  )
}

function recentRow(el: Els, job: OrchestraJob, width: number): RenderElement {
  const { Box, Text } = el
  const tone = outcomeTone(job.lateOutcome ?? job.outcome ?? 'unknown')
  const how =
    job.lateOutcome === undefined
      ? (job.outcome ?? 'unknown')
      : `${job.outcome ?? 'unknown'}, then reported ${job.lateOutcome}`

  return (
    <Box key={`job:${job.id}`} flexDirection="row" gap={1}>
      <Text color={tone.color}>{tone.icon}</Text>
      <Box width={width} flexShrink={0}>
        <Text wrap="truncate-end">{linked(el, job.slug, job.url)}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {`${how} · ${job.minutes} min`}
        </Text>
      </Box>
    </Box>
  )
}

// ── The bands and the line under `wait` ────────────────────────────────

/** The spinner and the word: `cells` on the terminal, which the timer repaints; still elsewhere, without them. */
export function mark(el: Els, cells: string | undefined): RenderElement {
  const { Raster, Text } = el
  if (cells === undefined || Raster === undefined) return <Text color={PURPLE}>{`${TONES.running.icon} orchestra`}</Text>

  return <Raster key={MARK_KEY} columns={MARK_COLUMNS} rows={1} cells={cells} />
}

/** The orchestrator's band: the running worker. */
export function band(el: Els, job: OrchestraJob, cells: string | undefined, columns: number, on: Handlers): RenderElement {
  const { Box, Text, Button } = el

  return (
    <Box flexDirection="row" gap={1} width={columns}>
      {mark(el, cells)}
      <Text bold>{linked(el, job.slug, job.url)}</Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {heartbeat(job)}
        </Text>
      </Box>
      <Button key="board" label="Board" onPress={() => on.board()} />
      {job.tab === '' ? null : <Button key="focus" label="Focus tab" onPress={() => on.focus(job.tab)} />}
    </Box>
  )
}

/** A worker's own band: its job, and once it ended, how. */
export function workerBand(el: Els, me: OrchestraWorker, cells: string | undefined, columns: number): RenderElement {
  const { Box, Text } = el
  if (me.ended === undefined) {
    return (
      <Box flexDirection="row" gap={1} width={columns}>
        {mark(el, cells)}
        <Box flexShrink={1}>
          <Text color={PURPLE} wrap="truncate-end">{`worker · ${me.job}`}</Text>
        </Box>
      </Box>
    )
  }
  const tone = outcomeTone(me.ended)

  return (
    <Box flexDirection="row" gap={1} width={columns}>
      <Text color={tone.color}>{tone.icon}</Text>
      <Text color={PURPLE}>orchestra</Text>
      <Box flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {me.ended === 'stalled' ? `worker · ${me.job} · stalled without a report` : `worker · ${me.job} · reported ${me.ended}`}
        </Text>
      </Box>
    </Box>
  )
}

/** The engine's own `wait` row, and under it what the worker does. */
export function waitRow(el: Els, drawn: RenderElement, job: OrchestraJob): RenderElement {
  const { Box, Text } = el

  return (
    <Box flexDirection="column">
      {drawn}
      <Text dimColor wrap="truncate-end">
        {`  ⎿  ${job.slug} · ${heartbeat(job)}`}
      </Text>
    </Box>
  )
}

// ── Tool result rows ────────────────────────────────────────────────────

export function shownRow(el: Els, shown: OrchestraShown): RenderElement {
  const { Box, Text } = el

  switch (shown.kind) {
    case 'report':
      return reportCard(el, shown.report)
    case 'running':
      return <Text dimColor>{`${TONES.running.icon} ${shown.slug} still runs, ${shown.minutes} min since dispatch`}</Text>
    case 'started':
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text color={TONES.running.color}>▶</Text>
            <Text bold>{shown.slug}</Text>
            <Text dimColor>started in a new Ghostty tab</Text>
          </Box>
          <Text dimColor wrap="truncate-end">{`  ${shown.title} · job ${shown.job}`}</Text>
        </Box>
      )
    case 'issues': {
      const width = slugWidth(shown.issues)

      return (
        <Box flexDirection="column">
          {shown.issues.map(one => (
            <Box key={`issue:${one.path}`} flexDirection="row" gap={1}>
              <Text color={TONES[one.tone].color}>{TONES[one.tone].icon}</Text>
              <Box width={width} flexShrink={0}>
                <Text wrap="truncate-end">{linked(el, one.slug, one.url)}</Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text dimColor wrap="truncate-end">
                  {reasonOf(one, false)}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      )
    }
  }
}

function reportCard(el: Els, report: OrchestraReport): RenderElement {
  const { Box, Text, Markdown } = el
  const tone = outcomeTone(report.outcome)
  const how =
    report.lateFrom === undefined ? report.outcome : `${report.outcome}, reported after it was marked ${report.lateFrom}`
  const tree = report.dirty.length === 0 ? 'clean' : `${report.dirty.length} uncommitted`

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={tone.color} paddingX={1}>
      <Box flexDirection="row" gap={1}>
        <Text color={tone.color}>{tone.icon}</Text>
        <Text bold>{report.slug}</Text>
        <Text color={tone.color}>{how}</Text>
        <Text dimColor>{`· ${report.minutes} min`}</Text>
      </Box>
      {report.commits.length === 0 ? (
        <Text dimColor>No commits since dispatch</Text>
      ) : (
        report.commits.map(line => (
          <Text key={`commit:${line}`} wrap="truncate-end">
            {line}
          </Text>
        ))
      )}
      <Text dimColor wrap="truncate-end">
        {`Issue ${report.issue} · tree ${tree} · next ${report.next ?? 'none can start'}`}
      </Text>
      {report.summary === '' ? null : (
        <Box marginTop={1}>
          <Markdown text={report.summary} />
        </Box>
      )}
    </Box>
  )
}

// ── Shared ──────────────────────────────────────────────────────────────

/** What the worker does: `4 min · 37 tools · Edit hooks/register.ts, 12s ago`. */
export function heartbeat(job: OrchestraJob): string {
  if (job.phase === 'starting') return `starting, ${job.minutes} min since dispatch: no worker session yet`
  const parts = [`${job.minutes} min`]
  if (job.tools !== undefined) parts.push(`${job.tools} tools`)
  if (job.activity !== undefined) parts.push(`${job.activity}, ${ago(job.activityAgo ?? 0)}`)

  return parts.join(' · ')
}

/** The issue's name, a link to it where the tracker gave one; a remote surface opens only an `https:` one. */
function linked(el: Els, text: string, url: string | undefined): RenderElement | string {
  const { Link, Raster } = el
  if (url === undefined || (Raster === undefined && !url.startsWith('https:'))) return text

  return <Link href={url}>{text}</Link>
}

/** The features in the issues' order, each with its title. */
function features(issues: readonly OrchestraIssue[]): [string, string | undefined][] {
  return [...new Map(issues.map(one => [one.feature, one.featureTitle]))]
}

/** What a row says after its title, where its icon doesn't say it already. */
function noteOf(
  one: OrchestraIssue,
  isNext: boolean,
  running: OrchestraJob | undefined,
): { text: string; color?: Color } | undefined {
  if (one.tone === 'running' && running?.issue === one.path) return { text: `${running.minutes} min`, color: PURPLE }
  if (one.tone === 'held') return { text: `ended ${one.reason.match(/ended (\S+)/)?.[1] ?? 'finished'}`, color: 'warning' }
  if (one.tone === 'waiting') return { text: clip(one.reason.replace(/^status is /, ''), NOTE_COLUMNS) }
  if (isNext) return { text: 'next', color: TONES.ready.color }

  return undefined
}

/** The issue as a stop on its lane's track. */
function stopOf(one: OrchestraIssue, next: string | undefined): Stop {
  return { tone: one.tone, isNext: one.path === next, ...(one.doneAt === undefined ? {} : { doneAt: one.doneAt }) }
}

/** A sprite as a Raster where the surface draws one, which the timer repaints; else its still drawing. */
function drawn(el: Els, motion: Motion, key: string, sprite: Sprite, still: () => RenderElement): RenderElement {
  const { Raster } = el
  const cells = Raster === undefined ? undefined : motion(key, sprite)
  if (Raster === undefined || cells === undefined) return still()
  const { columns, rows } = sizeOf(sprite)

  return <Raster key={key} columns={columns} rows={rows} cells={cells} />
}

function clip(text: string, columns: number): string {
  return text.length <= columns ? text : `${text.slice(0, columns - 1)}…`
}

/** How the whole board stands: `4/7 done · 1 can start · 1 held`. */
function summaryOf(board: OrchestraBoard | null): string {
  const issues = board?.issues ?? []
  if (issues.length === 0) return ''
  const count = (tone: OrchestraTone) => issues.filter(one => one.tone === tone).length

  return [
    `${count('done')}/${issues.length} done`,
    ...(count('ready') > 0 ? [`${count('ready')} can start`] : []),
    ...(count('held') > 0 ? [`${count('held')} held`] : []),
  ].join(' · ')
}

/** The reason in a few words: a hold's long sentence cut to its outcome. */
function reasonOf(one: OrchestraIssue, isNext: boolean): string {
  if (one.tone === 'running') return 'a worker runs it'
  if (one.tone === 'held') return `held: ended ${one.reason.match(/ended (\S+)/)?.[1] ?? 'finished'}, unchanged since`
  if (isNext) return 'can start · next'

  return one.reason
}

function slugWidth(issues: readonly OrchestraIssue[]): number {
  return Math.min(28, Math.max(1, ...issues.map(one => one.slug.length)) + 1)
}

function ago(seconds: number): string {
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`

  return `${Math.floor(seconds / 60)}m ago`
}
