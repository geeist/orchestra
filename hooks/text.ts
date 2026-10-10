// Everything the models read: tool descriptions, the worker's brief, the nudge.

import type { Labels, Tracker } from './github'
import type { Issue } from './scratch'

export const ISSUES_DESCRIPTION = `Lists the issues in this repo's tracker in order, each with whether it can start now and why not. The tracker is .scratch/<feature>/issues/*.md, or the repo's GitHub issues when docs/agents/issue-tracker.md says GitHub: there a feature is a parent issue (#12) and its sub-issues are its tickets. Read-only.`

export const DISPATCH_DESCRIPTION = `Starts an unattended Claude Code worker session in a new Ghostty tab to implement one issue from this repo's tracker (.scratch, or GitHub issues). Without \`issue\`, it takes the next issue that can start (status ready-for-agent, every blocker done). One worker runs at a time, on the current branch, and the working tree must be clean. It returns at once: then call mcp__orchestra__wait, which blocks until the worker reports. The worker implements, commits, updates the issue (its Status line, or on GitHub its label, or it closes it) and reports done, blocked or failed.`

export const WAIT_DESCRIPTION = `Blocks until the running orchestra worker reports or stops, for up to \`minutes\` (default 10). Returns the worker's report, its commits since dispatch and what can start next. If it says the worker is still running, call it again. After a report, check the worker's commits (git show; run the tests when in doubt), then dispatch the next issue, or stop and tell the person what needs them.`

export const REPORT_DESCRIPTION = `Reports this worker's outcome to the orchestrator session that started it. Call it once, as your last action. outcome "done": the issue is implemented and committed, and marked done (its Status line, or closed on GitHub). "blocked": you need a person; the summary says exactly what, and the issue says needs-info. "failed": something broke that you can't repair; the issue says ready-for-human. The summary is what the orchestrator reads: what changed, the commits, and anything a reviewer should check.`

export const NUDGE = `[orchestra] You ended your turn without calling mcp__orchestra__report, and nobody is watching this session. If the issue is finished and committed, call report with outcome "done". If you need a person, call report with outcome "blocked". Otherwise carry on with the issue.`

type Briefed = Pick<Issue, 'path' | 'number' | 'title' | 'feature' | 'featureTitle'>

export function brief(issue: Briefed, job: string, tracker: Tracker): string {
  return tracker.kind === 'github' ? githubBrief(issue, job, tracker.labels) : localBrief(issue, job)
}

function localBrief(issue: Briefed, job: string): string {
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

function githubBrief(issue: Briefed, job: string, labels: Labels): string {
  const n = issue.number
  const ready = labels['ready-for-agent']
  const swap = (label: string) =>
    `swap its label \`${ready}\` for \`${label}\` (\`gh issue edit ${n} --remove-label ${ready} --add-label ${label}\`)`
  const parent =
    issue.feature === ''
      ? ''
      : `, a ticket of ${issue.feature}${issue.featureTitle === undefined ? '' : ` (${issue.featureTitle})`}`

  return `# Orchestra worker

An orchestrator session started you in a Ghostty tab of your own to implement one issue, unattended. Nobody watches this tab.

- Issue: GitHub issue #${n} (${issue.title})${parent}. Read it with \`gh issue view ${n} --comments\`${issue.feature === '' ? '' : `, and its parent the same way`}.
- Job: \`${job}\`

- Don't ask questions and don't wait for input. Where the issue or its spec leaves a choice, make the call a careful engineer would and say so in a comment on the issue (\`gh issue comment ${n}\`).
- Work on this issue only, on the current branch. Follow CLAUDE.md and the docs the issue points to. Leave the parent issue as it is.
- When the work is finished: commit everything, tick the boxes in the issue's body that are done (\`gh issue edit ${n} --body-file\`), then close it with a comment that names the commits (\`gh issue close ${n} --comment\`).
- If you can't finish without a person: commit what is safe to keep, ask the question in a comment on the issue, ${swap(labels['needs-info'])}, and report "blocked".
- If something broke that you can't repair: leave the working tree clean (commit or \`git stash\`), say what broke in a comment on the issue, ${swap(labels['ready-for-human'])}, and report "failed".
- A label the repo doesn't have yet, create with \`gh label create\` first.
- Your last action is the \`mcp__orchestra__report\` tool. Stop after it.
`
}

export function goal(feature: string | undefined): string {
  const which = feature === undefined ? 'No issue' : `No issue of feature ${feature}`

  return `${which} can be dispatched any more: each one is done, reported blocked or failed by an orchestra worker, or waits on one that is. Work them one at a time with the orchestra tools (dispatch, then wait), and check each worker's commits before the next.`
}

/** What the board and the `issues` tool say when there is nothing to show. */
export function noIssues(tracker: Tracker['kind'] | undefined): string {
  return tracker === 'github'
    ? 'No GitHub issues for orchestra: none has a parent issue, or the label ready-for-agent, needs-info or ready-for-human.'
    : 'No issues in .scratch.'
}
