import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { OrchestraBoard } from '../types'
import type { Job, WorkerState } from './board'

// The wait tool, over a repo held in memory. The test's hooks stand for the
// engine: `fs.*` the files, `process.run` git, gh and the poll's sleep,
// `clock.now` a clock each read moves on ten seconds, and `ui.notify` an
// engine that raises no notification. The board a delivery rebuilds as it
// returns is awaited, so none of its work outlives the test.

const DIR = '/repo/.git/orchestra'
const MIN = 60_000

const JOB: Job = {
  id: 's-06-x',
  issue: '.scratch/s/issues/06-thing.md',
  slug: '06-thing',
  title: '06: Thing',
  session: 'me',
  baseHead: 'abc',
  tab: 'tab-1',
  startedAt: 0,
}

const REPORTED: WorkerState = { state: 'reported', outcome: 'done', summary: 'Built it.', updatedAt: 20 * MIN }

type Engine = { files: Map<string, string>; toasts: string[]; board: Promise<OrchestraBoard | null> }

function engine(on: On, files: Record<string, string>, gh = { exitCode: 0, stderr: '' }): Engine {
  let drawn: (board: OrchestraBoard | null) => void = () => undefined
  const board = new Promise<OrchestraBoard | null>(resolve => {
    drawn = resolve
  })
  const held: Engine = { files: new Map(Object.entries(files)), toasts: [], board }
  let now = 30 * MIN
  const ran = (stdout: string, exitCode = 0, stderr = '') => ({
    value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
  })
  const under = (path: string) => [...held.files.keys()].filter(key => key.startsWith(`${path}/`))

  on('clock.now', () => ({ value: (now += 10_000) }))
  on('session.id', () => ({ value: 'me' }))
  on('fs.read', ($, e) => {
    const text = held.files.get(e.path)
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    held.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: held.files.has(e.path) || under(e.path).length > 0 }))
  on('fs.list', ($, e) => ({
    value: under(e.path).map(key => ({ name: key.slice(e.path.length + 1), kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('process.run', ($, e) => {
    const line = e.argv.join(' ')
    if (line === 'git rev-parse --show-toplevel') return ran('/repo\n')
    if (line.startsWith('git rev-parse --path-format=absolute')) return ran('/repo/.git\n')
    if (line.startsWith('git log')) return ran('913317e Add thing\n')
    if (e.argv[0] === 'gh') return ran('', gh.exitCode, gh.stderr)
    return ran('')
  })
  on('ui.notify', () => ({ deny: 'this engine raises no notification' }))
  on('state.set', { plugin: 'orchestra', key: 'board' }, async ($, e, next) => {
    const set = await next(e)
    drawn(e.value)
    return set
  })
  on('ui.toast', ($, e) => {
    held.toasts.push(e.text)
    return { value: undefined }
  })

  return held
}

const json = (value: unknown) => `${JSON.stringify(value)}\n`

describe('wait', () => {
  test('delivers the report although no notification is raised, and toasts it instead', async ($, on) => {
    const held = engine(on, { [`${DIR}/s-06-x.job.json`]: json(JOB), [`${DIR}/s-06-x.worker.json`]: json(REPORTED) })

    const { result, deny } = await $.tool.call({ tool: 'mcp__orchestra__wait', minutes: 1 })

    expect(deny).toBeUndefined()
    expect(result).toContain('[orchestra] 06-thing: done after')
    expect(result).toContain('913317e Add thing')
    expect(held.toasts).toEqual(['06-thing: done'])
    expect(JSON.parse(held.files.get(`${DIR}/s-06-x.job.json`)!).outcome).toBe('done')
    expect((await held.board)?.recent[0]?.outcome).toBe('done')
  })

  test('delivers the report although the tracker cannot be read', async ($, on) => {
    const held = engine(
      on,
      {
        '/repo/docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n',
        [`${DIR}/s-06-x.job.json`]: json(JOB),
        [`${DIR}/s-06-x.worker.json`]: json(REPORTED),
      },
      { exitCode: 1, stderr: 'offline' },
    )

    const { result, deny } = await $.tool.call({ tool: 'mcp__orchestra__wait', minutes: 1 })

    expect(deny).toBeUndefined()
    expect(result).toContain('[orchestra] 06-thing: done after')
    expect(result).toContain("Issue: unread: gh couldn't read the GitHub issues: offline")
    expect(held.files.get(`${DIR}/s-06-x.job.json`)).toContain('"finishedAt"')
    expect((await held.board)?.problem).toContain('offline')
  })

  test('a worker file caught mid-write is a running worker, not one that never started', async ($, on) => {
    engine(on, { [`${DIR}/s-06-x.job.json`]: json(JOB), [`${DIR}/s-06-x.worker.json`]: '' })

    const { result } = await $.tool.call({ tool: 'mcp__orchestra__wait', minutes: 1 })

    expect(result).toContain('Still running: 06-thing')
  })
})
