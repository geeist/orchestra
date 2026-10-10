// Starting a worker: the command line typed into a new Ghostty tab, and the
// AppleScript that opens the tab in the orchestrator's window. The line goes
// through the person's own interactive shell, so their `claude` function or
// alias applies and the tab stays a shell afterwards. The worker loads this
// plugin the way the person's other sessions do (installed, or a plugin dir
// their shell sets), so the line never names a plugin dir.

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
 * Prints the id and working directory of the terminal Ghostty has focused,
 * one per line, or nothing while Ghostty is not the frontmost app. Run as
 * `osascript -` when the person has just typed into the orchestrator.
 */
export const FRONT_TERMINAL = `tell application "Ghostty"
  if not frontmost or (count of windows) is 0 then return ""
  set s to focused terminal of selected tab of front window
  return (id of s) & linefeed & (working directory of s)
end tell
`

/**
 * Opens a tab in the orchestrator's Ghostty window and prints the tab's id.
 * That window holds the orchestrator's terminal; without one known, it is
 * the one window with a terminal in the orchestrator's directory outside
 * the worker tabs. Failing both, the front window, or a new one when there
 * is none. Arguments: the working directory, the line to type, the
 * orchestrator's terminal id (or empty), its directory, the worker tab ids
 * joined by commas, then `KEY=VALUE` environment entries. Run as
 * `osascript - <args>`.
 */
export const OPEN_TAB = `on run argv
  set cwd to item 1 of argv
  set typed to item 2 of argv
  set home to item 3 of argv
  set here to item 4 of argv
  set AppleScript's text item delimiters to ","
  set workerTabs to text items of (item 5 of argv)
  set AppleScript's text item delimiters to ""
  set envs to {}
  if (count of argv) > 5 then set envs to items 6 thru -1 of argv
  tell application "Ghostty"
    set cfg to new surface configuration
    set initial working directory of cfg to cwd
    set initial input of cfg to typed & linefeed
    set environment variables of cfg to envs
    set target to my homeWindow(home, here, workerTabs)
    if target is missing value and (count of windows) > 0 then set target to front window
    if target is missing value then
      set w to new window with configuration cfg
      return id of selected tab of w
    end if
    set t to new tab in target with configuration cfg
    return id of t
  end tell
end run

on homeWindow(home, here, workerTabs)
  tell application "Ghostty"
    if home is not "" then
      repeat with w in windows
        repeat with s in terminals of w
          if id of s is home then return contents of w
        end repeat
      end repeat
    end if
    set found to {}
    repeat with w in windows
      set isFound to false
      repeat with t in tabs of w
        if (id of t) is not in workerTabs then
          repeat with s in terminals of t
            if working directory of s is here then set isFound to true
          end repeat
        end if
      end repeat
      if isFound then set end of found to contents of w
    end repeat
    if (count of found) is 1 then return item 1 of found
  end tell
  return missing value
end homeWindow
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
