import { describe, expect, test } from 'claude-code/testing'

import type { RenderElement } from 'claude-code'

import type { OrchestraBoard, OrchestraShown } from '../types'

// The drawings, mounted through the mod on two surfaces. The test's hooks
// stand for the engine: `state.get` answers the board, `process.run` the
// osascript a button runs, `ui.toast` records what the person is told,
// `clock.now` the time the band's mark is drawn at, and `ui.render` draws the
// engine's own row where the mod passes.

const SURFACES = ['terminal', 'desktop'] as const

const BOARD: OrchestraBoard = {
  issues: [
    {
      path: '.scratch/s/issues/01-a.md',
      feature: 's',
      slug: '01-a',
      title: '01: A',
      tone: 'done',
      reason: 'done',
    },
    {
      path: '.scratch/s/issues/02-b.md',
      feature: 's',
      slug: '02-b',
      title: '02: B',
      tone: 'running',
      reason: 'a worker runs it (job s-02-x)',
    },
    {
      path: '.scratch/s/issues/03-c.md',
      feature: 's',
      slug: '03-c',
      title: '03: C',
      tone: 'held',
      reason: "its last worker ended failed and the issue hasn't changed since (job s-03-y)",
      heldBy: 's-03-y',
    },
  ],
  running: {
    id: 's-02-x',
    issue: '.scratch/s/issues/02-b.md',
    slug: '02-b',
    title: '02: B',
    tab: 'tab-9',
    minutes: 4,
    phase: 'running',
    activity: 'Edit hooks/ui.tsx',
    activityAgo: 12,
    tools: 30,
    isMine: true,
  },
  recent: [],
}

const SCROLL = { offset: 0, bodyRows: 20 }

const ENGINE: RenderElement = { type: 'Text', children: ['engine'] }

describe('board pane', () => {
  for (const surface of SURFACES) {
    test(`draws the running job and focuses its tab (${surface})`, async ($, on) => {
      const ran: string[][] = []
      const toasts: string[] = []
      on('state.get', { plugin: 'orchestra', key: 'board' }, () => ({ value: { value: BOARD, version: 1 } }))
      on('process.run', ($, e) => {
        ran.push([...e.argv])
        return { value: { exitCode: 0, stdout: 'focused\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      })
      on('ui.toast', ($, e) => {
        toasts.push(e.text)
        return { value: undefined }
      })

      const ui = await $.ui.mount({
        plugin: 'orchestra',
        surface,
        component: 'Pane',
        requestId: 'orchestra',
        props: { title: 'orchestra', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: SCROLL, view: {} },
      })

      expect((await ui.find({ text: 'Edit hooks/ui.tsx' }))?.text).toContain('30 tools')
      expect(await ui.find({ key: 'release:.scratch/s/issues/03-c.md' })).toBeDefined()
      expect(await ui.find({ key: 'next' })).toBeUndefined()

      await ui.press({ key: 'focus' })

      expect(ran).toEqual([['osascript', '-', 'tab-9']])
      expect(toasts).toEqual(['Focused the worker tab.'])
    })
  }
})

describe('band above the prompt', () => {
  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: SCROLL, view: {} }

  for (const surface of SURFACES) {
    test(`shows the running worker, and gives way to a survey (${surface})`, async ($, on) => {
      on('clock.now', () => ({ value: 0 }))
      on('state.get', { plugin: 'orchestra', key: 'board' }, () => ({ value: { value: BOARD, version: 1 } }))
      on('ui.render', () => ENGINE)

      const band = await $.ui.mount({ plugin: 'orchestra', surface, component: 'AbovePrompt', props })
      expect((await band.find({ text: '02-b' }))?.text).toContain('Edit hooks/ui.tsx')
      expect(await band.find({ key: 'board' })).toBeDefined()

      const survey = await $.ui.mount({ plugin: 'orchestra', surface, component: 'AbovePrompt', props: { ...props, hasSurvey: true } })
      expect(await survey.find({ text: '02-b' })).toBeUndefined()
      expect(await survey.find({ text: 'engine' })).toBeDefined()
    })

    test(`a worker's band names its job, then how it ended (${surface})`, async ($, on) => {
      on('clock.now', () => ({ value: 0 }))
      let me: { job: string; ended?: string } = { job: 's-02-x' }
      on('state.get', { plugin: 'orchestra', key: 'worker' }, () => ({ value: { value: me, version: 1 } }))
      on('ui.render', () => ENGINE)

      const working = await $.ui.mount({ plugin: 'orchestra', surface, component: 'AbovePrompt', props })
      expect(await working.find({ text: 'worker · s-02-x' })).toBeDefined()

      me = { job: 's-02-x', ended: 'done' }
      const ended = await $.ui.mount({ plugin: 'orchestra', surface, component: 'AbovePrompt', props })
      expect(await ended.find({ text: 'worker · s-02-x · reported done' })).toBeDefined()
      expect(await ended.find({ key: 'mark' })).toBeUndefined()
    })
  }

  test('the terminal draws the mark as a Raster to animate, the desktop as text', async ($, on) => {
    on('clock.now', () => ({ value: 0 }))
    on('state.get', { plugin: 'orchestra', key: 'board' }, () => ({ value: { value: BOARD, version: 1 } }))

    const terminal = await $.ui.mount({ plugin: 'orchestra', surface: 'terminal', component: 'AbovePrompt', props })
    expect((await terminal.find({ key: 'mark' }))?.type).toBe('Raster')

    const desktop = await $.ui.mount({ plugin: 'orchestra', surface: 'desktop', component: 'AbovePrompt', props })
    expect(await desktop.find({ key: 'mark' })).toBeUndefined()
    expect(await desktop.find({ text: '◐ orchestra' })).toBeDefined()
  })
})

describe('tool result rows', () => {
  const REPORT: OrchestraShown = {
    kind: 'report',
    report: {
      slug: '02-b',
      job: 's-02-x',
      outcome: 'done',
      lateFrom: 'stalled',
      minutes: 21,
      summary: 'Built **B**.',
      commits: ['913317e Add B'],
      issue: 'status done, 3/3 boxes ticked, done',
      dirty: [],
    },
  }

  for (const surface of SURFACES) {
    test(`a wait's report draws as a card (${surface})`, async ($, on) => {
      on('state.get', { plugin: 'orchestra', key: 'shown' }, () => ({ value: { value: REPORT, version: 1 } }))
      on('ui.render', () => ENGINE)

      const row = await $.ui.mount({
        plugin: 'orchestra',
        surface,
        component: 'ToolResult',
        requestId: 'toolu_1',
        props: { tool_use_id: 'toolu_1', tool: 'mcp__orchestra__wait', output: 'text', isErrored: false },
      })

      expect(await row.find({ text: 'done, reported after it was marked stalled' })).toBeDefined()
      expect(await row.find({ text: '913317e Add B' })).toBeDefined()
    })
  }
})
