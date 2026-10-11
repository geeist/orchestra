import { describe, expect, mock, test } from 'claude-code/testing'

import type { RenderElement } from 'claude-code'

import { SCENARIOS } from './scenarios'

// The preview, driven as a person drives it: /orchestra-preview writes the
// scenario, the gallery and the board pane draw it, and the buttons step,
// widen and end it. The kit keeps `$.state`; the test's hooks answer the
// pane opening and closing, and record the toasts. No `process.run` hook:
// a preview button that reached osascript or git would fail the test.

const SURFACES = ['terminal', 'desktop'] as const

const SCROLL = { offset: 0, bodyRows: 40 }
const PANE_PROPS = { title: 'orchestra', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: SCROLL, view: {} } as const
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: SCROLL, view: {} }

const ENGINE: RenderElement = { type: 'Text', children: ['engine'] }

/** /orchestra-preview typed at the prompt. */
const preview = (args: string) =>
  ({ command: 'orchestra-preview', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } }) as const

describe('preview', () => {
  for (const surface of SURFACES) {
    test(`the gallery draws every scenario (${surface})`, async ($, on) => {
      mock.clock(on)
      on('ui.open', () => ({ value: { isPlaced: true } }))

      for (const scenario of SCENARIOS) {
        const ran = await $.command.run(preview(scenario.name))
        expect(ran.text).toContain(`Previewing ${scenario.name}`)

        const gallery = await $.ui.mount({ plugin: 'orchestra', surface, component: 'Pane', requestId: 'orchestra-preview', props: PANE_PROPS })
        expect(await gallery.find({ text: scenario.about })).toBeDefined()
        await gallery.unmount()
      }
    })
  }

  test('the board pane draws the scenario, and its buttons only say what they would do', async ($, on) => {
    const toasts: string[] = []
    mock.clock(on)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })

    await $.command.run(preview('board'))
    const board = await $.ui.mount({ plugin: 'orchestra', surface: 'terminal', component: 'Pane', requestId: 'orchestra', props: PANE_PROPS })
    expect(await board.find({ text: '02-login-form' })).toBeDefined()

    await board.press({ key: 'next' })
    await board.press({ key: 'release:.scratch/login/issues/04-remember-me.md' })

    expect(toasts).toEqual(['Preview: would dispatch the next issue', 'Preview: would release the issue job login-04-m1k2 holds'])
  })

  test('steps through the scenarios, changes the width, and ends', async ($, on) => {
    const closed: string[] = []
    mock.clock(on)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.close', ($, e) => {
      closed.push(e.id)
      return { value: undefined }
    })
    on('ui.render', () => ENGINE)

    await $.command.run(preview('running'))
    const gallery = await $.ui.mount({ plugin: 'orchestra', surface: 'terminal', component: 'Pane', requestId: 'orchestra-preview', props: PANE_PROPS })
    const band = await $.ui.mount({ plugin: 'orchestra', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect((await band.find({ text: '02-login-form' }))?.text).toContain('Edit routes/login.tsx')

    await gallery.press({ key: 'preview:next' })
    expect(await gallery.find({ text: SCENARIOS[2]!.about })).toBeDefined()

    await gallery.press({ key: 'preview:width' })
    await gallery.press({ key: 'preview:width' })
    await gallery.press({ key: 'preview:width' })
    expect(await gallery.find({ text: '60 columns' })).toBeDefined()

    await gallery.press({ key: 'preview:end' })
    expect(closed).toEqual(['orchestra-preview'])
    expect(await band.find({ text: '02-login-form' })).toBeUndefined()
    expect(await band.find({ text: 'engine' })).toBeDefined()
  })

  test('an unknown scenario lists the ones there are', async $ => {
    const ran = await $.command.run(preview('nope'))

    expect(ran.text).toContain('No scenario "nope"')
    expect(ran.text).toContain('worker-stalled')
  })
})
