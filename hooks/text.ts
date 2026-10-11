// Everything the models read: tool descriptions, the worker's brief, the nudge.

import type { Labels, Tracker } from './github'
import type { JiraScope } from './jira'
import type { Issue } from './scratch'

export const ISSUES_DESCRIPTION = `Lists the issues in this repo's tracker in order, each with whether it can start now and why not. The tracker is .scratch/<feature>/issues/*.md, the repo's GitHub issues when docs/agents/issue-tracker.md says GitHub, or a Jira project's stories when it says Jira. On GitHub a feature is a parent issue (#12) and its sub-issues are its tickets; in Jira a feature is an epic (CORE-12) and its stories are its tickets. Read-only.`

export const DISPATCH_DESCRIPTION = `Starts an unattended Claude Code worker session in a new Ghostty tab to implement one issue from this repo's tracker (.scratch, GitHub issues, or Jira stories). Without \`issue\`, it takes the next issue that can start (status ready-for-agent, every blocker done). One worker runs at a time, on the current branch, and the working tree must be clean. It returns at once: then call mcp__orchestra__wait, which blocks until the worker reports. The worker implements, commits, updates the issue (its Status line, its label, or it closes the GitHub issue or moves the Jira story to done) and reports done, blocked or failed.`

export const WAIT_DESCRIPTION = `Blocks until the running orchestra worker reports or stops, for up to \`minutes\` (default 10). Returns the worker's report, its commits since dispatch and what can start next. If it says the worker is still running, call it again. After a report, check the worker's commits (git show; run the tests when in doubt), then dispatch the next issue, or stop and tell the person what needs them.`

export const REPORT_DESCRIPTION = `Reports this worker's outcome to the orchestrator session that started it. Call it once, as your last action. outcome "done": the issue is implemented and committed, and marked done (its Status line, closed on GitHub, or moved to done in Jira). "blocked": you need a person; the summary says exactly what, and the issue says needs-info. "failed": something broke that you can't repair; the issue says ready-for-human. The summary is what the orchestrator reads: what changed, the commits, and anything a reviewer should check.`

export const NUDGE = `[orchestra] You ended your turn without calling mcp__orchestra__report, and nobody is watching this session. If the issue is finished and committed, call report with outcome "done". If you need a person, call report with outcome "blocked". Otherwise carry on with the issue.`

type Briefed = Pick<Issue, 'path' | 'number' | 'title' | 'feature' | 'featureTitle'>

export function brief(issue: Briefed, job: string, tracker: Tracker): string {
  switch (tracker.kind) {
    case 'github':
      return githubBrief(issue, job, tracker.labels)
    case 'jira':
      return jiraBrief(issue, job, tracker)
    case 'local':
      return localBrief(issue, job)
  }
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

function jiraBrief(issue: Briefed, job: string, jira: JiraScope & { labels: Labels }): string {
  const key = issue.path
  const ready = jira.labels['ready-for-agent']
  // How the server's name reads in its tools' names.
  const tools = `mcp__${jira.server.replace(/[^\w-]/g, '_')}__…`
  const swap = (label: string) =>
    `swap its label \`${ready}\` for \`${label}\` (send the whole list of labels, the others kept)`
  const epic =
    issue.feature === ''
      ? ''
      : `, a story of the epic ${issue.feature}${issue.featureTitle === undefined ? '' : ` (${issue.featureTitle})`}`

  return `# Orchestra worker

An orchestrator session started you in a Ghostty tab of your own to implement one issue, unattended. Nobody watches this tab.

- Issue: Jira story ${key} (${issue.title})${epic}, on ${jira.site}. Read it and its comments${issue.feature === '' ? '' : `, and its epic the same way`}, with the tools of the Atlassian MCP server \`${jira.server}\` (\`${tools}\`); their cloudId is \`${jira.site}\`.
- Job: \`${job}\`

- Don't ask questions and don't wait for input. Where the story or its epic leaves a choice, make the call a careful engineer would and say so in a comment on the story.
- Work on this story only, on the current branch. Follow CLAUDE.md and the docs the story points to. Leave the epic as it is.
- When the work is finished: commit everything, tick the checkboxes in the story's description that are done (send the whole description back, not a part of it), move the story to a status in the Done category (its transitions name the statuses), and add a comment that names the commits.
- If you can't finish without a person: commit what is safe to keep, ask the question in a comment on the story, ${swap(jira.labels['needs-info'])}, and report "blocked".
- If something broke that you can't repair: leave the working tree clean (commit or \`git stash\`), say what broke in a comment on the story, ${swap(jira.labels['ready-for-human'])}, and report "failed".
- Your last action is the \`mcp__orchestra__report\` tool. Stop after it.
`
}

export function goal(feature: string | undefined): string {
  const which = feature === undefined ? 'No issue' : `No issue of feature ${feature}`

  return `${which} can be dispatched any more: each one is done, reported blocked or failed by an orchestra worker, or waits on one that is. Work them one at a time with the orchestra tools (dispatch, then wait), and check each worker's commits before the next.`
}

/** What the board and the `issues` tool say when there is nothing to show. */
export function noIssues(tracker: Tracker['kind'] | undefined): string {
  switch (tracker) {
    case 'github':
      return 'No GitHub issues for orchestra: none has a parent issue, or the label ready-for-agent, needs-info or ready-for-human.'
    case 'jira':
      return 'No Jira stories for orchestra: the epics docs/agents/issue-tracker.md names have none, or no story in the project has the label ready-for-agent, needs-info or ready-for-human.'
    default:
      return 'No issues in .scratch.'
  }
}
