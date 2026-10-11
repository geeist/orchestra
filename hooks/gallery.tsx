import type { RenderElement } from 'claude-code'

import type { Scenario } from './scenarios'
import { band, pane, shownRow, waitRow, workerBand } from './ui'
import type { Els, Handlers } from './ui'

// The preview's gallery pane (/orchestra-preview): one scenario's drawings
// at once, each under a rule as wide as the width it is drawn at. The
// drawings are ui.tsx's own, so what it shows is what a session shows; only
// the engine's row above the line under `wait` stands in.

export const GALLERY = 'orchestra-preview'

/** The widths the gallery draws at, in turn; 0 is the pane's own. */
export const WIDTHS: readonly number[] = [0, 100, 80, 60, 40]

/** What the gallery's own buttons do. */
export type Controls = {
  previous: () => void
  next: () => void
  width: () => void
  end: () => void
}

/** The scenario shown, its place among them, and the width it is drawn at. */
export type Showing = { scenario: Scenario; index: number; count: number; width: number }

/** The engine's own row for a running `wait`, which the line under it hangs from. */
const ENGINE_WAIT = '⏺ orchestra - wait (MCP)(minutes: 10)'

export function gallery(
  el: Els,
  showing: Showing | undefined,
  bodyColumns: number,
  cells: string | undefined,
  on: Handlers,
  controls: Controls,
): RenderElement {
  const { Box, Text, Button } = el
  if (showing === undefined) return <Text dimColor>No preview runs. /orchestra-preview starts one.</Text>

  const { scenario, index, count, width } = showing
  const columns = width === 0 ? bodyColumns : Math.min(width, bodyColumns)
  const running = scenario.board?.running
  const shown = scenario.shown ?? []
  const rule = (name: string) => (
    <Box key={`rule:${name}`} marginTop={1}>
      <Text dimColor>{`── ${name} ${'─'.repeat(Math.max(0, columns - name.length - 4))}`}</Text>
    </Box>
  )

  return (
    <Box flexDirection="column" width={bodyColumns}>
      <Box flexDirection="row" gap={1}>
        <Text bold>{scenario.name}</Text>
        <Box flexGrow={1}>
          <Text dimColor>{`${index + 1}/${count} · ${width === 0 ? `full width, ${bodyColumns}` : `${columns} columns`}`}</Text>
        </Box>
        <Button key="preview:previous" label="Previous" hotkey="k" onPress={controls.previous} />
        <Button key="preview:next" label="Next" hotkey="j" variant="primary" onPress={controls.next} />
        <Button key="preview:width" label="Width" hotkey="w" onPress={controls.width} />
        <Button key="preview:end" label="End preview" hotkey="x" onPress={controls.end} />
      </Box>
      <Text dimColor wrap="truncate-end">
        {scenario.about}
      </Text>
      {scenario.board === undefined ? null : [rule('Board'), pane(el, scenario.board, columns, on)]}
      {scenario.worker !== undefined
        ? [rule('Band above the prompt'), workerBand(el, scenario.worker, cells, columns)]
        : running !== undefined
          ? [rule('Band above the prompt'), band(el, running, cells, columns, on)]
          : null}
      {running === undefined
        ? null
        : [rule('Under a running wait'), <Box width={columns}>{waitRow(el, <Text>{ENGINE_WAIT}</Text>, running)}</Box>]}
      {shown.length === 0
        ? null
        : [
            rule('Tool results'),
            ...shown.map((one, at) => (
              <Box key={`shown:${at}`} width={columns} marginTop={at === 0 ? 0 : 1}>
                {shownRow(el, one)}
              </Box>
            )),
          ]}
    </Box>
  )
}
