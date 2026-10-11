import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { triageLabels } from './github'
import { atlassianServer, jiraIssues, jiraScope, jql, namesJira, searchPage } from './jira'
import type { Adf, JiraNode, JiraPage } from './jira'
import { findIssues, plan } from './scratch'
import { brief } from './text'

const story = (n: number, extra: Partial<JiraNode['fields']> = {}): JiraNode => ({
  key: `CORE-${n}`,
  fields: {
    summary: `Story ${n}`,
    description: null,
    status: { statusCategory: { key: 'new' } },
    labels: [],
    issuetype: { name: 'Story', subtask: false, hierarchyLevel: 0 },
    updated: '2026-10-01T10:00:00.000+0200',
    ...extra,
  },
})

const ready = { labels: ['ready-for-agent'] }
const done = { status: { statusCategory: { key: 'done' } } }
const inEpic = (n: number) => ({ parent: { key: `CORE-${n}`, fields: { summary: `Epic ${n}` } } })
const blockedBy = (n: number, category: string) => ({
  issuelinks: [
    {
      type: { name: 'Blocks', inward: 'is blocked by' },
      inwardIssue: { key: `CORE-${n}`, fields: { status: { statusCategory: { key: category } } } },
    },
  ],
})

/** A description as Jira's REST API sends it: a Blocked by section, and checkboxes. */
const ADF: Adf = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Blocked by' }] },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'CORE-12' }] }] },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'inlineCard', attrs: { url: 'https://quirion.atlassian.net/browse/CORE-9' } }],
            },
          ],
        },
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Acceptance criteria' }] },
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { state: 'DONE' }, content: [{ type: 'text', text: 'One' }] },
        { type: 'taskItem', attrs: { state: 'TODO' }, content: [{ type: 'text', text: 'Two' }] },
      ],
    },
  ],
}

// CORE-10 is an epic (the spec, labelled by /to-spec), 11 to 15 its stories,
// 16 a sub-task of 12, 20 a story without an epic.
const NODES: JiraNode[] = [
  story(10, { ...ready, summary: 'Login', issuetype: { name: 'Epic', hierarchyLevel: 1 } }),
  story(11, { ...ready, ...inEpic(10), ...done }),
  story(12, { ...ready, ...inEpic(10), ...blockedBy(11, 'done') }),
  story(13, { labels: ['ready-for-agent', 'needs-info'], ...inEpic(10) }),
  story(14, { ...ready, ...inEpic(10), description: ADF }),
  story(15, { ...ready, ...inEpic(10), ...blockedBy(13, 'indeterminate') }),
  story(16, { ...ready, parent: { key: 'CORE-12' }, issuetype: { name: 'Sub-task', subtask: true, hierarchyLevel: -1 } }),
  story(20, {
    ...ready,
    description: '## Blocked by\r\n\r\n- None (can start immediately)\r\n\r\n- [ ] It works\r\n',
    updated: '2026-10-02T08:30:00.000+0200',
  }),
]

describe('namesJira', () => {
  test('reads the heading of docs/agents/issue-tracker.md', () => {
    expect(namesJira('# Issue tracker: Jira\n\nStories live in Jira.')).toBe(true)
    expect(namesJira('# Issue tracker: GitHub\n\nNot Jira.')).toBe(false)
    expect(namesJira(undefined)).toBe(false)
  })
})

describe('jiraScope', () => {
  test('the Site, Project and Epic lines', () => {
    const doc = '# Issue tracker: Jira\n\nSite: https://quirion.atlassian.net/\nProject: `CORE` (Core banking)\nEpic: CORE-123\n'

    expect(jiraScope(doc)).toEqual({ site: 'quirion.atlassian.net', project: 'CORE', epics: ['CORE-123'] })
  })

  test("a link stands in for the site, and the first epic's project for the project", () => {
    const doc = '# Issue tracker: Jira\n\nSee https://acme.atlassian.net/browse/WEB-1.\n\n**Epics:** web-12, WEB-40\n'

    expect(jiraScope(doc)).toEqual({ site: 'acme.atlassian.net', project: 'WEB', epics: ['WEB-12', 'WEB-40'] })
  })

  test('the MCP server line names the server', () => {
    const doc = '# Issue tracker: Jira\n\nSite: acme.atlassian.net\nProject: WEB\nMCP server: claude.ai Atlassian\n'

    expect(jiraScope(doc).server).toBe('claude.ai Atlassian')
  })

  test('says what is missing', () => {
    expect(() => jiraScope('# Issue tracker: Jira\n\nProject: CORE\n')).toThrow('names no site')
    expect(() => jiraScope('# Issue tracker: Jira\n\nSite: acme.atlassian.net\n')).toThrow('names no project')
  })
})

describe('jql', () => {
  test("with epics, every story of theirs", () => {
    expect(jql({ project: 'CORE', epics: ['CORE-12', 'CORE-40'] }, triageLabels(undefined))).toBe(
      'parent in (CORE-12, CORE-40) ORDER BY key',
    )
  })

  test("without, the project's stories labelled for an agent, in the repo's own label names", () => {
    const labels = triageLabels('| `ready-for-agent` | `agent:ready` | Fully specified |')

    expect(jql({ project: 'CORE', epics: [] }, labels)).toBe(
      'project = "CORE" AND labels in ("agent:ready", "needs-info", "ready-for-human") ' +
        'AND (statusCategory != Done OR updated >= -30d) ORDER BY key',
    )
  })
})

describe('atlassianServer', () => {
  test("the server whose tools search Jira, in its tools' spelling", () => {
    const tools = ['Read', 'mcp__claude_ai_Atlassian__getJiraIssue', 'mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql']

    expect(atlassianServer(tools)).toBe('claude_ai_Atlassian')
    expect(atlassianServer(['Read', 'mcp__orchestra__issues'])).toBeUndefined()
  })
})

describe('searchPage', () => {
  const page: JiraPage = { issues: [story(1)], isLast: true }

  test('the JSON in the text, or the structured result', () => {
    expect(searchPage({ content: [{ type: 'text', text: JSON.stringify(page) }], isError: false })).toEqual(page)
    expect(searchPage({ content: [], isError: false, structuredContent: page })).toEqual(page)
    expect(
      searchPage({ content: [{ type: 'text', text: `Found 1 issue:\n${JSON.stringify(page)}` }], isError: false }),
    ).toEqual(page)
  })

  test("an error, or an answer it can't read, says so", () => {
    expect(() => searchPage({ content: [{ type: 'text', text: 'Unauthorized' }], isError: true })).toThrow(
      "couldn't search Jira: Unauthorized",
    )
    expect(() => searchPage({ content: [{ type: 'text', text: 'No issues.' }], isError: false })).toThrow(
      "a form orchestra doesn't read",
    )
  })
})

describe('jiraIssues', () => {
  const { issues, changedAt } = jiraIssues(NODES, triageLabels(undefined))
  const byPath = new Map(issues.map(issue => [issue.path, issue]))

  test('an epic is the feature of its stories, and no ticket itself', () => {
    expect(byPath.has('CORE-10')).toBe(false)
    expect(byPath.get('CORE-12')).toMatchObject({
      feature: 'CORE-10',
      featureTitle: 'Epic 10',
      number: '12',
      slug: 'CORE-12',
      ref: 'CORE-12',
    })
    expect(byPath.get('CORE-20')?.feature).toBe('')
  })

  test('a sub-task is no ticket, and leaves its story one', () => {
    expect(byPath.has('CORE-16')).toBe(false)
    expect(byPath.has('CORE-12')).toBe(true)
  })

  test('the Done category is done, and a label that holds the story back wins', () => {
    expect(byPath.get('CORE-11')).toMatchObject({ status: 'done', isDone: true })
    expect(byPath.get('CORE-13')?.status).toBe('needs-info')
  })

  test('only blockers not done block: links, and the Blocked by section of a description in ADF', () => {
    expect(byPath.get('CORE-12')?.blockedBy).toEqual([])
    expect(byPath.get('CORE-14')).toMatchObject({ blockedBy: ['CORE-12'], openBoxes: 1, doneBoxes: 1 })
    expect(byPath.get('CORE-15')?.blockedBy).toEqual(['CORE-13'])
    expect(byPath.get('CORE-20')).toMatchObject({ blockedBy: [], openBoxes: 1 })
  })

  test('the plan starts the epics first, in number order', () => {
    const list = plan(issues)

    expect(list.map(one => one.path)).toEqual(['CORE-11', 'CORE-12', 'CORE-13', 'CORE-14', 'CORE-15', 'CORE-20'])
    expect(list.map(one => one.reason)).toEqual([
      'done',
      'can start',
      'status is needs-info',
      'waits on CORE-12',
      'waits on CORE-13',
      'can start',
    ])
  })

  test("a change in Jira is the story's change", () => {
    expect(changedAt.get('CORE-20')).toBe(Date.parse('2026-10-02T06:30:00Z'))
  })
})

describe('findIssues in Jira', () => {
  const { issues } = jiraIssues(NODES, triageLabels(undefined))

  test('by key, number, link and epic/key', () => {
    for (const ref of ['CORE-12', 'core-12', '12', 'https://quirion.atlassian.net/browse/CORE-12', 'CORE-10/CORE-12']) {
      expect(findIssues(issues, ref).map(one => one.path)).toEqual(['CORE-12'])
    }
  })

  test('another epic matches nothing', () => {
    expect(findIssues(issues, 'CORE-20/CORE-12')).toEqual([])
  })
})

describe('brief in Jira', () => {
  test('the story, its epic, the server and the labels the repo uses', () => {
    const labels = triageLabels('| `ready-for-agent` | `agent:ready` | Fully specified |')
    const issue = { path: 'CORE-13', number: '13', title: 'Login form', feature: 'CORE-10', featureTitle: 'Login' }
    const jira = { site: 'quirion.atlassian.net', project: 'CORE', epics: [], server: 'claude.ai Atlassian' }
    const text = brief(issue, 'j', { kind: 'jira', labels, ...jira })

    expect(text).toContain('Jira story CORE-13 (Login form), a story of the epic CORE-10 (Login), on quirion.atlassian.net')
    expect(text).toContain('`mcp__claude_ai_Atlassian__…`')
    expect(text).toContain('move the story to a status in the Done category')
    expect(text).toContain('swap its label `agent:ready` for `needs-info`')
  })
})

// The mod itself, started as an orchestrator in /repo, whose
// docs/agents/issue-tracker.md says Jira. The test's hooks stand for the
// engine: `$.mcp.call` answers with NODES in two pages, `process.run`
// answers git and osascript, and the files live in memory.
function world(on: On, tools: string[] = ['mcp__atlassian__searchJiraIssuesUsingJql']) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T00:00:00Z') })
  mock.env(on, {})
  const files: Record<string, string> = {
    '/repo/docs/agents/issue-tracker.md': '# Issue tracker: Jira\n\nSite: quirion.atlassian.net\nProject: CORE\n',
  }
  const searches: { server: string; tool: string; args: Record<string, unknown> }[] = []
  const osascript: string[][] = []
  const out = (stdout: string) => ({
    value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })

  on('mcp.call', ($, e) => {
    searches.push(e)
    const page: JiraPage =
      e.args.nextPageToken === 'p2'
        ? { issues: NODES.slice(4), isLast: true }
        : { issues: NODES.slice(0, 4), nextPageToken: 'p2', isLast: false }
    return { value: { content: [{ type: 'text', text: JSON.stringify(page) }], isError: false } }
  })
  on('tool.list', () => ({ value: tools.map(name => ({ name, description: '', mcp: name.startsWith('mcp__') })) }))
  on('process.run', ($, e) => {
    const [command, ...args] = e.argv
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

  return { clock, files, searches, osascript }
}

describe('the mod on Jira', () => {
  test('the issues tool searches through the Atlassian server, page by page, and lists an epic', async ($, on) => {
    const { searches } = world(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })

    const answer = await $.tool.call({ tool: 'mcp__orchestra__issues', tool_use_id: 't1', feature: 'CORE-10' } as never)

    const [first, second] = searches.slice(-2)
    expect(first).toMatchObject({ server: 'atlassian', tool: 'searchJiraIssuesUsingJql' })
    expect(first?.args).toMatchObject({ cloudId: 'quirion.atlassian.net', maxResults: 100 })
    expect(String(first?.args.jql)).toContain('project = "CORE"')
    expect(second?.args.nextPageToken).toBe('p2')
    expect(answer).toEqual({
      result: [
        'CORE-11: done. Story 11',
        'CORE-12: can start (next). Story 12',
        'CORE-13: status is needs-info. Story 13',
        'CORE-14: waits on CORE-12. Story 14',
        'CORE-15: waits on CORE-13. Story 15',
      ].join('\n'),
    })
  })

  test('dispatch briefs the worker for Jira and names the story by its key', async ($, on) => {
    const { clock, files, osascript } = world(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })

    await $.tool.call({ tool: 'mcp__orchestra__dispatch', tool_use_id: 't1' } as never)
    await clock.settle()

    const [, , typed = ''] = osascript.at(-1) ?? []
    expect(typed).toContain("'/mattpocock-skills:implement CORE-12'")
    const briefs = Object.keys(files).filter(path => path.endsWith('.brief.md'))
    expect(briefs).toEqual([expect.stringMatching(/^\/repo\/\.git\/orchestra\/CORE-10-12-\w+\.brief\.md$/)])
    expect(files[briefs[0]!]).toContain('Jira story CORE-12 (Story 12), a story of the epic CORE-10 (Epic 10)')
    expect(files[briefs[0]!]).toContain('Atlassian MCP server `atlassian`')
  })

  test('without an Atlassian server, the tools say how to connect one', async ($, on) => {
    world(on, ['Read'])
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })

    const answer = await $.tool.call({ tool: 'mcp__orchestra__issues', tool_use_id: 't1' } as never)

    expect(answer).toEqual({ deny: expect.stringContaining('this session has no Atlassian MCP server') })
  })
})
