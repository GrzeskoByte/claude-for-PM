# Claude mode for PM

A Claude Code mod that turns the session into a project-manager orchestrator. You describe a goal in the normal prompt box; the orchestrator (Opus 5.5 by default, or Sonnet / Haiku) splits it into short tasks, schedules them into sprints, and assigns an agent and model to each one. The plan appears in a panel beside the chat, and **Start sprint** runs it: tasks start as soon as the tasks they wait for and earlier sprints are done, in parallel where possible. When the run ends, every report goes back to the orchestrator to review and re-plan.

Agents a task can run on:

- **Claude Code subagents**: Opus 5.5, Sonnet 5.5, Haiku 5.5, and any subagent type in `~/.claude/agents` or the project's `.claude/agents`.
- **Local agent CLIs** found on your computer: Codex, Gemini, OpenCode and Grok, each with its own models. Sign in to them from the panel's **Agents** section.

## The panel

- **Project**: the goal, its status, the orchestrator picker, Agents, and Start sprint / Stop / Retry failed.
- **Timeline**: a Jira-style Gantt chart by sprint or by agent, or a Board with To do / Running / Done / Failed columns. Bars take their model's color until they finish.
- **Tasks**: one line per task with its status and a model picker. Click any task (bar, row or card) to open it in a dialog with its assignment, schedule, description and result.

## Commands

- `/pm` turns PM mode on and opens the panel; `/pm <goal>` also starts planning that goal.
- `/pm agents` shows the agents on this computer; `/pm off` turns the mode off; `/pm clear` removes the plan.

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
