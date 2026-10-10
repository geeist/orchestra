// Starting a worker: the command line typed into a new Ghostty tab, and the
// AppleScript that opens the tab. The line goes through the person's own
// interactive shell, so their `claude` function or alias applies and the tab
// stays a shell afterwards. The worker loads this plugin the way the person's
// other sessions do (installed, or a plugin dir their shell sets), so the line
// never names a plugin dir.

export type Launch = {
  permissionMode: string
  model?: string
  /** The session's display name. */
  name: string
  briefFile: string
  prompt: string
}

/** Quotes one word for zsh: inside single quotes everything is literal. */
export function quote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`
}

export function commandLine(launch: Launch): string {
  const words = ['claude', '--permission-mode', quote(launch.permissionMode)]
  if (launch.model !== undefined && launch.model !== '') words.push('--model', quote(launch.model))
  words.push('-n', quote(launch.name), '--append-system-prompt-file', quote(launch.briefFile))
  words.push(quote(launch.prompt))

  return words.join(' ')
}

/** The worker's first prompt: `{issue}` filled in, or the path appended. */
export function workerPrompt(template: string, issuePath: string): string {
  return template.includes('{issue}') ? template.replaceAll('{issue}', issuePath) : `${template} ${issuePath}`
}

/**
 * Opens a tab in Ghostty's front window (a new window when there is none)
 * and prints the tab's id. Arguments: the working directory, the line to
 * type, then `KEY=VALUE` environment entries. Run as `osascript - <args>`.
 */
export const OPEN_TAB = `on run argv
  set cwd to item 1 of argv
  set typed to item 2 of argv
  set envs to {}
  if (count of argv) > 2 then set envs to items 3 thru -1 of argv
  tell application "Ghostty"
    set cfg to new surface configuration
    set initial working directory of cfg to cwd
    set initial input of cfg to typed & linefeed
    set environment variables of cfg to envs
    if (count of windows) > 0 then
      set t to new tab in front window with configuration cfg
    else
      set w to new window with configuration cfg
      set t to selected tab of w
    end if
    return id of t
  end tell
end run
`

/**
 * Brings Ghostty to the front with the tab whose id is the one argument
 * selected; prints `gone` when no window holds it any more.
 */
export const FOCUS_TAB = `on run argv
  set wanted to item 1 of argv
  tell application "Ghostty"
    repeat with w in windows
      repeat with t in tabs of w
        if id of t is wanted then
          activate window w
          select tab t
          activate
          return "focused"
        end if
      end repeat
    end repeat
  end tell
  return "gone"
end run
`
