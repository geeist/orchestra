import { describe, expect, test } from 'claude-code/testing'

import { board, describeCall, holds, lateReport, settle } from './board'
import type { Job, WorkerState } from './board'
import { parseIssue, plan } from './scratch'

const MIN = 60_000

const job = (patch: Partial<Job> = {}): Job => ({
  id: 'local-stack-06-x',
  issue: '.scratch/local-stack/issues/06-thing.md',
  slug: '06-thing',
  title: '06: Thing',
  session: 'me',
  baseHead: 'abc',
  tab: 'tab-1',
  startedAt: 0,
  ...patch,
})

const worker = (patch: Partial<WorkerState> = {}): WorkerState => ({ state: 'running', updatedAt: 0, ...patch })

describe('settle', () => {
  test('a worker that has not started yet is given three minutes', () => {
    expect(settle(job(), undefined, 2 * MIN)).toBeUndefined()
    expect(settle(job(), undefined, 4 * MIN)?.outcome).toBe('never-started')
  })

  test('a running worker is not settled, a reported one is', () => {
    expect(settle(job(), worker(), 30 * MIN)).toBeUndefined()
    expect(settle(job(), worker({ state: 'reported', outcome: 'blocked', summary: 'why' }), MIN)).toEqual({
      outcome: 'blocked',
      summary: 'why',
    })
  })
})

describe('lateReport', () => {
  const stalled = job({ finishedAt: 10 * MIN, outcome: 'stalled' })

  test('a report after a stall is late', () => {
    const late = lateReport(stalled, worker({ state: 'reported', outcome: 'done', summary: 'ok', updatedAt: 20 * MIN }))

    expect(late).toEqual({ outcome: 'done', summary: 'ok', at: 20 * MIN })
  })

  test('nothing is late while the job runs, once it is recorded, or after a real report', () => {
    const reported = worker({ state: 'reported', outcome: 'done' })

    expect(lateReport(job(), reported)).toBeUndefined()
    expect(lateReport({ ...stalled, late: { outcome: 'done', summary: '', at: 1 } }, reported)).toBeUndefined()
    expect(lateReport(job({ finishedAt: 1, outcome: 'done' }), reported)).toBeUndefined()
    expect(lateReport(stalled, worker({ state: 'stalled' }))).toBeUndefined()
  })
})

describe('holds', () => {
  const path = job().issue
  const unchanged = new Map([[path, 5 * MIN]])

  test('a finished job holds its issue until the file changes', () => {
    expect(holds([job({ finishedAt: 10 * MIN, outcome: 'stalled' })], unchanged).get(path)).toContain('ended stalled')
    expect(holds([job({ finishedAt: 10 * MIN, outcome: 'stalled' })], new Map([[path, 11 * MIN]])).has(path)).toBe(
      false,
    )
  })

  test('a late report names what the worker really came to', () => {
    const late = job({ finishedAt: 10 * MIN, outcome: 'stalled', late: { outcome: 'done', summary: '', at: 1 } })

    expect(holds([late], unchanged).get(path)).toContain('ended done')
  })

  test('a released job holds nothing', () => {
    expect(holds([job({ finishedAt: 10 * MIN, outcome: 'failed', releasedAt: 12 * MIN })], unchanged).has(path)).toBe(
      false,
    )
  })
})

describe('board', () => {
  const issue = (number: string, status: string, blockedBy = 'None') =>
    parseIssue(
      `.scratch/local-stack/issues/${number}-thing.md`,
      `# ${number}: Thing\n\n**Blocked by:** ${blockedBy}\n\n**Status:** ${status}\n\n- [ ] one\n`,
    )

  test('gives each issue its tone and the running job its heartbeat', () => {
    const running = job({ issue: '.scratch/local-stack/issues/02-thing.md', slug: '02-thing', startedAt: 0 })
    const finished = job({
      id: 'local-stack-03-y',
      issue: '.scratch/local-stack/issues/03-thing.md',
      slug: '03-thing',
      startedAt: 0,
      finishedAt: MIN,
      outcome: 'failed',
    })
    const jobs = [finished, running]
    const issues = [issue('01', 'done'), issue('02', 'ready-for-agent'), issue('03', 'ready-for-agent'), issue('04', 'ready-for-agent', '01'), issue('05', 'needs-info')]
    const list = plan(issues, holds(jobs, new Map()))
    const workers = new Map([[running.id, worker({ activity: 'Edit hooks/ui.tsx', activityAt: 4 * MIN, tools: 7 })]])

    const drawn = board({ list, jobs, workers, session: 'me', now: 5 * MIN + 1_000 })

    expect(drawn.issues.map(one => one.tone)).toEqual(['done', 'running', 'held', 'ready', 'waiting'])
    expect(drawn.issues[2]?.heldBy).toBe('local-stack-03-y')
    expect(drawn.next).toBe('.scratch/local-stack/issues/04-thing.md')
    expect(drawn.running).toMatchObject({
      slug: '02-thing',
      minutes: 5,
      phase: 'running',
      activity: 'Edit hooks/ui.tsx',
      activityAgo: 60,
      tools: 7,
      isMine: true,
    })
    expect(drawn.recent.map(one => one.outcome)).toEqual(['failed'])
  })

  test('a job with no worker file yet is starting', () => {
    const drawn = board({ list: [], jobs: [job()], workers: new Map(), session: 'other', now: MIN })

    expect(drawn.running).toMatchObject({ phase: 'starting', isMine: false })
  })
})

describe('describeCall', () => {
  test('names the tool and what it works on', () => {
    expect(describeCall({ tool: 'Edit', file_path: '/repo/hooks/register.tsx' })).toBe('Edit hooks/register.tsx')
    expect(describeCall({ tool: 'Bash', command: 'task test', description: 'Run the tests' })).toBe('Bash Run the tests')
    expect(describeCall({ tool: 'Agent', description: 'Spec review', agentId: 'a1' })).toBe('agent: Agent Spec review')
    expect(describeCall({ tool: 'mcp__orchestra__report' })).toBe('orchestra report')
  })
})
