import type { Assignee, DetectedAgent, Engine, PmPlan, PmSprint, PmTask, TaskStatus } from '../types'

// `alias` is what the subagent launcher takes: it refuses full model ids.
export const CLAUDE_MODELS: { id: string; label: string; alias: string }[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', alias: 'opus' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', alias: 'sonnet' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', alias: 'haiku' },
]
export const DEFAULT_ASSIGNEE: Assignee = { engine: 'claude', model: 'claude-opus-5-5' }
export const ENGINES: Engine[] = ['claude', 'codex', 'gemini', 'opencode', 'grok']
export const ENGINE_LABEL: Record<Engine, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  grok: 'Grok',
}

// Theme color keys, so bars follow the app's own (light or dark) color scheme.
const MODEL_COLOR: Record<string, string> = {
  'claude-opus-5-5': 'claude',
  'claude-sonnet-5-5': 'permission',
  'claude-haiku-5-5': 'planMode',
}
const ENGINE_COLOR: Record<Engine, string> = {
  claude: 'claude',
  codex: 'ide',
  gemini: 'suggestion',
  opencode: 'merged',
  grok: 'inactive',
}

export const TERMINAL: TaskStatus[] = ['done', 'failed', 'cancelled']
export const isTerminal = (t: PmTask) => TERMINAL.includes(t.status)

export function modelLabel(a: Assignee): string {
  if (a.engine === 'claude') return CLAUDE_MODELS.find(m => m.id === a.model)?.label ?? a.model
  return a.model === 'default' ? `${ENGINE_LABEL[a.engine]} (default)` : a.model
}

export function assigneeLabel(a: Assignee): string {
  if (a.engine === 'claude') {
    const type = a.agentType && a.agentType !== 'general-purpose' ? ` · ${a.agentType}` : ''
    return `${modelLabel(a)}${type}`
  }
  return `${ENGINE_LABEL[a.engine]} · ${a.model}`
}

export function colorOf(a: Assignee): string {
  return (a.engine === 'claude' && MODEL_COLOR[a.model]) || ENGINE_COLOR[a.engine]
}

export const assigneeKey = (a: Assignee) => `${a.engine}|${a.model}`

export function parseAssigneeKey(key: string, prev: Assignee): Assignee {
  const [engine, ...rest] = key.split('|')
  const model = rest.join('|')
  if (!ENGINES.includes(engine as Engine) || !model) return prev
  return engine === 'claude'
    ? { engine: 'claude', model, agentType: prev.engine === 'claude' ? prev.agentType : undefined }
    : { engine: engine as Engine, model }
}

/** Every engine|model pair that is installed, for the reassign pickers. */
export function assigneeOptions(agents: DetectedAgent[]): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = CLAUDE_MODELS.map(m => ({
    value: `claude|${m.id}`,
    label: `Claude · ${m.label}`,
  }))
  for (const ag of agents) {
    if (ag.engine === 'claude' || !ag.isInstalled) continue
    for (const m of ag.models) out.push({ value: `${ag.engine}|${m}`, label: `${ag.label} · ${m}` })
  }
  return out
}

/**
 * Lays tasks on the timeline: sprints run one after another, and inside a
 * sprint a task starts once every task it depends on has ended, so tasks
 * without a dependency between them overlap (run in parallel).
 */
export function schedule(tasks: PmTask[]): PmTask[] {
  const byId = new Map(tasks.map(t => [t.id, t]))
  const end = new Map<string, number>()
  const sprints = [...new Set(tasks.map(t => t.sprint))].sort((a, b) => a - b)
  let sprintStart = 0
  const visiting = new Set<string>()
  const startOf = (t: PmTask, floor: number): number => {
    if (end.has(t.id)) return end.get(t.id)! - t.estimateMin
    if (visiting.has(t.id)) return floor
    visiting.add(t.id)
    let s = floor
    for (const d of t.dependsOn) {
      const dep = byId.get(d)
      if (!dep || dep.sprint > t.sprint) continue
      s = Math.max(s, dep.sprint < t.sprint ? (end.get(d) ?? floor) : startOf(dep, floor) + dep.estimateMin)
    }
    visiting.delete(t.id)
    end.set(t.id, s + t.estimateMin)
    return s
  }
  const out = new Map<string, PmTask>()
  for (const n of sprints) {
    let sprintEnd = sprintStart
    for (const t of tasks.filter(x => x.sprint === n)) {
      const s = startOf(t, sprintStart)
      out.set(t.id, { ...t, plannedStart: s })
      sprintEnd = Math.max(sprintEnd, s + t.estimateMin)
    }
    sprintStart = sprintEnd
  }
  return tasks.map(t => out.get(t.id) ?? t)
}

export const planSpan = (p: PmPlan) => Math.max(1, ...p.tasks.map(t => t.plannedStart + t.estimateMin))

/** Most tasks planned to run at the same minute. */
export function maxParallel(p: PmPlan): number {
  let best = 0
  for (const t of p.tasks) {
    const at = t.plannedStart
    best = Math.max(best, p.tasks.filter(o => o.plannedStart <= at && at < o.plannedStart + o.estimateMin).length)
  }
  return best
}

/** Minutes from the run's start for a running or finished task, else undefined. */
export function actualWindow(p: PmPlan, t: PmTask, now: number): { start: number; end: number } | undefined {
  if (!p.startedAt || !t.startedAt) return undefined
  const start = (t.startedAt - p.startedAt) / 60000
  const end = ((t.endedAt ?? now) - p.startedAt) / 60000
  return { start, end: Math.max(end, start + 0.05) }
}

export function sprintName(sprints: PmSprint[], n: number): string {
  return sprints.find(s => s.n === n)?.name ?? `Sprint ${n}`
}

export const STATUS_MARK: Record<TaskStatus, string> = {
  todo: '○',
  running: '◐',
  done: '✓',
  failed: '✗',
  cancelled: '–',
}

export function fmtMin(m: number): string {
  // Real runs often take under a minute: show seconds rather than "0m".
  if (m > 0 && m < 1) return `${Math.max(1, Math.round(m * 60))}s`
  if (m < 60) return `${Math.round(m)}m`
  const h = Math.floor(m / 60)
  const r = Math.round(m % 60)
  return r ? `${h}h${r}m` : `${h}h`
}

/** The prompt a delegated agent (Claude subagent or external CLI) runs with. */
export function taskPrompt(p: PmPlan, t: PmTask): string {
  const deps = p.tasks.filter(d => t.dependsOn.includes(d.id))
  const depNotes = deps
    .map(d => `- #${d.id} ${d.title}: ${(d.output ?? '').slice(0, 1500) || '(no report)'}`)
    .join('\n')
  return [
    `You are a delegated agent working on task #${t.id} of a sprint plan made by the Opus orchestrator.`,
    `Overall goal: ${p.goal}`,
    `Your task: ${t.title}`,
    '',
    t.definition,
    depNotes ? `\nTasks you depend on have finished. Their reports:\n${depNotes}` : '',
    '',
    'Do only this task, in the current working directory. Do not start other tasks of the plan.',
    'End with a short report: what you changed (files), how you verified it, and anything left open.',
  ].join('\n')
}
