# side-pane

A side pane for the Claude Code CLI. It shows:

- **Status:** the working directory, git branch, model, context-window meter, rate-limit meters (on a subscription), session cost, and turn count. These refresh after every turn and every 15 seconds.
- **Plan:** the agent's live todo list, built from its `TodoWrite` / `TaskCreate` / `TaskUpdate` calls: `[x]` done, `[>]` in progress, `[ ]` pending.
- **A cat:** it sits and winks every few seconds, and runs across the pane while Claude is working.

```
╭──────────────────────────────────────╮
│ ~/projects/my-app                    │
│ main                                 │
│ claude-opus-5-5                      │
│                                      │
│ ctx   ███░░░░░░░ 31%                 │
│ cost  $0.42                          │
│ turns 3                              │
│                                      │
│ Plan  1/3                            │
│ [x] Read the config                  │
│ [>] Writing the parser               │
│ [ ] Run the tests                    │
│                                      │
│    /\_/\                             │
│   ( o.o )                            │
│    > ^ <                             │
│   /|   |\                            │
│  (_|   |_)~                          │
╰──────────────────────────────────────╯
```

The mod uses no model tokens. It never calls the model and adds nothing to what Claude reads; the figures are ones Claude Code already tracks for its status line.

## Install

Type this at the prompt of a Claude Code session in a terminal:

```
/plugin install side-pane --marketplace bobbymac/claude-side-pane
```

Answer `y` to add the marketplace, then press Enter to install at the user scope. The pane is active from then on.

To try it in a single session without installing it, clone the repository and run:

```bash
claude --plugin-dir ./claude-side-pane
```

## Use

- The pane opens on your first prompt. Type `/side` to open it at any time, or to reopen it after `Esc` closes it.
- It docks on the right in Claude Code's fullscreen layout when the terminal is 110 columns wide or more. Otherwise it sits above the prompt. Widen or maximise the window to get the sidebar.
- **Optional:** if you'd rather not see the figures twice, make your own status line script print nothing while the pane is in use.

## Requirements

Claude Code 2.1.295 or newer, which has the function-hooks plugin API. The plugin API is early access and may change between releases.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

The tests in `hooks/side.test.tsx` cover the status figures, the plan, the wink, and the run.
