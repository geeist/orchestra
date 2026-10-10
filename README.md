# orchestra

Works the issues in `.scratch/<feature>/issues/` one at a time. Each issue runs in an unattended Claude Code **worker** session in a new Ghostty tab. The session that started it, the **orchestrator**, is told when the worker reports.

## How it loads

- **Personal projects only.** The `claude` function in `zsh/aliases.sh` sets `CLAUDE_CODE_PLUGIN_DIRS` to `claude/mods` on its personal branch, so every mod folder there loads.
- **Workers load it the same way.** The worker's tab types `claude …` into your interactive shell, so the same function runs. `dispatch` never passes `--plugin-dir`.
- **Edits reload by themselves** in interactive sessions (the folder is watched).
- **Check it:** `claude plugin validate claude/mods/orchestra` and `claude plugin test claude/mods/orchestra`.

## Use

| What | How |
|---|---|
| **Run everything** | `/orchestrate [feature]` puts a `/goal …` in the prompt box. Press Enter. The model then loops: `dispatch` → `wait` → check the commits → next |
| **One issue** | `/dispatch [issue] [--force]`. Without an issue, it takes the next one that can start |
| **Watch it** | `/orchestra` opens the board, see below |
| **Tools (orchestrator)** | `mcp__orchestra__issues`, `mcp__orchestra__dispatch`, `mcp__orchestra__wait` |
| **Tool (worker)** | `mcp__orchestra__report` with outcome `done`, `blocked` or `failed` |

## What you see

| Where | What |
|---|---|
| **Board** (`/orchestra`, a pane) | Every issue by feature with its tone (✓ done, ◐ running, ○ can start, ⏸ held, · waiting), the running worker and the last five jobs. Buttons: **Dispatch next** (`n`), **Start** on an issue that can start, **Focus tab** (`f`) and **Abandon** on the running worker, **Release** on a held issue |
| **Band above the prompt** | While a worker runs: its issue, minutes, tool count and latest tool call, with **Board** and **Focus tab** |
| **Status line** | `orchestra · 07-docs · 4m · Edit docs/tech.md` |
| **Tool rows** | A `wait` that runs shows the worker's heartbeat under it. A report draws as a card: outcome, commits, issue, tree, next, summary. `issues` draws as a list with tones |

- **Abandon** stops tracking the worker. Its Ghostty tab keeps running: close it there. A report it sends later counts as late.
- **Release** lets a held issue go without an edit to its file.
- **The heartbeat:** the worker writes its latest tool call (its agents' too) to its file every 5 seconds. The orchestrator rebuilds the board every 5 seconds.

## Rules

- **An issue can start** when its Status is `ready-for-agent`, it is not done, and every issue on its Blocked by line is done.
- **Done** means Status `done`/`resolved`/`closed`/`wontfix`, or every checkbox ticked.
- **One worker at a time**, on the current branch. `dispatch` refuses a dirty working tree unless forced.
- **Held issues:** after a worker finishes, its issue is not dispatched again until the issue file changes. This prevents a loop on a blocked issue.
- **Workers are told** not to ask questions, to set Status `done`/`needs-info`/`ready-for-human`, to commit, and to call `report` last. A worker that stops without reporting is reminded twice, then marked stalled. A turn that ends while the worker's agents still run is not counted: their notification starts its next turn.
- **Late reports:** a worker can still report after it was marked stalled, exited, never-started or abandoned. The board shows it (`stalled, then reported done`), the dispatching session gets a notification, and its next `wait` returns the late report.
- **Waking up:** `wait` blocks in chunks of up to 10 minutes (it's a polling loop). If the orchestrator is idle when its worker finishes, the mod submits the report as a new prompt and sends a desktop notification.

## Settings (`/config`)

- `workerPrompt`: default `/mattpocock-skills:implement {issue}`
- `permissionMode`: default `auto`
- `model`: empty keeps your default

## Where state lives

`<git common dir>/orchestra/`: `<job>.job.json` (orchestrator: outcome, `late`, `releasedAt`), `<job>.worker.json` (worker: state, report, heartbeat), `<job>.brief.md` (the worker's appended system prompt). Delete the folder to forget all jobs.

The drawings read `$.state` (`orchestra.board`, and `orchestra.shown` per tool call), declared in `types/index.d.ts`. `hooks/board.ts` turns the files into the board; `hooks/ui.tsx` draws it; `hooks/register.tsx` wires both.
