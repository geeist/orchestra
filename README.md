# orchestra

A Claude Code plugin that works through a backlog of issues for you: Markdown files in `.scratch`, the repo's GitHub issues, or the stories of a Jira project. It starts one unattended **worker** session per issue, each in its own Ghostty tab. The session that started it, the **orchestrator**, is told when the worker reports. It then checks the commits and starts the next issue.

- **One issue at a time**, on your current branch, in the order you numbered them.
- **A live board** shows every issue, the running worker and the last jobs.
- **Nothing to poll.** The orchestrator wakes up when its worker reports, even when it sat idle.

> [!WARNING]
> Workers run unattended. By default they start in `auto` permission mode and commit to your current branch, and nobody approves their tool calls. Review what each worker committed. The orchestrator gets the list of commits with each report.

## Requirements

| Requirement | Why |
|---|---|
| **macOS and [Ghostty](https://ghostty.org)** | Workers open in Ghostty tabs through AppleScript. Tested with Ghostty 1.3.1. Keep `macos-applescript` on, which is the default. |
| **zsh or bash in Ghostty** | The worker's tab types its command into your shell. That command uses POSIX quoting and `unset`, so fish doesn't work. |
| **`claude` in your interactive shell** | The same command is how the worker starts, so your own `claude` alias or function applies to it. |
| **Claude Code 2.1.296 or later** | Plugin hooks modules are early access, and their API changes between releases. orchestra is built and tested on 2.1.296. |
| **A git repository** | Workers commit there, and orchestra keeps its state in the repo's git directory. |
| **[`gh`](https://cli.github.com), logged in** *(GitHub issues only)* | orchestra reads the issues with `gh api graphql`, and workers update them with `gh issue`. |
| **An Atlassian MCP server, signed in** *(Jira only)* | orchestra searches the stories through it, and workers update them through it, so connect it where both sessions load it (user or project scope). Atlassian's own server, `https://mcp.atlassian.com/v1/mcp`, works. |
| **[mattpocock-skills](https://github.com/mattpocock/skills)** *(optional)* | The default worker prompt is `/mattpocock-skills:implement {issue}`. Install it with `/plugin install mattpocock-skills@claude-plugins-official`, or set your own prompt (see [Settings](#settings)). |

## Install

Type this at the prompt of a Claude Code session in a terminal:

```
/plugin install orchestra --marketplace geeist/orchestra
```

1. Answer `y` to add the `geeist/orchestra` marketplace.
2. Pick a scope. **User** is the simplest: orchestra then loads in every session, workers included. Project and local scope work too, because each worker starts in the repo's root.
3. Set the worker options, or keep the defaults.

orchestra is active in that session right away. The Code tab in the desktop app doesn't take this line, so use a terminal.

**From your shell instead:**

```sh
claude plugin marketplace add geeist/orchestra
claude plugin install orchestra@orchestra
```

**Update:** `claude plugin update orchestra@orchestra`, then `/reload-plugins` in any session that's running. **Remove:** `claude plugin uninstall orchestra@orchestra`.

## Quick start

1. **Write issues** in `.scratch/<feature>/issues/`, one file per issue, as GitHub issues, or as Jira stories (see [Issues](#issues)).
2. **Run `/orchestrate`** in a Claude Code session in the repo. It puts a `/goal …` in the prompt box. Press Enter.
3. **Watch the board** with `/orchestra`, or just follow the band above the prompt.

The orchestrator loops: it dispatches a worker, waits for its report, checks its commits, then starts the next issue. It stops when no issue can start any more. To run a single issue, use `/dispatch 03`.

## Issues

orchestra reads the tracker that `docs/agents/issue-tracker.md` names, the file `/setup-matt-pocock-skills` writes. When its heading says GitHub, orchestra reads the repo's GitHub issues (see [GitHub issues](#github-issues)). When it says Jira, orchestra reads a Jira project's stories (see [Jira](#jira)). Otherwise it reads `.scratch`. Switching the tracker there switches orchestra too.

### In `.scratch`

orchestra reads `.scratch/<feature>/issues/NN-slug.md`:

```
.scratch/
  login/
    issues/
      01-schema.md
      02-login-form.md
```

```markdown
# Login form

Status: ready-for-agent
Blocked by: 01

- [ ] The form posts to /login
- [ ] A wrong password shows an error under the field
```

| Part | Rule |
|---|---|
| **File name** | Starts with the issue's number. `3` and `03` name the same issue. |
| **Title** | The first `# ` heading. The file name stands in when there is none. |
| **`Status:`** | Its first word. Only `ready-for-agent` can start. |
| **`Blocked by:`** | Issue numbers in the same feature, or `none`. |
| **Done** | Status `done`, `resolved`, `closed` or `wontfix`, or every checkbox ticked. |

**An issue can start** when its Status is `ready-for-agent`, it is not done, and every issue it is blocked by is done. Issues go in order: by feature, then by number.

**The worker updates the issue itself.** It ticks the boxes it finished and sets the Status line to one of three values:

| Status | Report | Means |
|---|---|---|
| `done` | done | Implemented and committed |
| `needs-info` | blocked | The question is under `## Comments` in the issue |
| `ready-for-human` | failed | Something broke that the worker couldn't repair |

### GitHub issues

These are the issues `/to-spec` and `/to-tickets` publish once the tracker is GitHub. A **feature** is a parent issue, such as the spec. Its **tickets** are the issues under it:

| Part | Rule |
|---|---|
| **Ticket** | A sub-issue of the parent, or an issue whose `## Parent` section (or `Part of #12` line) names it. The parent itself is never dispatched |
| **Without a parent** | An issue counts once triage labelled it `ready-for-agent`, `needs-info` or `ready-for-human`, and shows under *Other issues* |
| **Status** | Its triage label. A label that holds the issue back wins over `ready-for-agent`. Label names mapped in `docs/agents/triage-labels.md` work too |
| **Blocked by** | GitHub's issue dependencies, and the issues the `## Blocked by` section names. Only blockers still open count |
| **Done** | Closed |

```markdown
## Parent

#12

## What to build

The form posts to /login.

## Acceptance criteria

- [ ] A wrong password shows an error under the field

## Blocked by

- #41
```

orchestra reads every open issue (up to 1,000) and the 50 closed last, which show a feature's finished tickets. Name an issue `#42`, `42`, its link, or `#12/42`.

**The worker updates the issue with `gh`:**

| Issue | Report | Means |
|---|---|---|
| Closed, with a comment naming the commits | done | Implemented and committed. The commits stay local until you push |
| Label `ready-for-agent` swapped for `needs-info` | blocked | The question is in a comment on the issue |
| Label `ready-for-agent` swapped for `ready-for-human` | failed | Something broke that the worker couldn't repair |

### Jira

orchestra reads a Jira project's stories once the heading of `docs/agents/issue-tracker.md` says Jira, such as `# Issue tracker: Jira`. It searches them through the session's Atlassian MCP server, so there is no token to set. Lines in the same file say where the stories are:

```markdown
Site: example.atlassian.net
Project: CORE
Epic: CORE-123
```

| Line | Rule |
|---|---|
| **`Site:`** | The Atlassian site. A link to the site anywhere in the file works too |
| **`Project:`** | The project's key. Without it, orchestra takes the first epic's project |
| **`Epic:`** *(optional)* | One or more epics, separated by commas (`Epics:` works too). With it, orchestra works every story of those epics, labelled or not. Without it, orchestra works every story in the project that triage labelled `ready-for-agent`, `needs-info` or `ready-for-human`, plus the ones done in the last 30 days |
| **`MCP server:`** *(optional)* | The Atlassian MCP server's name, as `/mcp` lists it. Without it, orchestra uses the first server that has Jira's search tool |

Name an epic when other repos share the project, so orchestra only works this repo's stories. To work one epic out of many, run `/orchestrate CORE-123`.

| Part | Rule |
|---|---|
| **Feature** | An epic. orchestra never dispatches the epic itself |
| **Ticket** | A story, task or bug, but no sub-task. A ticket without an epic shows under *Other issues* |
| **Status** | Its triage label, the same as on GitHub. Label names mapped in `docs/agents/triage-labels.md` work too |
| **Blocked by** | Its "is blocked by" links, and the keys in its `## Blocked by` section. Only blockers not yet done count |
| **Done** | Its status is in the Done category |

**The worker updates the story with the Atlassian MCP tools:**

| Story | Report | Means |
|---|---|---|
| Moved to a Done status, with a comment naming the commits | done | Implemented and committed. The commits stay local until you push |
| Label `ready-for-agent` swapped for `needs-info` | blocked | The question is in a comment on the story |
| Label `ready-for-agent` swapped for `ready-for-human` | failed | Something broke that the worker couldn't repair |

**Publish from `/to-spec` and `/to-tickets`:** choose *Other* in `/setup-matt-pocock-skills`, and give it this file as `docs/agents/issue-tracker.md`. If the file names an epic, the stories go under that epic. If it doesn't, each spec becomes a new epic and its stories go under it.

````markdown
# Issue tracker: Jira

Issues and specs for this repo live in Jira. Use the Atlassian MCP server's tools for every operation; their cloudId is the site.

Site: example.atlassian.net
Project: CORE
Epic: CORE-123

## Conventions

- **Epic**: the Epic line is optional. When it names an epic, all of this repo's work goes under that epic. Without the line, each spec becomes an epic of its own.
- **Spec**: when the Epic line names an epic, add the spec to it as a comment and leave its description alone. Otherwise create an Epic in the project whose description is the spec.
- **Ticket**: a Story whose parent is the epic: the one the Epic line names, or the spec's.
- **Blocked by**: link the ticket to each blocker with the link type "Blocks" (the blocker blocks the ticket), and also list the blockers' keys under `## Blocked by` in the description.
- **Triage labels** are Jira labels. Write checkboxes in descriptions as `- [ ]`.
- **Read an issue**: fetch it with its comments, and its epic.
- **Apply / remove labels**: edit the issue's labels, sending the whole list.
- **Close**: move the issue to a status in the Done category.

## When a skill says "publish to the issue tracker"

Create the issue the conventions name: an Epic for a spec (or a comment on the named epic), a Story under the epic for a ticket.

## When a skill says "fetch the relevant ticket"

Fetch the issue with its comments, and its epic.
````

## Commands and tools

| Command | What it does |
|---|---|
| `/orchestrate [feature]` | Puts a `/goal …` in the prompt box that works every issue, or one feature's |
| `/dispatch [issue] [--force]` | Starts one worker. Without an issue, it takes the next one that can start. `--force` starts an issue that can't start, or starts on a working tree with uncommitted changes |
| `/orchestra` | Opens the board |

An issue can be named by its number (`03`), its slug (`03-login-form`), `<feature>/<number>` (`login/03`), or its path. On GitHub, by `#42`, `42`, its link or `#12/42`, and a feature by its parent (`/orchestrate #12`). In Jira, by `CORE-42`, `42`, its link or `CORE-12/CORE-42`, and a feature by its epic (`/orchestrate CORE-12`).

**The model's tools:** an orchestrator gets `mcp__orchestra__issues`, `mcp__orchestra__dispatch` and `mcp__orchestra__wait`. A worker gets `mcp__orchestra__report` instead, with outcome `done`, `blocked` or `failed`.

## What you see

| Where | What |
|---|---|
| **Board** (`/orchestra`) | Every issue by feature, marked ✓ done, ◐ running, ○ can start, ⏸ held or · waiting. Under them, the running worker and the last five jobs. Buttons: **Dispatch next** (`n`), **Start** on an issue that can start, **Focus tab** (`f`) and **Abandon** on the running worker, **Release** on a held issue |
| **Band above the prompt** | While a worker runs: a purple spinner beside the word *orchestra*, with a light passing over it, then the issue, minutes, tool count and latest tool call, with **Board** and **Focus tab**. The worker's own session has a band too: its job, and once it reports, the outcome. Outside the terminal the spinner stands still |
| **Tool rows** | A running `wait` shows the worker's heartbeat. A report shows as a card: outcome, commits, issue, working tree, what's next, and the summary |

## How it behaves

- **One worker at a time,** on the current branch. `dispatch` refuses to start while the working tree has uncommitted changes, unless forced.
- **Worker tabs open in the orchestrator's window,** not whichever Ghostty window is in front. Whenever you type into the orchestrator, orchestra notes which Ghostty terminal you typed in. Until it has one, it looks for the one window with a terminal in the orchestrator's directory, not counting worker tabs. If it can't tell, the tab opens in the front window.
- **Workers are briefed** not to ask questions, to commit, to set the issue's Status, and to call `report` last.
- **A worker that stops without reporting** is reminded twice, then marked stalled. A turn that ends while the worker's own agents still run doesn't count.
- **Held issues:** once a worker finishes an issue, orchestra doesn't dispatch that issue again until it changes: its file, or on GitHub or in Jira any update to the issue. This stops it from retrying a blocked issue in a loop. **Release** on the board lets the issue go without a change.
- **Abandon** stops tracking the worker. Its Ghostty tab keeps running, so close it there.
- **Late reports count.** A worker can still report after it was marked stalled or abandoned, or after its session exited. The board shows it (`stalled, then reported done`), and the orchestrator's next `wait` returns it.
- **Waking up:** `wait` blocks for up to 10 minutes at a time. If the orchestrator is idle when its worker reports, orchestra submits the report as a new prompt and sends a desktop notification.
- **The heartbeat:** every 5 seconds, the worker writes its latest tool call (and its agents') to a file, and the orchestrator updates the board.
- **GitHub and Jira, read sparingly:** the board reads the GitHub issues or Jira stories again once a minute. `issues`, `dispatch` and each report read them at once. If `gh` or the Atlassian server fails, the board says why, and the running worker still shows.

## Settings

Change these in `/config`, or when you install.

| Setting | Default | What it sets |
|---|---|---|
| `workerPrompt` | `/mattpocock-skills:implement {issue}` | The worker's first prompt. `{issue}` becomes the issue's path, `#42` for a GitHub issue, or `CORE-42` for a Jira story; without it, that is added at the end |
| `permissionMode` | `auto` | The worker's `--permission-mode`: `auto`, `acceptEdits`, `manual` or `bypassPermissions` |
| `model` | *(empty)* | The worker's `--model`. Empty keeps your default |

## Where state lives

orchestra keeps its state in `orchestra/` inside the repo's git common directory, so it is never tracked and every worktree shares it. For each job:

- `<job>.job.json`: written by the orchestrator (outcome, late reports, releases)
- `<job>.worker.json`: written by the worker (state, report, heartbeat)
- `<job>.brief.md`: the worker's system prompt

To forget every job, delete the folder:

```sh
rm -r "$(git rev-parse --path-format=absolute --git-common-dir)/orchestra"
```

## Development

Run a checkout instead of the installed plugin, from the repo orchestra should work in:

```sh
~/path/to/orchestra/scripts/dev
```

It starts `claude` with this checkout as a `--plugin-dir`, the installed orchestra switched off, and `ORCHESTRA_DEV=1`. Arguments go on to `claude`. The first load also writes Claude Code's types to `.claude-plugin/types/`, which git ignores. The type check needs them.

**Hot reload.** Saving a file of the plugin reloads it in that session: right away from your editor, or when the turn ends if Claude made the edit. Values in `$.state` stay, and the module's own variables start over. Workers this session dispatches still load the installed orchestra.

**Preview.** `/orchestra-preview [scenario]` draws the board and the band from a made-up state instead of the repo, so you can look at each state without running a worker. It opens a gallery pane that draws the whole state at once: the board, the band, the line under a running `wait`, and the cards orchestra's tools leave in the transcript. A reload redraws the same scenario, so you can edit `hooks/ui.tsx` and watch the change land.

| In the gallery | Does |
|---|---|
| `j` / `k` | Next / previous scenario |
| `w` | Draw at the pane's width, then at 100, 80, 60 and 40 columns |
| `x` | End the preview. So does closing the gallery or `/orchestra-preview off` |

While a preview runs, the buttons on the board and the band only say what they would do. The scenarios live in `hooks/scenarios.ts`: add one for each state a change should be checked in.

Check it before you commit:

```sh
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .
```

| File | What it holds |
|---|---|
| `hooks/register.tsx` | The hooks module: the two roles, the tools, the commands and the timers |
| `hooks/board.ts` | Turns the state files into the board |
| `hooks/ui.tsx` | Draws the board, the bands and the tool rows |
| `hooks/scenarios.ts` | The preview's made-up states |
| `hooks/gallery.tsx` | Draws the preview's gallery pane |
| `hooks/mark.ts` | The band's animated mark: the spinner and the light, as Raster cells |
| `hooks/scratch.ts` | Reads the `.scratch` issues, and plans the issues of either tracker |
| `hooks/github.ts` | Reads the GitHub issues: the query, the tickets, their labels and blockers |
| `hooks/jira.ts` | Reads the Jira stories: the scope the tracker file names, the search, the epics, labels and blockers |
| `hooks/launch.ts` | The worker's command line, and the AppleScript that finds the orchestrator's window and opens the tab |
| `hooks/text.ts` | Everything the models read: tool descriptions, the worker's brief, the reminder |
| `types/index.d.ts` | The values orchestra keeps in `$.state` |
| `scripts/dev` | Starts a session with this checkout loaded, for hot reload and the preview |

## License

[MIT](LICENSE)
