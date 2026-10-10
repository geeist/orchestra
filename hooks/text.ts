// Everything the models read: tool descriptions, the worker's brief, the nudge.

export const ISSUES_DESCRIPTION = `Lists the issues in this repo's local tracker (.scratch/<feature>/issues/*.md) in order, each with whether it can start now and why not. Read-only.`

export const DISPATCH_DESCRIPTION = `Starts an unattended Claude Code worker session in a new Ghostty tab to implement one issue from .scratch. Without \`issue\`, it takes the next issue that can start (status ready-for-agent, every blocker done). One worker runs at a time, on the current branch, and the working tree must be clean. It returns at once: then call mcp__orchestra__wait, which blocks until the worker reports. The worker implements, commits, sets the issue's Status line and reports done, blocked or failed.`

export const WAIT_DESCRIPTION = `Blocks until the running orchestra worker reports or stops, for up to \`minutes\` (default 10). Returns the worker's report, its commits since dispatch and what can start next. If it says the worker is still running, call it again. After a report, check the worker's commits (git show; run the tests when in doubt), then dispatch the next issue, or stop and tell the person what needs them.`

export const REPORT_DESCRIPTION = `Reports this worker's outcome to the orchestrator session that started it. Call it once, as your last action. outcome "done": the issue is implemented and committed, and its Status line says done. "blocked": you need a person; the summary says exactly what, and the issue's Status says needs-info. "failed": something broke that you can't repair; the Status says ready-for-human. The summary is what the orchestrator reads: what changed, the commits, and anything a reviewer should check.`

export const NUDGE = `[orchestra] You ended your turn without calling mcp__orchestra__report, and nobody is watching this session. If the issue is finished and committed, call report with outcome "done". If you need a person, call report with outcome "blocked". Otherwise carry on with the issue.`

export function brief(issue: { path: string; title: string }, job: string): string {
  return `# Orchestra worker

An orchestrator session started you in a Ghostty tab of your own to implement one issue, unattended. Nobody watches this tab.

- Issue: \`${issue.path}\` (${issue.title})
- Job: \`${job}\`

- Don't ask questions and don't wait for input. Where the issue or its spec leaves a choice, make the call a careful engineer would and note it under the issue's \`## Comments\` heading.
- Work on this issue only, on the current branch. Follow CLAUDE.md and the docs the issue points to.
- When the work is finished: tick the issue's boxes that are done, set its Status line to \`done\`, and commit everything, the issue file included.
- If you can't finish without a person: commit what is safe to keep, write the question under \`## Comments\`, set the Status line to \`needs-info\`, commit, and report "blocked".
- If something broke that you can't repair: leave the working tree clean (commit or \`git stash\`), set the Status line to \`ready-for-human\`, commit, and report "failed".
- Your last action is the \`mcp__orchestra__report\` tool. Stop after it.
`
}

export function goal(feature: string | undefined): string {
  const where = feature === undefined ? '.scratch' : `.scratch/${feature}`

  return `No issue in ${where} can be dispatched any more: each one is done, reported blocked or failed by an orchestra worker, or waits on one that is. Work them one at a time with the orchestra tools (dispatch, then wait), and check each worker's commits before the next.`
}
