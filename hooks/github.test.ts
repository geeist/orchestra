import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { githubIssues, namesGithub, triageLabels } from './github'
import type { Node, Page } from './github'
import { findIssues, plan } from './scratch'
import { brief } from './text'

const node = (number: number, extra: Partial<Node> = {}): Node => ({
  number,
  title: `Issue ${number}`,
  body: '',
  state: 'OPEN',
  updatedAt: '2026-10-01T10:00:00Z',
  labels: { nodes: [] },
  parent: null,
  subIssuesSummary: { total: 0 },
  blockedBy: { nodes: [] },
  ...extra,
})

const labelled = (...names: string[]) => ({ labels: { nodes: names.map(name => ({ name })) } })
const childOf = (parent: number) => ({ parent: { number: parent, title: `Spec ${parent}` } })
const ready = labelled('ready-for-agent')

// #10 is a spec with native sub-issues, #20 one its tickets name in their
// bodies only (to-tickets without sub-issues), #30 to #32 have no parent.
const NODES: Node[] = [
  node(10, { ...ready, subIssuesSummary: { total: 4 } }),
  node(11, { ...ready, ...childOf(10), state: 'CLOSED' }),
  node(12, { ...ready, ...childOf(10), blockedBy: { nodes: [{ number: 11, state: 'CLOSED' }] } }),
  node(13, { ...labelled('ready-for-agent', 'needs-info'), ...childOf(10) }),
  node(14, { ...ready, ...childOf(10), body: '## What to build\n\nIt.\n\n## Blocked by\n\n- #12\n- #9\n' }),
  node(20, { ...ready, title: 'Search' }),
  node(21, {
    ...ready,
    body: '## Parent\r\n\r\n#20\r\n\r\n## Blocked by\r\n\r\n- None (can start immediately)\r\n',
    updatedAt: '2026-10-02T08:30:00Z',
  }),
  node(30, ready),
  node(31),
  node(32, labelled('needs-triage')),
]

describe('namesGithub', () => {
  test('reads the heading /setup-matt-pocock-skills writes', () => {
    expect(namesGithub('# Issue tracker: GitHub\n\nIssues and specs for this repo live as GitHub issues.')).toBe(true)
    expect(namesGithub('# Issue tracker: Local Markdown\n\nNot GitHub.')).toBe(false)
    expect(namesGithub(undefined)).toBe(false)
  })
})

describe('triageLabels', () => {
  test("each role's own name, or the label the table maps it to", () => {
    const labels = triageLabels(
      '| Label in mattpocock/skills | Label in our tracker | Meaning |\n' +
        '| --- | --- | --- |\n' +
        '| `ready-for-agent` | `agent:ready` | Fully specified |\n' +
        '| `needs-info` | `needs-info` | Waiting |\n',
    )

    expect(labels['ready-for-agent']).toBe('agent:ready')
    expect(labels['needs-info']).toBe('needs-info')
    expect(triageLabels(undefined)['ready-for-human']).toBe('ready-for-human')
  })
})

describe('githubIssues', () => {
  const { issues, changedAt } = githubIssues(NODES, triageLabels(undefined))
  const byPath = new Map(issues.map(issue => [issue.path, issue]))

  test('a parent is the feature of its tickets, and no ticket itself', () => {
    expect(byPath.has('#10')).toBe(false)
    expect(byPath.has('#20')).toBe(false)
    expect(byPath.get('#12')).toMatchObject({ feature: '#10', featureTitle: 'Spec 10', number: '12', slug: '#12' })
    expect(byPath.get('#21')).toMatchObject({ feature: '#20', featureTitle: 'Search', blockedBy: [] })
  })

  test('an issue without a parent counts once labelled for an agent', () => {
    expect(byPath.get('#30')?.feature).toBe('')
    expect(byPath.has('#31')).toBe(false)
    expect(byPath.has('#32')).toBe(false)
  })

  test('closed is done, and a label that holds the issue back wins', () => {
    expect(byPath.get('#11')).toMatchObject({ status: 'closed', isDone: true })
    expect(byPath.get('#13')?.status).toBe('needs-info')
  })

  test('only blockers still open block: native ones and the Blocked by section', () => {
    expect(byPath.get('#12')?.blockedBy).toEqual([])
    expect(byPath.get('#14')?.blockedBy).toEqual(['#12'])
  })

  test('the plan starts the features first, in number order', () => {
    const list = plan(issues)

    expect(list.map(one => one.path)).toEqual(['#11', '#12', '#13', '#14', '#21', '#30'])
    expect(list.map(one => one.reason)).toEqual([
      'done',
      'can start',
      'status is needs-info',
      'waits on #12',
      'can start',
      'can start',
    ])
  })

  test("a change on GitHub is the issue's change", () => {
    expect(changedAt.get('#21')).toBe(Date.parse('2026-10-02T08:30:00Z'))
  })

  test("the repo's own label names", () => {
    const labels = triageLabels('| `ready-for-agent` | `agent:ready` | Fully specified |')
    const mapped = githubIssues([node(40, labelled('agent:ready'))], labels).issues

    expect(mapped.map(one => one.status)).toEqual(['ready-for-agent'])
  })
})

describe('findIssues on GitHub', () => {
  const { issues } = githubIssues(NODES, triageLabels(undefined))

  test('by #number, number, link and feature/number', () => {
    for (const ref of ['#12', '12', 'https://github.com/o/r/issues/12', '#10/12', '10/#12']) {
      expect(findIssues(issues, ref).map(one => one.path)).toEqual(['#12'])
    }
  })

  test('another feature matches nothing', () => {
    expect(findIssues(issues, '#20/12')).toEqual([])
  })
})

describe('brief', () => {
  const issue = { path: '#13', number: '13', title: 'Login form', feature: '#10', featureTitle: 'Login' }

  test('on GitHub: gh, and the labels the repo uses', () => {
    const labels = triageLabels('| `ready-for-agent` | `agent:ready` | Fully specified |')
    const text = brief(issue, 'j', { kind: 'github', labels })

    expect(text).toContain('GitHub issue #13 (Login form), a ticket of #10 (Login)')
    expect(text).toContain('gh issue close 13')
    expect(text).toContain('gh issue edit 13 --remove-label agent:ready --add-label needs-info')
  })

  test('in .scratch: the Status line', () => {
    const text = brief({ ...issue, path: '.scratch/a/issues/03-b.md' }, 'j', { kind: 'local' })

    expect(text).toContain('- Issue: `.scratch/a/issues/03-b.md` (Login form)')
    expect(text).toContain('set its Status line to `done`')
  })
})

// The mod itself, started as an orchestrator in /repo, whose
// docs/agents/issue-tracker.md says GitHub. The test's hooks stand for the
// engine: `process.run` answers git, `gh` (with NODES) and osascript, and
// the files live in memory.
function world(on: On) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T00:00:00Z') })
  mock.env(on, {})
  const files: Record<string, string> = { '/repo/docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n' }
  const gh: string[][] = []
  const osascript: string[][] = []
  const page: Page = {
    data: { repository: { open: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: NODES } } },
  }
  const out = (stdout: string) => ({
    value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })

  on('process.run', ($, e) => {
    const [command, ...args] = e.argv
    if (command === 'gh') {
      gh.push([...args, `cwd=${e.init?.cwd ?? ''}`])
      return out(JSON.stringify(page))
    }
    if (command === 'osascript') {
      osascript.push([...args])
      return out('tab-1\n')
    }
    if (args.includes('--show-toplevel')) return out('/repo\n')
    if (args.includes('--git-common-dir')) return out('/repo/.git\n')
    if (args[0] === 'rev-parse') return out('abc123\n')
    return out('')
  })
  on('fs.exists', ($, e) => ({ value: e.path in files }))
  on('fs.read', ($, e) => (e.path in files ? { value: files[e.path]! } : { deny: 'no such file' }))
  on('fs.write', ($, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: Object.keys(files)
      .filter(path => path.startsWith(`${e.path}/`) && !path.slice(e.path.length + 1).includes('/'))
      .map(path => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('config.list', () => ({ value: [] }))
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('state.get', () => ({ value: { value: null, version: 0 } }) as never)
  on('state.set', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))

  return { clock, files, gh, osascript }
}

describe('the mod on GitHub', () => {
  test('the issues tool asks gh in the repo and lists the tickets', async ($, on) => {
    const { gh } = world(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })

    const answer = await $.tool.call({ tool: 'mcp__orchestra__issues', tool_use_id: 't1', feature: '10' } as never)

    expect(gh.at(-1)).toEqual(expect.arrayContaining(['graphql', 'owner={owner}', 'repo={repo}', 'cwd=/repo']))
    expect(answer).toEqual({
      result: [
        '#11: done. Issue 11',
        '#12: can start (next). Issue 12',
        '#13: status is needs-info. Issue 13',
        '#14: waits on #12. Issue 14',
      ].join('\n'),
    })
  })

  test("the board's timer asks gh once a minute, a tool call at once", async ($, on) => {
    const { clock, gh } = world(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await clock.settle()
    expect(gh.length).toBe(1)

    await clock.advance(30_000)
    expect(gh.length).toBe(1)

    await $.tool.call({ tool: 'mcp__orchestra__issues', tool_use_id: 't1' } as never)
    expect(gh.length).toBe(2)

    await clock.advance(61_000)
    expect(gh.length).toBe(3)
  })

  test('dispatch briefs the worker for GitHub and names the issue by its number', async ($, on) => {
    const { clock, files, osascript } = world(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })

    await $.tool.call({ tool: 'mcp__orchestra__dispatch', tool_use_id: 't1' } as never)
    // The board it refreshes on its way out.
    await clock.settle()

    const [, , typed = ''] = osascript.at(-1) ?? []
    expect(typed).toContain("'/mattpocock-skills:implement #12'")
    const briefs = Object.keys(files).filter(path => path.endsWith('.brief.md'))
    expect(briefs).toEqual([expect.stringMatching(/^\/repo\/\.git\/orchestra\/10-12-\w+\.brief\.md$/)])
    expect(files[briefs[0]!]).toContain('gh issue close 12')
  })
})
