import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, HookFailure, PluginOptions, Register } from 'claude-code'

import type { OrchestraBoard, OrchestraReport, OrchestraShown } from '../types'
import { board, describe, describeCall, holds, lateReport, MAX_NUDGES, OUTCOMES, settle, table } from './board'
import type { Job, Settled, WorkerState } from './board'
import { githubIssues, namesGithub, QUERY, triageLabels } from './github'
import type { Node, Page, Tracker } from './github'
import { atlassianServer, FIELDS, jiraIssues, jiraScope, jql, namesJira, SEARCH_TOOL, searchPage } from './jira'
import type { JiraNode } from './jira'
import { commandLine, FOCUS_TAB, FRONT_TERMINAL, OPEN_TAB, workerPrompt } from './launch'
import { FRAME_MS, frameAt, MARK_KEY, markCells, PALETTES, paletteFor } from './mark'
import { findIssues, parseIssue, plan, sameFeature } from './scratch'
import type { Candidate, Issue } from './scratch'
import {
  brief,
  DISPATCH_DESCRIPTION,
  goal,
  ISSUES_DESCRIPTION,
  noIssues,
  NUDGE,
  REPORT_DESCRIPTION,
  WAIT_DESCRIPTION,
} from './text'
import { band, pane, PANE, shownRow, waitRow, workerBand } from './ui'
import type { Els, Handlers } from './ui'

// One mod, two roles. A session started with ORCHESTRA_JOB set is a worker:
// it gets the `report` tool, writes a heartbeat of its tool calls, and is
// nudged until it reports. Every other session is an orchestrator: it gets
// `issues`, `dispatch` and `wait`, the commands /dispatch, /orchestrate and
// /orchestra (the board), and a timer that keeps the board current and wakes
// it when its worker has reported while it sat idle. It remembers the
// Ghostty terminal the person types to it in, so worker tabs open in that
// terminal's window. Both draw a band above the prompt while a worker runs.
//
// The two sides talk through files in <git common dir>/orchestra, never
// tracked and shared by every worktree: `<job>.job.json` is written by the
// orchestrators, `<job>.worker.json` by the worker alone.
//
// The issues are the .scratch files, the repo's GitHub issues once
// docs/agents/issue-tracker.md says GitHub (`gh` fetches those), or a Jira
// project's stories once it says Jira (the session's Atlassian MCP server
// searches those).

type $ = EngineInterface

type Repo = { top: string; dir: string }

/** A tool's answer: the text the model reads, and what its row draws. */
type Answer = { text: string; shown?: OrchestraShown }

/** Issues, and when each last changed (a hold ends once it does). */
type Issues = { issues: Issue[]; changedAt: Map<string, number> }

/** The tracker's issues. */
type Loaded = { tracker: Tracker } & Issues

const REFRESH_MS = 5_000
const BEAT_MS = 5_000
const WAIT_STEP_SECONDS = 5
/** How long after a job settled a late report is still looked for. */
const LATE_WINDOW_MS = 24 * 60 * 60_000
/** Agent states that mean a worker's turn ended to wait for them. */
const BUSY = new Set(['pending', 'running', 'waiting'])
/** How long the board's timer reuses the GitHub issues or Jira stories; the tools fetch them anew. */
const REMOTE_TTL_MS = 60_000
/** Pages of 100 open GitHub issues, or of 100 Jira stories, read at most. */
const PAGES = 10

const SHOWN = { plugin: 'orchestra', key: 'shown' } as const
const boardAtom = atom({ plugin: 'orchestra', key: 'board' } as const, null)
const shownAtom = atom({ plugin: 'orchestra', key: 'shown' } as const, null)
const workerAtom = atom({ plugin: 'orchestra', key: 'worker' } as const, null)
const homeAtom = atom({ plugin: 'orchestra', key: 'home' } as const, null)

// The module's own state: a reload starts it over, the files keep the rest.
let worker: { job: string; dir: string } | undefined
let repoCache: Repo | null | undefined
let nudges = 0
let lastAnswer = ''
let waits = 0
let isTurnRunning = false
let isTicking = false
let shownBoard = ''
/** The band's site while it draws the mark as a Raster, which the animation repaints. */
let bandSite: string | undefined
let animation: { cancel: () => void } | undefined
let palette = PALETTES.dark
let beat = { activity: '', at: 0, tools: 0, isDirty: false }
let writing: Promise<void> = Promise.resolve()
let refreshing: Promise<void> | undefined
/** The GitHub issues or Jira stories last fetched, for the tracker `key` names, shared by calls while they load. */
let fetched: { at: number; key: string; issues: Promise<Issues> } | undefined

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const job = await $.env.get('ORCHESTRA_JOB')
    const dir = await $.env.get('ORCHESTRA_DIR')
    const theme = await $.config.list().then(rows => rows.find(row => row.key === 'theme')?.value, () => undefined)
    palette = paletteFor(theme)
    // The band took over from the status line: clear one an earlier version pinned before this reload.
    $.ui.status(undefined)

    if (job !== undefined && job !== '' && dir !== undefined && dir !== '') {
      worker = { job, dir }
      await startWorker($, job)
    } else {
      await startOrchestrator($)
    }

    return next(e)
  })

  // ── Drawings (ui.tsx draws them; every one reads `$.state`) ───────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    pane($.ui.resolve(e), await read($, boardAtom), e.props.bodyColumns, handlers($, options)),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const me = await read($, workerAtom)
    const job = me === null ? (await read($, boardAtom))?.running : undefined
    if (e.props.hasSurvey || (me === null && job === undefined)) {
      bandSite = undefined
      return next(e)
    }

    const el: Els = $.ui.resolve(e)
    // Only the terminal draws a Raster, so only there the mark turns.
    const cells = e.surface === 'terminal' ? markCells(frameAt(await $.clock.now()), palette) : undefined
    bandSite = cells !== undefined && me?.ended === undefined ? e.requestId : undefined
    if (me !== null) return workerBand(el, me, cells, e.props.bodyColumns)

    return band(el, job!, cells, e.props.bodyColumns, handlers($, options))
  })

  on('ui.render', { component: 'ToolUse', props: { tool: 'mcp__orchestra__wait' } }, async ($, e, next) => {
    const drawn = await next(e)
    const job = e.props.isRunning ? (await read($, boardAtom))?.running : undefined

    return job === undefined ? drawn : waitRow($.ui.resolve(e), drawn, job)
  })

  on('ui.render', { component: 'ToolResult', props: { tool: 'mcp__orchestra__wait' } }, async ($, e, next) => {
    const shown = e.props.isErrored ? null : await read($, memberOf(shownAtom, e))

    return shown === null ? next(e) : shownRow($.ui.resolve(e), shown)
  })

  on('ui.render', { component: 'ToolResult', props: { tool: 'mcp__orchestra__dispatch' } }, async ($, e, next) => {
    const shown = e.props.isErrored ? null : await read($, memberOf(shownAtom, e))

    return shown === null ? next(e) : shownRow($.ui.resolve(e), shown)
  })

  on('ui.render', { component: 'ToolResult', props: { tool: 'mcp__orchestra__issues' } }, async ($, e, next) => {
    const shown = e.props.isErrored ? null : await read($, memberOf(shownAtom, e))

    return shown === null ? next(e) : shownRow($.ui.resolve(e), shown)
  })

  // ── Worker ────────────────────────────────────────────────────────────

  on('tool.call', { tool: 'mcp__orchestra__report' }, async ($, e) => {
    if (worker === undefined) return { deny: 'Only an orchestra worker session reports.' }
    const outcome = String(e.outcome)
    if (!OUTCOMES.includes(outcome)) return { deny: 'outcome is one of done, blocked or failed.' }

    await writeWorker($, { state: 'reported', outcome, summary: String(e.summary ?? '') })
    await endWorker($, outcome)

    return { result: 'Reported to the orchestrator, which takes it from here. Stop now.' }
  }).catch(($, e, next) => ({ deny: failure(next.error) }))

  // The heartbeat: every tool call of the worker and its agents, written by a timer.
  on('tool.call', async ($, e, next) => {
    if (worker !== undefined) {
      beat = { activity: describeCall(e), at: await $.clock.now(), tools: beat.tools + 1, isDirty: true }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    if (worker === undefined) isTurnRunning = true

    return next(e)
  })

  // The person typing to the orchestrator is at its terminal: remember which.
  on('prompt.submit', ($, e, next) => {
    if (worker === undefined && e.origin.kind === 'composer') void locate($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    if (worker === undefined) {
      isTurnRunning = false
      return next(e)
    }

    lastAnswer = e.answer || lastAnswer
    // An interrupt means a person is at this tab: leave the session to them.
    if (e.reason !== 'aborted') await nudge($)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (worker !== undefined && e.reason !== 'clear' && e.reason !== 'resume') {
      const current = await readJson<WorkerState>($, workerFile())
      if (current?.state === 'running') await writeWorker($, { state: 'exited', lastAnswer })
    }

    return next(e)
  })

  // ── Orchestrator ──────────────────────────────────────────────────────

  on('tool.call', { tool: 'mcp__orchestra__issues' }, async ($, e) => {
    try {
      const { list, jobs, tracker } = await candidates($, await repo($), true)
      const feature = typeof e.feature === 'string' && e.feature !== '' ? e.feature : undefined
      const shown = list.filter(one => feature === undefined || sameFeature(one.feature, feature))
      if (shown.length === 0) return { result: noIssues(tracker.kind) }
      const drawn = board({ list: shown, jobs, workers: new Map(), session: '', now: await $.clock.now() })

      return answer($, e.tool_use_id, { text: table(shown), shown: { kind: 'issues', issues: drawn.issues } })
    } catch (error) {
      return { deny: `orchestra: ${message(error)}` }
    }
  }).catch(($, e, next) => ({ deny: failure(next.error) }))

  on('tool.call', { tool: 'mcp__orchestra__dispatch' }, async ($, e) => {
    try {
      const ref = typeof e.issue === 'string' && e.issue.trim() !== '' ? e.issue : undefined
      return answer($, e.tool_use_id, await dispatch($, options, ref, e.force === true))
    } catch (error) {
      return { deny: `orchestra: ${message(error)}` }
    }
  }).catch(($, e, next) => ({ deny: failure(next.error) }))

  on('tool.call', { tool: 'mcp__orchestra__wait' }, async ($, e, next) => {
    const minutes = Math.min(30, Math.max(1, Number(e.minutes) || 10))
    waits += 1
    try {
      return answer($, e.tool_use_id, await wait($, minutes, next.signal))
    } catch (error) {
      return { deny: `orchestra: ${message(error)}` }
    } finally {
      waits -= 1
    }
  }).catch(($, e, next) => ({ deny: failure(next.error) }))

  on('command.run', { command: 'dispatch' }, async ($, e) => {
    const words = e.args.split(/\s+/).filter(word => word !== '')
    const ref = words.filter(word => word !== '--force').join(' ')
    try {
      if (e.origin.kind === 'composer') await locate($)
      return { text: (await dispatch($, options, ref === '' ? undefined : ref, words.includes('--force'))).text }
    } catch (error) {
      return { text: `orchestra: ${message(error)}` }
    }
  })

  on('command.run', { command: 'orchestrate' }, async ($, e) => {
    const condition = `/goal ${goal(e.args.trim() === '' ? undefined : e.args.trim())}`
    const { isFilled } = await $.prompt.fill({ text: condition })

    return { text: isFilled ? 'The goal is in the prompt box. Press Enter to set it.' : `Run: ${condition}` }
  })

  on('command.run', { command: 'orchestra' }, async $ => {
    await refresh($)
    const opened = await $.ui.open({ id: PANE, title: 'orchestra' })

    return { text: opened.isPlaced ? 'The board is open.' : `The board waits: ${opened.reason}` }
  })
}

// ── Starting each role ──────────────────────────────────────────────────

async function startWorker($: $, job: string): Promise<void> {
  await $.tool.register({
    name: 'report',
    description: REPORT_DESCRIPTION,
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: OUTCOMES },
        summary: { type: 'string', description: 'What changed, the commits, and what a reviewer should check' },
      },
      required: ['outcome', 'summary'],
    },
  })
  // A reload runs this again: keep a state already written, and count on from its tool calls.
  const current = await readJson<WorkerState>($, workerFile())
  if (current === undefined) await writeWorker($, { state: 'running' })
  beat = { ...beat, tools: current?.tools ?? 0 }
  if (current === undefined || current.state === 'running') {
    await update($, workerAtom, () => ({ job }))
    animate($, true)
  } else {
    await endWorker($, current.state === 'reported' ? (current.outcome ?? 'unknown') : current.state)
  }
  $.clock.every(BEAT_MS, () => void flushBeat($))
}

/** The worker's band says how it ended, and stops turning. */
async function endWorker($: $, ended: string): Promise<void> {
  animate($, false)
  if (worker !== undefined) await update($, workerAtom, () => ({ job: worker!.job, ended }))
}

async function startOrchestrator($: $): Promise<void> {
  await $.tool.register({
    name: 'issues',
    description: ISSUES_DESCRIPTION,
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        feature: {
          type: 'string',
          description: 'Only this feature: a .scratch/<feature> folder, a parent issue (#12), or a Jira epic (CORE-12)',
        },
      },
    },
  })
  await $.tool.register({
    name: 'dispatch',
    description: DISPATCH_DESCRIPTION,
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        issue: {
          type: 'string',
          description:
            'A number (03, #42 on GitHub, CORE-42 in Jira), slug (03-ui-shell), feature/number or path; default the next that can start',
        },
        force: { type: 'boolean', description: 'Start it although it is not ready or the working tree is dirty' },
      },
    },
  })
  await $.tool.register({
    name: 'wait',
    description: WAIT_DESCRIPTION,
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: { minutes: { type: 'number', description: 'How long to block at most, 1 to 30; default 10' } },
    },
  })
  await $.command.register({
    name: 'dispatch',
    description: 'Implement an issue in a worker session in a new Ghostty tab',
    argumentHint: '[issue] [--force]',
  })
  await $.command.register({
    name: 'orchestrate',
    description: 'Put a /goal in the prompt box that works every issue through workers',
    argumentHint: '[feature]',
  })
  await $.command.register({
    name: 'orchestra',
    description: 'Open the orchestra board: the issues, the running worker and the last jobs',
  })
  $.clock.every(REFRESH_MS, () => void tick($))
  void tick($)
}

// ── Worker ──────────────────────────────────────────────────────────────

function workerFile(): string {
  return worker === undefined ? '' : `${worker.dir}/${worker.job}.worker.json`
}

/** Merges `patch` into the worker's file, one write at a time, so a heartbeat never undoes a report. */
function writeWorker($: $, patch: Partial<WorkerState>): Promise<void> {
  writing = writing
    .catch(() => undefined)
    .then(async () => {
      const current = await readJson<WorkerState>($, workerFile())
      await writeJson($, workerFile(), { state: 'running', ...current, ...patch, updatedAt: await $.clock.now() })
    })

  return writing
}

async function flushBeat($: $): Promise<void> {
  if (!beat.isDirty) return
  beat = { ...beat, isDirty: false }
  await writeWorker($, { activity: beat.activity, activityAt: beat.at, tools: beat.tools })
}

/** After a turn that ended without a report: remind the worker, then give up and say so. */
async function nudge($: $): Promise<void> {
  const current = await readJson<WorkerState>($, workerFile())
  if (current?.state !== 'running') return
  // A turn that ends while its agents run waits for them: their notification starts the next.
  const agents = await $.agent.list().catch(() => [])
  if (agents.some(agent => BUSY.has(agent.status))) return

  if (nudges < MAX_NUDGES) {
    nudges += 1
    void $.prompt.submit({ text: NUDGE })
  } else {
    await writeWorker($, { state: 'stalled', lastAnswer })
    await endWorker($, 'stalled')
  }
}

// ── Orchestrator ────────────────────────────────────────────────────────

async function repo($: $): Promise<Repo> {
  const found = await findRepo($)
  if (found === undefined) throw new Error('this session is not in a git repository')

  return found
}

/** The repo and its state folder, looked up once; undefined outside a git repository. */
async function findRepo($: $): Promise<Repo | undefined> {
  if (repoCache === undefined) {
    try {
      const top = await git($, ['rev-parse', '--show-toplevel'])
      const common = await git($, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
      repoCache = { top, dir: `${common}/orchestra` }
    } catch {
      repoCache = null
    }
  }

  return repoCache ?? undefined
}

/**
 * The tracker's issues. The GitHub and Jira ones are fetched when `isFresh`,
 * when the tracker changed, or once the last fetch is a minute old: the
 * board's timer runs every few seconds.
 */
async function loadIssues($: $, top: string, isFresh: boolean): Promise<Loaded> {
  const tracker = await trackerOf($, top)
  if (tracker.kind === 'local') return { tracker, ...(await loadScratch($, top)) }

  const now = await $.clock.now()
  const key = JSON.stringify(tracker)
  if (isFresh || fetched === undefined || fetched.key !== key || now - fetched.at >= REMOTE_TTL_MS) {
    const issues =
      tracker.kind === 'github'
        ? fetchGithub($, top).then(nodes => githubIssues(nodes, tracker.labels))
        : fetchJira($, tracker).then(nodes => jiraIssues(nodes, tracker.labels))
    fetched = { at: now, key, issues }
  }

  return { tracker, ...(await fetched.issues) }
}

/**
 * The tracker docs/agents/issue-tracker.md names, with docs/agents/triage-labels.md's
 * labels; for Jira also its site, project and epics, and the Atlassian MCP server.
 */
async function trackerOf($: $, top: string): Promise<Tracker> {
  const doc = await readText($, `${top}/docs/agents/issue-tracker.md`)
  const isGithub = namesGithub(doc)
  if (!isGithub && !namesJira(doc)) return { kind: 'local' }
  const labels = triageLabels(await readText($, `${top}/docs/agents/triage-labels.md`))
  if (isGithub) return { kind: 'github', labels }

  const scope = jiraScope(doc ?? '')
  const server = scope.server ?? atlassianServer((await $.tool.list()).map(tool => tool.name))
  if (server === undefined) {
    throw new Error(
      `this session has no Atlassian MCP server, which orchestra reads Jira through: connect one (https://mcp.atlassian.com/v1/mcp), or name yours in docs/agents/issue-tracker.md with a line "MCP server: <name>"`,
    )
  }

  return { kind: 'jira', labels, ...scope, server }
}

/** The open issues, page by page, and the ones closed last. */
async function fetchGithub($: $, top: string): Promise<Node[]> {
  const nodes: Node[] = []
  let after: string | null = null
  for (let page = 0; page < PAGES; page += 1) {
    const args = ['-F', 'owner={owner}', '-F', 'repo={repo}', '-F', `withClosed=${page === 0}`, '-f', `query=${QUERY}`]
    if (after !== null) args.push('-f', `after=${after}`)
    const ran = await $.process.run(['gh', 'api', 'graphql', ...args], { cwd: top })
    if (ran.exitCode !== 0) throw new Error(`gh couldn't read the GitHub issues: ${ran.stderr.trim()}`)
    const { open, closed } = (JSON.parse(ran.stdout) as Page).data.repository
    nodes.push(...open.nodes, ...(closed?.nodes ?? []))
    if (!open.pageInfo.hasNextPage) break
    after = open.pageInfo.endCursor
  }

  return nodes
}

/** The stories the scope names, page by page, through the Atlassian MCP server. */
async function fetchJira($: $, tracker: Extract<Tracker, { kind: 'jira' }>): Promise<JiraNode[]> {
  const nodes: JiraNode[] = []
  const search = { cloudId: tracker.site, jql: jql(tracker, tracker.labels), fields: FIELDS, maxResults: 100 }
  let nextPageToken: string | undefined
  for (let page = 0; page < PAGES; page += 1) {
    const args = nextPageToken === undefined ? search : { ...search, nextPageToken }
    const found = searchPage(await $.mcp.call(tracker.server, SEARCH_TOOL, args))
    nodes.push(...found.issues)
    if (found.isLast === true || found.nextPageToken === undefined) break
    nextPageToken = found.nextPageToken
  }

  return nodes
}

async function loadScratch($: $, top: string): Promise<Issues> {
  const issues: Issue[] = []
  const changedAt = new Map<string, number>()
  const root = `${top}/.scratch`
  if (!(await $.fs.exists(root))) return { issues, changedAt }

  for (const feature of await $.fs.list(root)) {
    const dir = `${root}/${feature.name}/issues`
    if (feature.kind !== 'dir' || !(await $.fs.exists(dir))) continue
    for (const file of await $.fs.list(dir)) {
      if (file.kind !== 'file' || !file.name.endsWith('.md')) continue
      const path = `.scratch/${feature.name}/issues/${file.name}`
      issues.push(parseIssue(path, await $.fs.read(`${top}/${path}`)))
      changedAt.set(path, file.mtimeMs)
    }
  }

  return { issues, changedAt }
}

async function loadJobs($: $, dir: string): Promise<Job[]> {
  if (!(await $.fs.exists(dir))) return []
  const jobs: Job[] = []
  for (const entry of await $.fs.list(dir)) {
    if (!entry.name.endsWith('.job.json')) continue
    const job = await readJson<Job>($, `${dir}/${entry.name}`)
    if (job !== undefined) jobs.push(job)
  }

  return jobs.sort((a, b) => a.startedAt - b.startedAt)
}

/** The issues, judged with every job's hold applied; `isFresh` fetches GitHub's anew. */
async function candidates(
  $: $,
  where: Repo,
  isFresh: boolean,
): Promise<{ list: Candidate[]; jobs: Job[]; tracker: Tracker }> {
  const { tracker, issues, changedAt } = await loadIssues($, where.top, isFresh)
  const jobs = await loadJobs($, where.dir)

  return { list: plan(issues, holds(jobs, changedAt)), jobs, tracker }
}

function readWorkerOf($: $, dir: string, job: Job): Promise<WorkerState | undefined> {
  return readJson<WorkerState>($, `${dir}/${job.id}.worker.json`)
}

/** Marks the job finished (or its late report delivered), and writes what the orchestrator's model reads. */
async function deliver($: $, where: Repo, job: Job, settled: Settled, lateFrom?: string): Promise<Answer> {
  const now = await $.clock.now()
  const patch: Partial<Job> =
    lateFrom === undefined ? { finishedAt: now, outcome: settled.outcome } : { lateDeliveredAt: now }
  await writeJson($, `${where.dir}/${job.id}.job.json`, { ...job, ...patch })
  if (lateFrom === undefined) void $.ui.notify(`${job.slug}: ${settled.outcome}`, { title: 'orchestra' })

  const commits = await git($, ['log', '--oneline', `${job.baseHead}..HEAD`], where.top).catch(() => '')
  const dirty = await git($, ['status', '--porcelain'], where.top).catch(() => '')
  const { list } = await candidates($, where, true)
  const issue = list.find(one => one.path === job.issue)
  const next = list.find(one => one.canStart)
  const ended = lateFrom === undefined ? now : (job.late?.at ?? now)
  const report: OrchestraReport = {
    slug: job.slug,
    job: job.id,
    outcome: settled.outcome,
    ...(lateFrom === undefined ? {} : { lateFrom }),
    minutes: Math.round((ended - job.startedAt) / 60_000),
    summary: settled.summary,
    commits: lines(commits),
    issue: issue === undefined ? 'gone' : describe(issue),
    dirty: lines(dirty),
    ...(next === undefined ? {} : { next: next.ref }),
  }
  void refresh($)

  const head =
    lateFrom === undefined
      ? `[orchestra] ${job.slug}: ${settled.outcome} after ${report.minutes} min (job ${job.id})`
      : `[orchestra] Late report: ${job.slug} reported ${settled.outcome} after it was marked ${lateFrom} (job ${job.id})`
  const text = [
    head,
    ...(settled.summary === '' ? [] : ['', settled.summary]),
    '',
    `Commits since dispatch: ${commits === '' ? 'none' : `\n${commits}`}`,
    `Issue: ${report.issue}`,
    `Working tree: ${dirty === '' ? 'clean' : `uncommitted changes\n${dirty}`}`,
    `Next: ${next === undefined ? 'no issue can start (mcp__orchestra__issues says why)' : `${next.ref} can start`}`,
  ].join('\n')

  return { text, shown: { kind: 'report', report } }
}

async function dispatch($: $, options: PluginOptions, ref: string | undefined, isForced: boolean): Promise<Answer> {
  const where = await repo($)
  const { list, jobs, tracker } = await candidates($, where, true)
  const running = jobs.find(job => job.finishedAt === undefined)
  if (running !== undefined) {
    return { text: `A worker already runs ${running.slug} (job ${running.id}). Call mcp__orchestra__wait for it first.` }
  }

  let pick: Candidate | undefined
  if (ref === undefined) {
    pick = list.find(one => one.canStart)
    if (pick === undefined) return { text: `No issue can start.\n\n${table(list)}` }
  } else {
    const found = findIssues(list, ref)
    if (found.length !== 1) {
      return {
        text:
          found.length === 0
            ? `No issue matches "${ref}".`
            : `"${ref}" matches ${found.map(one => one.path).join(', ')}. Name one.`,
      }
    }
    pick = found[0]!
    if (!pick.canStart && !isForced) return { text: `${pick.slug} can't start: ${pick.reason}. Force it to start anyway.` }
  }

  const dirty = await git($, ['status', '--porcelain'], where.top)
  if (dirty !== '' && !isForced) {
    return {
      text: `The working tree has uncommitted changes, which the worker would commit with its own:\n${dirty}\nCommit or stash them first, or force it.`,
    }
  }

  const now = await $.clock.now()
  // A file name: GitHub's `#12` loses its `#`, and an issue without a feature its part.
  const id = [pick.feature, pick.number, now.toString(36)]
    .map(part => part.replace(/[^\w.-]+/g, ''))
    .filter(part => part !== '')
    .join('-')
  const briefFile = `${where.dir}/${id}.brief.md`
  const jobFile = `${where.dir}/${id}.job.json`
  await $.fs.write(briefFile, brief(pick, id, tracker))
  const job: Job = {
    id,
    issue: pick.path,
    slug: pick.slug,
    title: pick.title,
    session: await $.session.id(),
    baseHead: await git($, ['rev-parse', 'HEAD'], where.top),
    tab: '',
    startedAt: now,
  }
  await writeJson($, jobFile, job)

  const line = commandLine({
    permissionMode: text(options, 'permissionMode', 'auto'),
    model: text(options, 'model', ''),
    name: `orchestra: ${pick.slug}`,
    briefFile,
    prompt: workerPrompt(text(options, 'workerPrompt', '/mattpocock-skills:implement {issue}'), pick.path),
  })
  const opened = await $.process.run(
    [
      'osascript',
      '-',
      where.top,
      `${line}; unset ORCHESTRA_JOB ORCHESTRA_DIR`,
      (await read($, homeAtom)) ?? '',
      await $.session.cwd(),
      jobs.map(one => one.tab).filter(tab => tab !== '').join(','),
      `ORCHESTRA_JOB=${id}`,
      `ORCHESTRA_DIR=${where.dir}`,
    ],
    { stdin: OPEN_TAB },
  )
  if (opened.exitCode !== 0) {
    await writeJson($, jobFile, { ...job, finishedAt: now, outcome: 'not-launched' })
    return { text: `Ghostty didn't open the tab: ${opened.stderr.trim()}` }
  }

  await writeJson($, jobFile, { ...job, tab: opened.stdout.trim() })
  void refresh($)

  return {
    text: `Started a worker for ${pick.path} (${pick.title}) in a new Ghostty tab, job ${id}. Call mcp__orchestra__wait to block until it reports.`,
    shown: { kind: 'started', job: id, slug: pick.slug, title: pick.title, path: pick.path },
  }
}

/** Blocks until a worker finishes, or a late report of this session's is due, for `minutes` at most. */
async function wait($: $, minutes: number, signal: AbortSignal): Promise<Answer> {
  const where = await repo($)
  const session = await $.session.id()
  const startedAt = await $.clock.now()

  for (;;) {
    const now = await $.clock.now()
    const jobs = await loadJobs($, where.dir)
    const late = jobs.find(job => job.session === session && job.late !== undefined && job.lateDeliveredAt === undefined)
    if (late?.late !== undefined) return deliver($, where, late, late.late, late.outcome ?? 'unknown')
    const open = jobs.filter(job => job.finishedAt === undefined)
    const first = open[0]
    if (first === undefined) return { text: 'No orchestra worker is running. Call mcp__orchestra__dispatch to start one.' }
    for (const job of open) {
      const settled = settle(job, await readWorkerOf($, where.dir, job), now)
      if (settled !== undefined) return deliver($, where, job, settled)
    }
    if (signal.aborted) return { text: 'Stopped waiting.' }
    if (now - startedAt >= minutes * 60_000) {
      const since = Math.round((now - first.startedAt) / 60_000)
      return {
        text: `Still running: ${first.slug}, ${since} min since dispatch. Call mcp__orchestra__wait again.`,
        shown: { kind: 'running', slug: first.slug, minutes: since },
      }
    }
    // A `$` call's time is not the hook's own, so a long wait stays inside its budget.
    await $.process.run(['sleep', String(WAIT_STEP_SECONDS)])
  }
}

/** Rebuilds the board; a call while one runs shares it, so no late report is recorded twice. */
function refresh($: $): Promise<void> {
  refreshing ??= rebuild($).finally(() => {
    refreshing = undefined
  })

  return refreshing
}

/**
 * Reads the files: records each late report on its job, then writes the
 * board the drawings read, and the status line.
 */
async function rebuild($: $): Promise<void> {
  const where = await findRepo($)
  if (where === undefined) return
  const now = await $.clock.now()
  const session = await $.session.id()
  const jobs = await loadJobs($, where.dir)
  // The band and the jobs still draw while the issues can't be read (gh offline, say).
  const loaded = await loadIssues($, where.top, false).catch((error: unknown) => new Error(message(error)))
  const list = loaded instanceof Error ? [] : plan(loaded.issues, holds(jobs, loaded.changedAt))

  const workers = new Map<string, WorkerState>()
  for (const [index, job] of jobs.entries()) {
    const isRecent = index >= jobs.length - 5
    const mayReportLate = job.finishedAt !== undefined && job.late === undefined && now - job.finishedAt < LATE_WINDOW_MS
    if (job.finishedAt !== undefined && !isRecent && !mayReportLate) continue
    const state = await readWorkerOf($, where.dir, job)
    if (state !== undefined) workers.set(job.id, state)

    const late = lateReport(job, state)
    if (late === undefined) continue
    job.late = late
    await writeJson($, `${where.dir}/${job.id}.job.json`, job)
    if (job.session === session) {
      void $.ui.notify(`${job.slug}: reported ${late.outcome} after it was marked ${job.outcome}`, { title: 'orchestra' })
    }
  }

  const drawn: OrchestraBoard = {
    ...board({ list, jobs, workers, session, now }),
    ...(loaded instanceof Error ? { problem: loaded.message } : { tracker: loaded.tracker.kind }),
  }
  const json = JSON.stringify(drawn)
  if (json !== shownBoard) {
    shownBoard = json
    await update($, boardAtom, () => drawn)
  }

  animate($, drawn.running !== undefined)
}

/** Starts or stops the timer that turns the band's mark. */
function animate($: $, isOn: boolean): void {
  if (isOn && animation === undefined) animation = $.clock.every(FRAME_MS, () => void paint($))
  if (!isOn && animation !== undefined) {
    animation.cancel()
    animation = undefined
  }
}

/** Repaints the mark in the band, if the band draws it; a band not mounted yet, or collapsed, refuses. */
async function paint($: $): Promise<void> {
  const site = bandSite
  if (site === undefined) return
  const cells = markCells(frameAt(await $.clock.now()), palette)
  await $.ui.blit({ requestId: site, key: MARK_KEY, cells }).catch(() => undefined)
}

/**
 * Remembers the Ghostty terminal the person has focused when it is in this
 * session's directory: theirs, as they just typed here. A worker's tab opens
 * in its window. Only in a repo with issues, since every session that is no
 * worker is an orchestrator.
 */
async function locate($: $): Promise<void> {
  try {
    if ((await $.env.get('TERM_PROGRAM')) !== 'ghostty') return
    if (((await read($, boardAtom))?.issues.length ?? 0) === 0) return
    const ran = await $.process.run(['osascript', '-'], { stdin: FRONT_TERMINAL })
    const [id = '', dir = ''] = ran.stdout.trim().split('\n')
    if (ran.exitCode === 0 && id !== '' && sameDir(dir, await $.session.cwd())) await update($, homeAtom, () => id)
  } catch (error) {
    $.ui.log(`orchestra: ${message(error)}`, { to: 'debug' })
  }
}

function sameDir(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
}

/** The timer: the board, and a wake-up when this session's worker finished while it sat idle. */
async function tick($: $): Promise<void> {
  if (isTicking) return
  isTicking = true
  try {
    await refresh($)
    // A running turn takes the report through `wait` itself.
    if (waits > 0 || isTurnRunning) return

    const where = await findRepo($)
    if (where === undefined) return
    const now = await $.clock.now()
    const session = await $.session.id()
    for (const job of await loadJobs($, where.dir)) {
      if (job.session !== session || job.finishedAt !== undefined) continue
      const settled = settle(job, await readWorkerOf($, where.dir, job), now)
      if (settled === undefined) continue
      const { text } = await deliver($, where, job, settled)
      void $.prompt.submit({
        text: `${text}\n\nCheck the worker's commits, then dispatch the next issue, or stop and tell the person what needs them.`,
      })
    }
  } catch (error) {
    $.ui.log(`orchestra: ${message(error)}`, { to: 'debug' })
  } finally {
    isTicking = false
  }
}

// ── The buttons ─────────────────────────────────────────────────────────

/** What the drawings' buttons do; each says how it went in a toast. */
function handlers($: $, options: PluginOptions): Handlers {
  return {
    dispatch: path => void toast($, locate($).then(() => dispatchLine($, options, path))),
    focus: tab => void toast($, focusTab($, tab)),
    abandon: id => void toast($, abandon($, id)),
    release: id => void toast($, release($, id)),
    board: () => void $.ui.open({ id: PANE, title: 'orchestra' }),
  }
}

async function dispatchLine($: $, options: PluginOptions, path: string | undefined): Promise<string> {
  const { text } = await dispatch($, options, path, false)

  return text.split('\n')[0] ?? ''
}

async function focusTab($: $, tab: string): Promise<string> {
  const ran = await $.process.run(['osascript', '-', tab], { stdin: FOCUS_TAB })
  if (ran.exitCode !== 0) return `Ghostty didn't focus the tab: ${ran.stderr.trim()}`

  return ran.stdout.trim() === 'gone' ? 'The worker tab is closed.' : 'Focused the worker tab.'
}

/** Stops tracking a running job: its issue is held, and a report it sends later counts as late. */
async function abandon($: $, id: string): Promise<string> {
  const { path, job } = await jobOf($, id)
  if (job.finishedAt !== undefined) return `${job.slug} already finished.`
  await writeJson($, path, { ...job, finishedAt: await $.clock.now(), outcome: 'abandoned' })
  await refresh($)

  return `Stopped tracking ${job.slug}. Its Ghostty tab still runs: close it there.`
}

/** Lets a held issue go without an edit to its file. */
async function release($: $, id: string): Promise<string> {
  const { path, job } = await jobOf($, id)
  await writeJson($, path, { ...job, releasedAt: await $.clock.now() })
  await refresh($)

  return `Released ${job.slug}: dispatch may take it again.`
}

async function jobOf($: $, id: string): Promise<{ path: string; job: Job }> {
  const where = await repo($)
  const path = `${where.dir}/${id}.job.json`
  const job = await readJson<Job>($, path)
  if (job === undefined) throw new Error(`job ${id} is gone`)

  return { path, job }
}

async function toast($: $, line: Promise<string>): Promise<void> {
  try {
    $.ui.toast(await line)
  } catch (error) {
    $.ui.toast(`orchestra: ${message(error)}`)
  }
}

// ── Shared ──────────────────────────────────────────────────────────────

/** Answers a tool call: keeps what its row draws, returns what the model reads. */
async function answer($: $, toolUseId: string, given: Answer): Promise<{ result: string }> {
  if (given.shown !== undefined) await $.state.set({ ...SHOWN, id: toolUseId }, given.shown)

  return { result: given.text }
}

async function git($: $, args: readonly string[], cwd?: string): Promise<string> {
  const ran = await $.process.run(['git', ...args], cwd === undefined ? undefined : { cwd })
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${ran.stderr.trim()}`)

  return ran.stdout.trim()
}

async function readText($: $, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

async function readJson<T>($: $, path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await $.fs.read(path)) as T
  } catch {
    return undefined
  }
}

async function writeJson($: $, path: string, value: unknown): Promise<void> {
  await $.fs.write(path, `${JSON.stringify(value, null, 2)}\n`)
}

function lines(output: string): string[] {
  return output === '' ? [] : output.split('\n')
}

function text(options: PluginOptions, key: string, fallback: string): string {
  const value = options[key]

  return typeof value === 'string' ? value : fallback
}

/** A tool hook's failure, as the model reads it. */
function failure(error: HookFailure): string {
  return `orchestra: the tool ${error.kind === 'timeout' ? 'ran out of time' : 'failed'}${error.message === undefined ? '' : `: ${error.message}`}`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
