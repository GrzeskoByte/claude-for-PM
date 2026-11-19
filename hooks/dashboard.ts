import type { PmPlan, PmTask } from '../types'
import { actualWindow, assigneeLabel, colorOf, fmtMin, planSpan, schedule, sprintName, STATUS_MARK } from './plan'

export type DashboardInput = { current: PmPlan | null; history: PmPlan[]; now: number }
/** widget: `<style>` + `<svg>` fragment only (no doctype/html/head/body), ready for show_widget. */
export type Dashboard = { widget: string; markdown: string }

const LABEL_W = 280
const CHART_W = 620
const WIDTH = LABEL_W + CHART_W + 20
const ROW_H = 22
const HEAD_H = 34
const SPRINT_H = 20
const TEXT_W = 50

// Hex stand-ins for the app's theme color keys (see colorOf in plan.ts).
const PALETTE: Record<string, string> = {
  claude: '#d77757',
  permission: '#4a8fe7',
  planMode: '#8a6fd6',
  ide: '#3aa39a',
  suggestion: '#d6a02c',
  merged: '#5aa34f',
  inactive: '#8a8a8a',
  autoAccept: '#c95c8a',
}
const FAILED = '#c0392b'
const RUN_CAP = 5

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
const fmtDate = (ts?: number) => (ts ? new Date(ts).toISOString().slice(0, 16).replace('T', ' ') : '–')
const barColor = (t: PmTask) => (t.status === 'failed' ? FAILED : PALETTE[colorOf(t.assignee)] ?? '#777')

/** Last RUN_CAP runs (oldest first): archived runs plus the current one, without a duplicate of the current one. */
export function orderedRuns({ current, history }: Pick<DashboardInput, 'current' | 'history'>): PmPlan[] {
  const past = history.filter(h => h.createdAt !== current?.createdAt)
  return [...past, ...(current ? [current] : [])].sort((a, b) => a.createdAt - b.createdAt).slice(-RUN_CAP)
}

/** Schedule of one run: tasks with plannedStart set, plus the run's span in minutes. */
function scheduleRun(p: PmPlan, now: number) {
  const tasks = schedule(p.tasks)
  const sched = { ...p, tasks }
  const actualEnd = Math.max(0, ...tasks.map(t => actualWindow(p, t, now)?.end ?? 0))
  return { tasks, span: Math.max(planSpan(sched), actualEnd, 1) }
}

function sprintNumbers(tasks: PmTask[]): number[] {
  return [...new Set(tasks.map(t => t.sprint))].sort((a, b) => a - b)
}

function tickStep(span: number): number {
  return [1, 5, 10, 15, 30, 60, 120, 240, 480, 960].find(s => span / s <= 8) ?? 1440
}

/** One run as SVG fragments starting at y0; returns the fragments and the height used. */
function runSvg(p: PmPlan, now: number, y0: number): { parts: string[]; height: number } {
  const { tasks, span } = scheduleRun(p, now)
  const x = (m: number) => LABEL_W + (m / span) * CHART_W
  const body: string[] = []
  let y = y0 + HEAD_H
  for (const n of sprintNumbers(tasks)) {
    body.push(`<text x="4" y="${y + 14}" class="sprint">${esc(sprintName(p.sprints, n))}</text>`)
    y += SPRINT_H
    for (const t of tasks.filter(k => k.sprint === n)) {
      const label = `${STATUS_MARK[t.status]} #${t.id} ${t.title} · ${assigneeLabel(t.assignee)}`
      body.push(`<text x="16" y="${y + 15}" class="task"><title>${esc(t.definition)}</title>${esc(label)}</text>`)
      const px = x(t.plannedStart)
      body.push(
        `<rect x="${px}" y="${y + 4}" width="${Math.max(2, x(t.plannedStart + t.estimateMin) - px)}" height="${ROW_H - 8}" fill="none" stroke="${barColor(t)}" stroke-dasharray="3 2" rx="2"/>`,
      )
      const w = actualWindow(p, t, now)
      if (w) {
        body.push(
          `<rect x="${x(w.start)}" y="${y + 6}" width="${Math.max(2, x(w.end) - x(w.start))}" height="${ROW_H - 12}" fill="${barColor(t)}" rx="2"><title>${esc(fmtMin(w.end - w.start))} actual</title></rect>`,
        )
      }
      y += ROW_H
    }
  }
  const axisY = y + 4
  const grid: string[] = []
  const step = tickStep(span)
  for (let m = 0; m <= span; m += step) {
    grid.push(`<line x1="${x(m)}" x2="${x(m)}" y1="${y0 + HEAD_H}" y2="${axisY}" class="grid"/>`)
    grid.push(`<text x="${x(m)}" y="${axisY + 14}" class="tick" text-anchor="middle">${fmtMin(m)}</text>`)
  }
  const head = [
    `<text x="4" y="${y0 + 16}" class="run">${esc(p.goal)}</text>`,
    `<text x="4" y="${y0 + 30}" class="meta">${esc(p.phase)} · ${fmtDate(p.startedAt ?? p.createdAt)} · ${tasks.length} tasks</text>`,
  ]
  return { parts: [...head, ...grid, ...body], height: axisY + 24 - y0 }
}

const CSS = `
body{font:13px system-ui,sans-serif;margin:16px;color:#222;background:#fff}
svg{max-width:100%;height:auto}
.run{font-weight:600;font-size:14px}.meta{fill:#666;font-size:11px}
.sprint{font-weight:600;font-size:12px;fill:#333}.task{font-size:12px;fill:#222}
.grid{stroke:#e2e2e2}.tick{font-size:10px;fill:#666}
@media (prefers-color-scheme:dark){body{color:#ddd;background:#1b1b1b}.task{fill:#ddd}.sprint{fill:#ccc}.meta{fill:#999}.grid{stroke:#444}.tick{fill:#999}}`

function ganttWidget(runs: PmPlan[], now: number): string {
  let y = 8
  const parts: string[] = []
  for (const p of runs) {
    const r = runSvg(p, now, y)
    parts.push(...r.parts)
    y += r.height + 16
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${Math.max(y, 40)}" width="${WIDTH}">${parts.join('')}</svg>`
  return `<style>${CSS}</style>${svg}`
}

/** Plain-text bar per task, for the markdown report. */
function asciiGantt(p: PmPlan, now: number): string {
  const { tasks, span } = scheduleRun(p, now)
  const W = 50
  const lines = tasks.map(t => {
    const s = Math.floor((t.plannedStart / span) * W)
    const e = Math.max(s + 1, Math.ceil(((t.plannedStart + t.estimateMin) / span) * W))
    const bar = ' '.repeat(s) + '█'.repeat(e - s)
    return `${(`#${t.id} ${t.title}`).slice(0, 24).padEnd(24)} |${bar.padEnd(W)}| ${STATUS_MARK[t.status]}`
  })
  return ['```text', ...lines, '```'].join('\n')
}

function runMarkdown(p: PmPlan, now: number): string {
  const { tasks } = scheduleRun(p, now)
  const endMs = Math.max(p.startedAt ?? 0, ...tasks.map(t => t.endedAt ?? 0), p.phase === 'running' ? now : 0)
  const wall = p.startedAt ? fmtMin((endMs - p.startedAt) / 60000) : '–'
  const out = [
    `## ${mdCell(p.goal)}`,
    `Phase: ${p.phase} · Started: ${fmtDate(p.startedAt)} · Wall time: ${wall} · Tasks: ${tasks.length} · Sprints: ${sprintNumbers(tasks).length}`,
    '',
    asciiGantt(p, now),
    '',
    '| # | Task | Sprint | Assignee | Status | Planned | Actual |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const t of tasks) {
    const w = actualWindow(p, t, now)
    out.push(
      `| #${t.id} | ${mdCell(t.title)} | ${mdCell(sprintName(p.sprints, t.sprint))} | ${mdCell(assigneeLabel(t.assignee))} | ${STATUS_MARK[t.status]} ${t.status} | ${fmtMin(t.plannedStart)}+${fmtMin(t.estimateMin)} | ${w ? fmtMin(w.end - w.start) : '–'} |`,
    )
  }
  const reports = tasks.filter(t => t.output)
  if (reports.length) {
    out.push('', '### Reports')
    for (const t of reports) out.push('', `**#${t.id} ${mdCell(t.title)}** (${t.status})`, '', (t.output ?? '').slice(0, 1500))
  }
  return out.join('\n')
}

/**
 * Gantt of the last RUN_CAP runs (sprint rows, planned dashed bars, actual filled
 * bars) as a style+svg widget fragment, and a markdown report of the same runs. Pure: no I/O, the caller supplies history and clock.
 */
export function buildDashboard(input: DashboardInput): Dashboard {
  const runs = orderedRuns(input)
  const now = input.now
  const markdown = [
    '# PM run report',
    `Runs: ${runs.length} (${runs.length - (input.current ? 1 : 0)} archived${input.current ? ' + current' : ''})`,
    '',
    ...runs.map(p => runMarkdown(p, now) + '\n'),
  ].join('\n')
  return { widget: ganttWidget(runs, now), markdown }
}
