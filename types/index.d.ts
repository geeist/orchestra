// What orchestra keeps in `$.state`: the board every drawing reads, the
// rows its tool calls draw, a worker's own band, and the orchestrator's
// Ghostty terminal. The board is rebuilt from the files in
// <git common dir>/orchestra. Also the inputs of orchestra's own tools,
// which the hooks match on.

/** How an issue stands: done, a worker on it, can start, held back, or waiting. */
export type OrchestraTone = 'done' | 'running' | 'ready' | 'held' | 'waiting'

/** One issue as the board shows it. */
export type OrchestraIssue = {
  /** Relative to the repo root, `#42` on GitHub, or the Jira story's key (`CORE-42`). */
  path: string
  /** The .scratch folder, the parent issue on GitHub (`#12`), or the Jira epic (`CORE-12`); "" for none. */
  feature: string
  /** The parent issue's or the epic's title, on GitHub and Jira. */
  featureTitle?: string
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
  /** Every issue in the tracker, in order: feature, then number. */
  issues: OrchestraIssue[]
  /** Where the issues live: .scratch, GitHub or Jira. */
  tracker?: 'local' | 'github' | 'jira'
  running?: OrchestraJob
  /** Finished jobs, newest first. */
  recent: OrchestraJob[]
  /** The path of the issue `dispatch` takes next. */
  next?: string
  /** Why there is no board: the issues failed to read. */
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
  /** The issue now: status and boxes. */
  issue: string
  /** `git status --porcelain` lines. */
  dirty: string[]
  /** The issue that can start next, as the tools name it (`feature/slug`, `#42` or `CORE-42`). */
  next?: string
}

/** A worker session's band. */
export type OrchestraWorker = {
  job: string
  /** How it ended: the outcome it reported, or `stalled`. Absent while it works. */
  ended?: string
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
      worker: OrchestraWorker | null
      /** The id of the Ghostty terminal the person types to the orchestrator in; its window takes the worker tabs. */
      home: string | null
    }
  }

  // The engine lays the MCP tools from the session that saved the mod last:
  // an orchestrator has no `report`, a worker none of the other three. So
  // they are declared here, each the same as its inputSchema in register.tsx.
  interface McpToolInputs {
    mcp__orchestra__issues: {
      feature?: string
    }
    mcp__orchestra__dispatch: {
      issue?: string
      force?: boolean
    }
    mcp__orchestra__wait: {
      minutes?: number
    }
    mcp__orchestra__report: {
      outcome: 'done' | 'blocked' | 'failed'
      summary: string
    }
  }
}
