// What orchestra keeps in `$.state`: the board every drawing reads, and the
// rows its tool calls draw. Rebuilt from the files in <git common dir>/orchestra.

/** How an issue stands: done, a worker on it, can start, held back, or waiting. */
export type OrchestraTone = 'done' | 'running' | 'ready' | 'held' | 'waiting'

/** One issue as the board shows it. */
export type OrchestraIssue = {
  /** Relative to the repo root. */
  path: string
  feature: string
  slug: string
  title: string
  tone: OrchestraTone
  /** Why it can't start, or `can start`. */
  reason: string
  /** The finished job that holds it back, which Release lets go. */
  heldBy?: string
}

/** One dispatch as the board shows it. */
export type OrchestraJob = {
  id: string
  issue: string
  slug: string
  title: string
  /** The Ghostty tab's id. */
  tab: string
  /** Whole minutes since dispatch, or the run's length once finished. */
  minutes: number
  /** `starting` until the worker session writes its file. */
  phase: 'starting' | 'running' | 'finished'
  outcome?: string
  /** The outcome a worker reported after the job had settled without it. */
  lateOutcome?: string
  /** The worker's latest tool call (`Edit hooks/register.ts`). */
  activity?: string
  /** Seconds since that call. */
  activityAgo?: number
  /** Tool calls the worker made, its agents' included. */
  tools?: number
  /** Dispatched by this session, which its report wakes. */
  isMine: boolean
}

export type OrchestraBoard = {
  /** Every issue in .scratch, in order: feature, then number. */
  issues: OrchestraIssue[]
  running?: OrchestraJob
  /** Finished jobs, newest first. */
  recent: OrchestraJob[]
  /** The path of the issue `dispatch` takes next. */
  next?: string
  /** Why there is no board: not a git repo, or the files failed to read. */
  problem?: string
}

/** A worker's outcome, as the orchestrator's model reads it and its row draws it. */
export type OrchestraReport = {
  slug: string
  job: string
  outcome: string
  /** Set when the worker reported after the job was settled as `lateFrom`. */
  lateFrom?: string
  minutes: number
  summary: string
  /** `git log --oneline` lines since dispatch. */
  commits: string[]
  /** The issue file now: status and boxes. */
  issue: string
  /** `git status --porcelain` lines. */
  dirty: string[]
  /** `feature/slug` of the issue that can start next. */
  next?: string
}

/** What an orchestra tool's result row draws, keyed by the call's id. */
export type OrchestraShown =
  | { kind: 'report'; report: OrchestraReport }
  | { kind: 'running'; slug: string; minutes: number }
  | { kind: 'started'; job: string; slug: string; title: string; path: string }
  | { kind: 'issues'; issues: OrchestraIssue[] }

declare module 'claude-code' {
  interface PluginState {
    orchestra: {
      board: OrchestraBoard | null
      shown: StateFamily<OrchestraShown | null>
    }
  }
}
