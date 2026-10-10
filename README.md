# orchestra

A Claude Code plugin that works through a backlog of Markdown issues for you. It starts one unattended **worker** session per issue, each in its own Ghostty tab. The session that started it, the **orchestrator**, is told when the worker reports. It then checks the commits and starts the next issue.

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

1. **Write issues** in `.scratch/<feature>/issues/`, one file per issue (see [Issues](#issues)).
2. **Run `/orchestrate`** in a Claude Code session in the repo. It puts a `/goal …` in the prompt box. Press Enter.
3. **Watch the board** with `/orchestra`, or just follow the band above the prompt.

The orchestrator loops: it dispatches a worker, waits for its report, checks its commits, then starts the next issue. It stops when no issue can start any more. To run a single issue, use `/dispatch 03`.

## Issues

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

## Commands and tools

| Command | What it does |
|---|---|
| `/orchestrate [feature]` | Puts a `/goal …` in the prompt box that works every issue, or one feature's |
| `/dispatch [issue] [--force]` | Starts one worker. Without an issue, it takes the next one that can start. `--force` starts an issue that can't start, or starts on a working tree with uncommitted changes |
| `/orchestra` | Opens the board |

An issue can be named by its number (`03`), its slug (`03-login-form`), `<feature>/<number>` (`login/03`), or its path.

**The model's tools:** an orchestrator gets `mcp__orchestra__issues`, `mcp__orchestra__dispatch` and `mcp__orchestra__wait`. A worker gets `mcp__orchestra__report` instead, with outcome `done`, `blocked` or `failed`.

## What you see

| Where | What |
|---|---|
| **Board** (`/orchestra`) | Every issue by feature, marked ✓ done, ◐ running, ○ can start, ⏸ held or · waiting. Under them, the running worker and the last five jobs. Buttons: **Dispatch next** (`n`), **Start** on an issue that can start, **Focus tab** (`f`) and **Abandon** on the running worker, **Release** on a held issue |
| **Band above the prompt** | While a worker runs: its issue, minutes, tool count and latest tool call, with **Board** and **Focus tab** |
| **Status line** | `orchestra · 03-login-form · 4m · Edit src/login.ts` |
| **Tool rows** | A running `wait` shows the worker's heartbeat. A report shows as a card: outcome, commits, issue, working tree, what's next, and the summary |

## How it behaves

- **One worker at a time,** on the current branch. `dispatch` refuses to start while the working tree has uncommitted changes, unless forced.
- **Workers are briefed** not to ask questions, to commit, to set the issue's Status, and to call `report` last.
- **A worker that stops without reporting** is reminded twice, then marked stalled. A turn that ends while the worker's own agents still run doesn't count.
- **Held issues:** once a worker finishes an issue, orchestra doesn't dispatch that issue again until its file changes. This stops it from retrying a blocked issue in a loop. **Release** on the board lets the issue go without a change to the file.
- **Abandon** stops tracking the worker. Its Ghostty tab keeps running, so close it there.
- **Late reports count.** A worker can still report after it was marked stalled or abandoned, or after its session exited. The board shows it (`stalled, then reported done`), and the orchestrator's next `wait` returns it.
- **Waking up:** `wait` blocks for up to 10 minutes at a time. If the orchestrator is idle when its worker reports, orchestra submits the report as a new prompt and sends a desktop notification.
- **The heartbeat:** every 5 seconds, the worker writes its latest tool call (and its agents') to a file, and the orchestrator updates the board.

## Settings

Change these in `/config`, or when you install.

| Setting | Default | What it sets |
|---|---|---|
| `workerPrompt` | `/mattpocock-skills:implement {issue}` | The worker's first prompt. `{issue}` becomes the issue's path; without it, the path is added at the end |
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

Run a checkout instead of the installed plugin:

```sh
claude --plugin-dir .
```

That first load also writes Claude Code's types to `.claude-plugin/types/`, which git ignores. The type check needs them.

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
| `hooks/ui.tsx` | Draws the board, the band and the tool rows |
| `hooks/scratch.ts` | Reads and plans the issues |
| `hooks/launch.ts` | The worker's command line and the AppleScript that opens its tab |
| `hooks/text.ts` | Everything the models read: tool descriptions, the worker's brief, the reminder |
| `types/index.d.ts` | The values orchestra keeps in `$.state` |

## License

[MIT](LICENSE)
