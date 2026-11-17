# Claude mode for PM

**Plan sprints. Delegate to agents. Ship in parallel.**

Claude mode for PM turns a Claude Code session into a project manager. Describe what you want built; the orchestrator (Opus 5.5 by default) breaks it into short tasks, lays them out in sprints on a Gantt timeline, and gives each task to the agent and model that fits it best: a Claude subagent, or a local agent CLI such as Codex, Gemini, OpenCode or Grok. You review the plan, change anything you like, press **Start sprint**, and watch the agents work in parallel. When the run ends, every report flows back to the orchestrator to review, fix and plan the next sprint.

<p align="center">
  <img src="assets/intro.gif" alt="Intro: a goal becomes tasks, a Gantt timeline, model assignments, a parallel sprint run, and reports back to the orchestrator" width="960">
</p>

<p align="center"><a href="assets/intro.mp4"><b>▶ Watch the intro in full quality (MP4, 36 s)</b></a></p>

## Why

Big changes are rarely one task. They are a handful of pieces, some of which can happen at the same time, each suited to a different model. Claude mode for PM makes that structure visible and runnable:

- **See the plan before anything runs.** Every task has a concise description, an estimate, a sprint and the tasks it waits for.
- **Put the right model on each task.** Opus for hard reasoning, Sonnet for most implementation, Haiku for quick, mechanical work, or an external agent you already use.
- **Run independent work at the same time.** Tasks start as soon as what they wait for is done; sprints run one after another.
- **Keep one orchestrator in charge.** Reports come back to the session's orchestrator, which checks the work and re-plans what failed.

## How it works

1. **Describe the goal** in the normal prompt box while PM mode is on (`/pm`).
2. **The orchestrator plans it**: short tasks, estimates, sprints, dependencies, and an agent and model for each task.
3. **Review on the timeline**: click any task to open it in a dialog and change its model, estimate, sprint or dependencies; use **Assign all** to hand a whole sprint to one model.
4. **Start sprint**: Claude tasks run as Claude Code subagents, other tasks run headless in their CLI, in parallel where the plan allows.
5. **Reports return** to the orchestrator, which reviews them and plans the next sprint. Failed tasks can get another model and **Retry failed**.

## The panel

| Section | What it holds |
| --- | --- |
| **Project** | The goal and its status, the **orchestrator** picker (Opus 5.5, Sonnet 5.5 or Haiku 5.5), **Agents**, and **Start sprint**, which becomes **Stop** while running and **Retry failed** after failures. |
| **Timeline** | A Jira-style Gantt chart grouped by sprint or by agent, or a **Board** with To do / Running / Done / Failed columns. Bars wear their model's color until they finish, then green, red or grey. |
| **Tasks** | One line per task with its status and a model picker. |
| **Task dialog** | Opens when you click a task: Assignment, Schedule, Description and Result sections, with previous / next task links. |
| **Agents** | The agent CLIs found on this computer and their models, sign-in for each (browser, device code or API key), and whether external agents may only edit files or run anything. |

Everything uses the app's own theme colors, so it follows light and dark mode.

## Agents and models

- **Claude Code subagents**: Opus 5.5, Sonnet 5.5, Haiku 5.5, and any subagent type in `~/.claude/agents` or the project's `.claude/agents`.
- **Codex**, **Gemini**, **OpenCode** and **Grok**: detected automatically when installed, with the models each one lists. Tasks given to them run headless in the current working directory.

## Commands

| Command | What it does |
| --- | --- |
| `/pm` | Turns PM mode on and opens the panel. |
| `/pm <goal>` | Turns PM mode on and starts planning that goal. |
| `/pm agents` | Shows the agents on this computer and their sign-in state. |
| `/pm off` | Turns PM mode off; the plan stays on the board. |
| `/pm clear` | Removes the plan. |

## Install

At the prompt of a terminal session:

```
/plugin install pm-mode --marketplace GrzeskoByte/claude-for-PM
```

From a shell:

```bash
claude plugin install pm-mode --marketplace GrzeskoByte/claude-for-PM
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `GrzeskoByte/claude-for-PM`, then **Add plugin**.

Answer `y` to add the marketplace, then pick the user scope so the mod is on in every session.

## The intro video is code

`assets/intro.mp4` and `assets/intro.gif` are drawn frame by frame by [`video/render.js`](video/render.js) with `@napi-rs/canvas` and piped into ffmpeg. To render them again (needs Node and ffmpeg; the script loads Noto Sans, Noto Sans Symbols and JetBrains Mono from `/usr/share/fonts`):

```bash
cd video && npm install && npm run mp4 && npm run gif
```
