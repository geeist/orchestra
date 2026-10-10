import { describe, expect, test } from 'claude-code/testing'

import { commandLine, quote, workerPrompt } from './launch'
import { findIssues, parseIssue, plan } from './scratch'

const issue = (number: string, status: string, blockedBy: string, boxes: string) =>
  parseIssue(
    `.scratch/local-stack/issues/${number}-thing.md`,
    `# ${number}: Thing\n\n**What to build:** stuff\n\n**Blocked by:** ${blockedBy}\n\n**Status:** ${status}\n\n${boxes}\n`,
  )

const done = '- [x] one\n- [x] two'
const open = '- [x] one\n- [ ] two'

describe('parseIssue', () => {
  test('reads the bold Status and Blocked by lines and the boxes', () => {
    const one = issue('05', 'ready-for-agent', '02, 3', open)

    expect(one.number).toBe('05')
    expect(one.slug).toBe('05-thing')
    expect(one.feature).toBe('local-stack')
    expect(one.title).toBe('05: Thing')
    expect(one.status).toBe('ready-for-agent')
    expect(one.blockedBy).toEqual(['02', '03'])
    expect(one.openBoxes).toBe(1)
    expect(one.doneBoxes).toBe(1)
    expect(one.isDone).toBe(false)
  })

  test('None blocks nothing', () => {
    expect(issue('01', 'ready-for-agent', 'None (can start immediately)', open).blockedBy).toEqual([])
  })

  test('every box ticked is done, whatever the status', () => {
    expect(issue('01', 'ready-for-agent', 'None', done).isDone).toBe(true)
  })

  test('a done status is done with boxes open', () => {
    expect(issue('01', 'done', 'None', open).isDone).toBe(true)
  })

  test('reads plain lines too', () => {
    const plain = parseIssue('.scratch/x/issues/02-y.md', '# Y\n\nStatus: needs-info\nBlocked by: 01\n')

    expect(plain.status).toBe('needs-info')
    expect(plain.blockedBy).toEqual(['01'])
  })
})

describe('plan', () => {
  const issues = [
    issue('04', 'ready-for-agent', '03', open),
    issue('01', 'ready-for-agent', 'None', done),
    issue('03', 'ready-for-agent', '01', open),
    issue('02', 'needs-info', '01', open),
    issue('05', 'ready-for-agent', '02, 03', open),
  ]

  test('orders by number and starts the first ready issue whose blockers are done', () => {
    const list = plan(issues)

    expect(list.map(one => one.number)).toEqual(['01', '02', '03', '04', '05'])
    expect(list.find(one => one.canStart)?.number).toBe('03')
    expect(list.map(one => one.reason)).toEqual([
      'done',
      'status is needs-info',
      'can start',
      'waits on 03',
      'waits on 02, 03',
    ])
  })

  test('a held issue does not start', () => {
    const held = new Map([['.scratch/local-stack/issues/03-thing.md', 'a worker runs it']])

    expect(plan(issues, held).find(one => one.canStart)).toBeUndefined()
  })
})

describe('findIssues', () => {
  const issues = [issue('03', 'ready-for-agent', '01', open), issue('13', 'ready-for-agent', '01', open)]

  test('by number, slug, feature/number and path', () => {
    for (const ref of ['3', '03', '03-thing', 'local-stack/03', '.scratch/local-stack/issues/03-thing.md']) {
      expect(findIssues(issues, ref).map(one => one.number)).toEqual(['03'])
    }
  })

  test('another feature matches nothing', () => {
    expect(findIssues(issues, 'other/03')).toEqual([])
  })
})

describe('launch', () => {
  test('quotes a single quote for zsh', () => {
    expect(quote("it's")).toBe(`'it'\\''s'`)
  })

  test('fills the issue into the worker prompt', () => {
    expect(workerPrompt('/implement {issue}', 'a.md')).toBe('/implement a.md')
    expect(workerPrompt('/implement', 'a.md')).toBe('/implement a.md')
  })

  test('builds the claude line, the model optional', () => {
    const launch = {
      permissionMode: 'auto',
      name: 'orchestra: 03-thing',
      briefFile: '/repo/.git/orchestra/j.brief.md',
      prompt: '/mattpocock-skills:implement .scratch/x/issues/03-thing.md',
    }

    expect(commandLine({ ...launch, model: '' })).toBe(
      "claude --permission-mode 'auto' -n 'orchestra: 03-thing' " +
        "--append-system-prompt-file '/repo/.git/orchestra/j.brief.md' " +
        "'/mattpocock-skills:implement .scratch/x/issues/03-thing.md'",
    )
    expect(commandLine({ ...launch, model: 'opus' })).toContain("--permission-mode 'auto' --model 'opus' -n")
  })
})
