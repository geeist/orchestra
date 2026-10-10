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

// What orchestra draws, as plain functions of the surface's elements and the
// values in `$.state`: the board pane (/orchestra), the band above the
// prompt while a worker runs (in the worker's session too), the heartbeat
// line under a running `wait`, and the result rows of its three tools. The
// render hooks live in register.tsx and hand the buttons their handlers.

/** The surface's elements; only the terminal draws a Raster. */
export type Els = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button' | 'Markdown'> &
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

/** A finished job's outcome: done is green, one that needs a person amber, the rest red. */
function outcomeTone(outcome: string): Tone {
  if (outcome === 'done') return { icon: '✓', color: 'success' }
  if (outcome === 'blocked' || outcome === 'abandoned') return { icon: '?', color: 'warning' }
  return { icon: '✗', color: 'error' }
}

// ── The board pane ──────────────────────────────────────────────────────

export function pane(el: Els, board: OrchestraBoard | null, columns: number, on: Handlers): RenderElement {
  const { Box, Text, Button } = el
  if (board === null) return <Text dimColor>Reading .scratch…</Text>
  if (board.problem !== undefined) return <Text dimColor>{board.problem}</Text>
  if (board.issues.length === 0) return <Text dimColor>No issues in .scratch.</Text>

  const width = slugWidth(board.issues)
  const features = [...new Set(board.issues.map(one => one.feature))]
  const count = (tone: OrchestraTone) => board.issues.filter(one => one.tone === tone).length
  const summary = [
    `${count('done')}/${board.issues.length} done`,
    ...(count('ready') > 0 ? [`${count('ready')} can start`] : []),
    ...(count('held') > 0 ? [`${count('held')} held`] : []),
  ].join(' · ')
  const canDispatch = board.running === undefined && board.next !== undefined

  return (
    <Box flexDirection="column" width={columns}>
      <Box flexDirection="row" gap={1}>
        <Box flexGrow={1}>
          <Text dimColor>{summary}</Text>
        </Box>
        {canDispatch ? (
          <Button key="next" label="Dispatch next" variant="primary" hotkey="n" onPress={() => on.dispatch(undefined)} />
        ) : null}
      </Box>
      {board.running === undefined ? null : running(el, board.running, on)}
      {features.map(feature => (
        <Box key={`feature:${feature}`} flexDirection="column" marginTop={1}>
          <Text bold>{feature}</Text>
          {board.issues.filter(one => one.feature === feature).map(one => issueRow(el, one, board.next, width, on))}
        </Box>
      ))}
      {board.recent.length === 0 ? null : (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Recent</Text>
          {board.recent.map(job => recentRow(el, job, width))}
        </Box>
      )}
    </Box>
  )
}

function running(el: Els, job: OrchestraJob, on: Handlers): RenderElement {
  const { Box, Text, Button } = el
  const tone = TONES.running

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={tone.color} paddingX={1}>
      <Box flexDirection="row" gap={1}>
        <Text color={tone.color}>{tone.icon}</Text>
        <Box flexGrow={1} flexShrink={1}>
          <Text bold wrap="truncate-end">
            {job.slug}
          </Text>
        </Box>
        {job.tab === '' ? null : <Button key="focus" label="Focus tab" hotkey="f" onPress={() => on.focus(job.tab)} />}
        <Button key="abandon" label="Abandon" onPress={() => on.abandon(job.id)} />
      </Box>
      <Text dimColor wrap="truncate-end">
        {heartbeat(job)}
      </Text>
      <Text dimColor wrap="truncate-end">
        {job.title}
      </Text>
    </Box>
  )
}

function issueRow(el: Els, one: OrchestraIssue, next: string | undefined, width: number, on: Handlers): RenderElement {
  const { Box, Text, Button } = el
  const tone = TONES[one.tone]
  const isNext = one.path === next
  const heldBy = one.heldBy

  return (
    <Box key={`issue:${one.path}`} flexDirection="row" gap={1}>
      <Text color={tone.color}>{tone.icon}</Text>
      <Box width={width} flexShrink={0}>
        <Text bold={isNext} wrap="truncate-end">
          {one.slug}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor={!isNext} wrap="truncate-end">
          {reasonOf(one, isNext)}
        </Text>
      </Box>
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
        <Text wrap="truncate-end">{job.slug}</Text>
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
      <Text bold>{job.slug}</Text>
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
                <Text wrap="truncate-end">{one.slug}</Text>
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
