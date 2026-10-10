// The jobs, read: what the files in <git common dir>/orchestra say about each
// dispatch, and the board every drawing reads. Pure, so the tests cover it whole.

import type { OrchestraBoard, OrchestraIssue, OrchestraJob, OrchestraTone } from '../types'
import type { Candidate, Issue } from './scratch'

/** One dispatch, as the orchestrator records it. */
export type Job = {
  id: string
  /** The issue's path, relative to the repo root. */
  issue: string
  slug: string
  title: string
  /** The orchestrator session that dispatched it, and is woken for it. */
  session: string
  /** HEAD when the worker started: its commits are `baseHead..HEAD`. */
  baseHead: string
  /** The Ghostty tab's id. */
  tab: string
  startedAt: number
  /** Set once the outcome reached the orchestrator's model. */
  finishedAt?: number
  outcome?: string
  /** The person let the issue go: its hold ends although the file is unchanged. */
  releasedAt?: number
  /** A report that came after the job settled without one. */
  late?: { outcome: string; summary: string; at: number }
  /** Set once the late report reached the orchestrator's model. */
  lateDeliveredAt?: number
}

/** The worker's side of a job. */
export type WorkerState = {
  state: 'running' | 'reported' | 'stalled' | 'exited'
  outcome?: string
  summary?: string
  lastAnswer?: string
  /** The latest tool call, its agents' included (`Edit hooks/register.ts`). */
  activity?: string
  activityAt?: number
  tools?: number
  updatedAt: number
}

export type Settled = { outcome: string; summary: string }

export const OUTCOMES = ['done', 'blocked', 'failed']
export const START_GRACE_MS = 3 * 60_000
export const MAX_NUDGES = 2

/** Outcomes the orchestrator settles on without a report; a report may still follow. */
const UNREPORTED = new Set(['never-started', 'stalled', 'exited', 'abandoned'])

/** Whether the job's worker is finished, and how; undefined while it runs. */
export function settle(job: Job, state: WorkerState | undefined, now: number): Settled | undefined {
  if (state === undefined) {
    return now - job.startedAt < START_GRACE_MS
      ? undefined
      : {
          outcome: 'never-started',
          summary:
            'The worker session never started, or started without this mod (the claude function loads it). Look at its Ghostty tab.',
        }
  }

  switch (state.state) {
    case 'running':
      return undefined
    case 'reported':
      return { outcome: state.outcome ?? 'done', summary: state.summary ?? '' }
    case 'stalled':
      return {
        outcome: 'stalled',
        summary: `The worker kept stopping without a report, ${MAX_NUDGES} reminders later. Its last answer:\n${state.lastAnswer ?? ''}`,
      }
    case 'exited':
      return {
        outcome: 'exited',
        summary: `The worker session ended without a report. Its last answer:\n${state.lastAnswer ?? ''}`,
      }
  }
}

/** A report that came after the job settled without one, not yet recorded on the job. */
export function lateReport(job: Job, state: WorkerState | undefined): Job['late'] | undefined {
  if (job.finishedAt === undefined || job.late !== undefined || !UNREPORTED.has(job.outcome ?? '')) return undefined
  if (state?.state !== 'reported') return undefined

  return { outcome: state.outcome ?? 'done', summary: state.summary ?? '', at: state.updatedAt }
}

/** What the job came to: its late report's outcome over the one it settled on. */
export function outcomeOf(job: Job): string {
  return job.late?.outcome ?? job.outcome ?? 'unknown'
}

/** Why the orchestrator keeps an issue back: a worker on it, or a finished worker and no edit since. */
export function holds(jobs: readonly Job[], changedAt: ReadonlyMap<string, number>): Map<string, string> {
  const held = new Map<string, string>()
  for (const job of jobs) {
    if (job.finishedAt === undefined) {
      held.set(job.issue, `a worker runs it (job ${job.id})`)
    } else if (
      job.outcome !== 'not-launched' &&
      job.releasedAt === undefined &&
      (changedAt.get(job.issue) ?? 0) <= job.finishedAt
    ) {
      held.set(job.issue, `its last worker ended ${outcomeOf(job)} and the issue hasn't changed since (job ${job.id})`)
    } else {
      held.delete(job.issue)
    }
  }

  return held
}

/** The board: every issue with its tone, the running job with its heartbeat, and the last few finished. */
export function board(input: {
  list: readonly Candidate[]
  jobs: readonly Job[]
  workers: ReadonlyMap<string, WorkerState>
  session: string
  now: number
}): OrchestraBoard {
  const { list, jobs, workers, session, now } = input
  const open = jobs.find(job => job.finishedAt === undefined)
  const next = list.find(one => one.canStart)
  const lastJob = new Map(jobs.map(job => [job.issue, job]))

  const issues = list.map((one): OrchestraIssue => {
    const tone = toneOf(one, open)
    const holder = lastJob.get(one.path)
    const isHeld = tone === 'held' && holder?.finishedAt !== undefined

    return {
      path: one.path,
      feature: one.feature,
      slug: one.slug,
      title: one.title,
      tone,
      reason: one.reason,
      ...(isHeld ? { heldBy: holder.id } : {}),
    }
  })

  const show = (job: Job): OrchestraJob => {
    const worker = workers.get(job.id)
    const end = job.finishedAt ?? now

    return {
      id: job.id,
      issue: job.issue,
      slug: job.slug,
      title: job.title,
      tab: job.tab,
      minutes: Math.floor((end - job.startedAt) / 60_000),
      phase: job.finishedAt !== undefined ? 'finished' : worker === undefined ? 'starting' : 'running',
      ...(job.outcome === undefined ? {} : { outcome: job.outcome }),
      ...(job.late === undefined ? {} : { lateOutcome: job.late.outcome }),
      ...(worker?.activity === undefined ? {} : { activity: worker.activity }),
      ...(worker?.activityAt === undefined ? {} : { activityAgo: roughSeconds(now - worker.activityAt) }),
      ...(worker?.tools === undefined ? {} : { tools: worker.tools }),
      isMine: job.session === session,
    }
  }

  return {
    issues,
    ...(open === undefined ? {} : { running: show(open) }),
    recent: jobs
      .filter(job => job.finishedAt !== undefined)
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
      .slice(0, 5)
      .map(show),
    ...(next === undefined ? {} : { next: next.path }),
  }
}

function toneOf(one: Candidate, open: Job | undefined): OrchestraTone {
  if (one.isDone) return 'done'
  if (open?.issue === one.path) return 'running'
  if (one.canStart) return 'ready'
  if (one.reason.startsWith('its last worker')) return 'held'
  return 'waiting'
}

/** Seconds, to the second below a minute, then to ten: the board redraws less while nothing happens. */
function roughSeconds(ms: number): number {
  const seconds = Math.max(0, Math.floor(ms / 1000))

  return seconds < 60 ? seconds : seconds - (seconds % 10)
}

/** One tool call in a few words, for the heartbeat: `Edit hooks/register.ts`, `Agent Spec review`. */
export function describeCall(call: { tool: string; agentId?: string; [key: string]: unknown }): string {
  const text = (key: string) => (typeof call[key] === 'string' ? (call[key] as string) : '')
  const path = (key: string) => text(key).split('/').slice(-2).join('/')
  const detail = (() => {
    switch (call.tool) {
      case 'Bash':
        return text('description') || text('command')
      case 'Read':
      case 'Edit':
      case 'Write':
        return path('file_path')
      case 'NotebookEdit':
        return path('notebook_path')
      case 'Grep':
      case 'Glob':
        return text('pattern')
      case 'Agent':
        return text('description')
      case 'Skill':
        return text('skill')
      default:
        return ''
    }
  })()
  const tool = call.tool.startsWith('mcp__') ? call.tool.split('__').slice(1).join(' ') : call.tool
  const line = `${call.agentId === undefined ? '' : 'agent: '}${tool}${detail === '' ? '' : ` ${detail}`}`

  return line.replace(/\s+/g, ' ').slice(0, 80)
}

/** The issues as the `issues` tool answers: one line each, the next one marked. */
export function table(list: readonly Candidate[]): string {
  const next = list.find(one => one.canStart)

  return list
    .map(one => `${one.feature}/${one.slug}: ${one.reason}${one === next ? ' (next)' : ''}. ${one.title}`)
    .join('\n')
}

/** The issue file's state in one line. */
export function describe(issue: Issue): string {
  const boxes = issue.doneBoxes + issue.openBoxes

  return `status ${issue.status || 'missing'}, ${issue.doneBoxes}/${boxes} boxes ticked, ${issue.isDone ? 'done' : 'not done'}`
}
