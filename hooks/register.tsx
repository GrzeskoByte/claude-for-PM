import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentHealth, Assignee, Autonomy, DetectedAgent, Engine, GroupBy, PmPlan, PmSprint, PmTab, PmTask, SigninState, SprintEdit, TaskStatus } from '../types'
import { opencodeDefaultModel, ACCOUNT_FAILURE, applyHealth, argvFor, detectAgents, failureReason, installArgv, opencodeMethod, signinArgv, testArgv } from './agents'
import { CLAUDE_MODELS, DEFAULT_ASSIGNEE, ENGINES, assigneeLabel, parseAssigneeKey, schedule, taskPrompt } from './plan'
import { PmView, TaskDialog } from './view'
import type { ViewActions } from './view'

export const PANE = 'pm-mode'
export const TITLE = 'Claude mode for PM'
const TASK_PANE = 'pm-task'

// Ask for the widest dock the surface allows; a width the person drags the pane to wins.
const PANE_ARGS = { id: PANE, title: TITLE, columns: 400 }

export const isOnAtom = atom({ plugin: 'pm-mode', key: 'isOn' } as const, false)
export const planAtom = atom({ plugin: 'pm-mode', key: 'plan' } as const, null as PmPlan | null)
export const tabAtom = atom({ plugin: 'pm-mode', key: 'tab' } as const, 'timeline' as PmTab)
export const agentsAtom = atom({ plugin: 'pm-mode', key: 'agents' } as const, [] as DetectedAgent[])
export const selectedAtom = atom({ plugin: 'pm-mode', key: 'selected' } as const, null as string | null)
export const nowAtom = atom({ plugin: 'pm-mode', key: 'now' } as const, 0)
export const autonomyAtom = atom({ plugin: 'pm-mode', key: 'autonomy' } as const, 'edit' as Autonomy)
export const groupByAtom = atom({ plugin: 'pm-mode', key: 'groupBy' } as const, 'task' as GroupBy)
export const collapsedAtom = atom({ plugin: 'pm-mode', key: 'collapsed' } as const, [] as number[])
export const showAgentsAtom = atom({ plugin: 'pm-mode', key: 'showAgents' } as const, false)
export const signinAtom = atom({ plugin: 'pm-mode', key: 'signin' } as const, null as SigninState | null)
export const keyForAtom = atom({ plugin: 'pm-mode', key: 'keyFor' } as const, null as Engine | null)
export const sprintEditAtom = atom({ plugin: 'pm-mode', key: 'sprintEdit' } as const, null as SprintEdit | null)
export const showReportAtom = atom({ plugin: 'pm-mode', key: 'showReport' } as const, false)
export const orchestratorAtom = atom({ plugin: 'pm-mode', key: 'orchestrator' } as const, 'claude-opus-5-5')
export const testingAtom = atom({ plugin: 'pm-mode', key: 'testing' } as const, [] as Engine[])

const PLAN_TOOL = 'mcp__pm-mode__pm_plan'
const STATUS_TOOL = 'mcp__pm-mode__pm_status'
const STORE_PLAN = 'plan'
const STORE_HISTORY = 'history'
const HISTORY_CAP = 50
const STORE_AUTONOMY = 'autonomy'
const STORE_ORCHESTRATOR = 'orchestrator'
const STORE_HEALTH = 'health'
const OUTPUT_CAP = 20000

// Subagent answers that arrived before their spawn call returned its agentId.
const earlyAnswers = new Map<string, { answer: string; isOk: boolean }>()
// External CLI runs to abandon (Stop pressed).
const cancelled = new Set<string>()
let stopTicker: (() => void) | undefined
// The sign-in process running now, if any (one at a time).
let signinStream: AsyncGenerator<unknown, unknown> | undefined

const PLAN_SCHEMA = {
  type: 'object',
  required: ['goal', 'tasks'],
  properties: {
    goal: { type: 'string', description: "The user's request, restated in one line." },
    sprints: {
      type: 'array',
      description: 'Sprints run one after another; tasks inside a sprint run in parallel unless dependsOn orders them.',
      items: {
        type: 'object',
        required: ['n', 'name'],
        properties: { n: { type: 'integer', minimum: 1 }, name: { type: 'string' } },
      },
    },
    tasks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'title', 'definition', 'estimateMin', 'engine', 'model'],
        properties: {
          id: { type: 'string', description: 'T1, T2, ...' },
          title: { type: 'string', description: 'A few words.' },
          definition: {
            type: 'string',
            maxLength: 280,
            description:
              'Really concise: one or two short sentences (under 280 characters) saying what to do, which files, and how to tell it is done. The agent also gets the goal and the reports of the tasks it waits for, and can read the code itself.',
          },
          sprint: { type: 'integer', minimum: 1, default: 1 },
          estimateMin: { type: 'number', minimum: 1, description: 'Estimated agent working time in minutes.' },
          dependsOn: { type: 'array', items: { type: 'string' }, description: 'Ids of tasks that must finish first.' },
          engine: { type: 'string', enum: ENGINES, description: 'Which agent runs it.' },
          model: { type: 'string', description: "A model id that engine lists, or 'default'." },
          agentType: { type: 'string', description: 'For engine claude: the subagent type (default general-purpose).' },
        },
      },
    },
  },
}

type PlanInput = {
  goal?: string
  sprints?: PmSprint[]
  tasks?: {
    id?: string
    title?: string
    definition?: string
    sprint?: number
    estimateMin?: number
    dependsOn?: string[]
    engine?: string
    model?: string
    agentType?: string
  }[]
}

async function orchestratorBrief($: EngineInterface): Promise<string> {
  const agents = await read($, agentsAtom)
  const orchestrator = await read($, orchestratorAtom)
  const lines = agents
    .filter(a => a.isInstalled)
    .map(a => {
      const models = a.engine === 'claude' ? CLAUDE_MODELS.map(m => m.id) : a.models
      const shown = models.length > 25 ? `${models.slice(0, 25).join(', ')}, ... (${models.length} in all)` : models.join(', ')
      const types = a.agentTypes.length ? `; agent types: ${a.agentTypes.join(', ')}` : ''
      const state =
        a.auth === 'failing'
          ? ` — CANNOT RUN right now (${a.failReason ?? 'its last run was refused'}); do not assign it`
          : a.auth === 'missing'
            ? ' — not signed in; do not assign it'
            : a.auth === 'unverified'
              ? ' — signed in, not tested yet'
              : ''
      return `- engine "${a.engine}" (${a.label}): models ${shown}${types}${a.note ? ` — ${a.note}` : ''}${state}`
    })
  return [
    '# Claude mode for PM is on',
    `You are the orchestrator and project manager (running on ${CLAUDE_MODELS.find(m => m.id === orchestrator)?.label ?? orchestrator}). For each new request from the user, do not do the work yourself. Instead:`,
    '1. Define the tasks: split the request into concrete tasks (read the code first where you need to, so definitions name real files). Keep it really concise: titles of 4 words or fewer, definitions of about 12 words (hard limit 280 characters), no background the agent can read in the code.',
    '2. Build the timeline: estimate each task in agent-minutes, group tasks into sprints, and set dependsOn so independent tasks can run in parallel.',
    '3. Assign an agent and model to each task: Opus for hard reasoning/architecture, Sonnet for most implementation, Haiku for search/boilerplate/docs, and external agents where they fit or where the user asks for them.',
    `4. Call the ${PLAN_TOOL} tool with the whole plan. It is drawn as a Gantt chart and board in the PM pane, where the user reviews it, reassigns models per task or per sprint, and approves.`,
    '5. Then stop and wait. The pane runs the approved tasks (in parallel where the chart allows) and sends you every report when the run ends; review them, fix or re-plan what failed (call the tool again for a follow-up sprint), and report to the user.',
    `Use ${STATUS_TOOL} to read the current plan and task reports at any time.`,
    'Agents available on this computer:',
    ...(lines.length ? lines : ['- engine "claude" (Claude Code): claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5']),
  ].join('\n')
}

function toPlan(input: PlanInput, available: Set<Engine>): PmPlan | string {
  if (!input.tasks?.length) return 'The plan needs at least one task.'
  const ids = new Set<string>()
  const tasks: PmTask[] = []
  for (const [i, raw] of input.tasks.entries()) {
    const id = String(raw.id ?? `T${i + 1}`).replace(/^#/, '')
    if (ids.has(id)) return `Task id ${id} is used twice.`
    ids.add(id)
    const engine = ENGINES.includes(raw.engine as Engine) && available.has(raw.engine as Engine) ? (raw.engine as Engine) : 'claude'
    let assignee: Assignee =
      engine === 'claude'
        ? { engine, model: CLAUDE_MODELS.some(m => m.id === raw.model) ? raw.model! : DEFAULT_ASSIGNEE.model, agentType: raw.agentType }
        : { engine, model: raw.model || 'default' }
    if (engine === 'claude' && raw.model && !CLAUDE_MODELS.some(m => m.id === raw.model)) {
      const alias = CLAUDE_MODELS.find(m => raw.model!.toLowerCase().includes(m.label.split(' ')[0]!.toLowerCase()))
      if (alias) assignee = { ...assignee, model: alias.id }
    }
    tasks.push({
      id,
      title: String(raw.title ?? id),
      definition: String(raw.definition ?? raw.title ?? ''),
      sprint: Math.max(1, Math.round(raw.sprint ?? 1)),
      estimateMin: Math.max(1, Number(raw.estimateMin) || 10),
      dependsOn: (raw.dependsOn ?? []).map(d => String(d).replace(/^#/, '')),
      assignee,
      status: 'todo',
      plannedStart: 0,
    })
  }
  for (const t of tasks) t.dependsOn = t.dependsOn.filter(d => ids.has(d) && d !== t.id)
  return {
    goal: String(input.goal ?? 'Untitled plan'),
    sprints: input.sprints ?? [],
    tasks: schedule(tasks),
    phase: 'review',
    createdAt: Date.now(),
  }
}

async function savePlan($: EngineInterface, change: (p: PmPlan | null) => PmPlan | null): Promise<PmPlan | null> {
  const next = await update($, planAtom, change)
  await $.store.set(STORE_PLAN, next)
  return next
}

/** Archived plans are kept per project directory (the session cwd), newest last. */
const historyKey = async ($: EngineInterface) => `${STORE_HISTORY}:${await $.session.cwd()}`

export async function readHistory($: EngineInterface): Promise<PmPlan[]> {
  const list = await $.store.get(await historyKey($))
  return Array.isArray(list) ? (list as PmPlan[]) : []
}

/** Add a plan to this directory's history; a plan already archived (same createdAt) is replaced, not duplicated. */
export async function archivePlan($: EngineInterface, plan: PmPlan | null | undefined): Promise<void> {
  if (!plan || plan.tasks.length === 0) return
  const rest = (await readHistory($)).filter(p => p.createdAt !== plan.createdAt)
  await $.store.set(await historyKey($), [...rest, plan].slice(-HISTORY_CAP))
}

const patchTask = ($: EngineInterface, id: string, patch: Partial<PmTask>) =>
  savePlan($, p => p && { ...p, tasks: p.tasks.map(t => (t.id === id ? { ...t, ...patch } : t)) })

async function finishTask($: EngineInterface, id: string, status: TaskStatus, output: string) {
  await patchTask($, id, { status, output: output.slice(-OUTPUT_CAP), endedAt: Date.now() })
  await pump($)
}

async function startClaude($: EngineInterface, p: PmPlan, t: PmTask) {
  const spawned = await $.agent.spawn({
    prompt: taskPrompt(p, t),
    description: `#${t.id} ${t.title}`.slice(0, 60),
    subagentType: t.assignee.agentType || 'general-purpose',
    model: CLAUDE_MODELS.find(m => m.id === t.assignee.model)?.alias ?? t.assignee.model,
  })
  if ('deny' in spawned && spawned.deny) return finishTask($, t.id, 'failed', `Not started: ${spawned.deny}`)
  const agentId = 'agentId' in spawned ? spawned.agentId : undefined
  if (!agentId) return finishTask($, t.id, 'failed', 'Not started: no agent id came back.')
  await patchTask($, t.id, { agentId })
  const early = earlyAnswers.get(agentId)
  if (early) {
    earlyAnswers.delete(agentId)
    await finishTask($, t.id, early.isOk ? 'done' : 'failed', early.answer)
  }
}

async function startExternal($: EngineInterface, p: PmPlan, t: PmTask) {
  const autonomy = await read($, autonomyAtom)
  const noModel = !t.assignee.model || t.assignee.model === 'default'
  const assignee = t.assignee.engine === 'opencode' && noModel ? { ...t.assignee, model: (await opencodeDefaultModel($)) ?? 'default' } : t.assignee
  const argv = argvFor(assignee, taskPrompt(p, t), autonomy)
  let out = ''
  let code: number | null = null
  try {
    // Closed stdin: `codex exec` otherwise waits on it forever.
    const stream = $.process.spawn({ argv, input: '' })
    for (;;) {
      const piece = await stream.next()
      if (piece.done) {
        code = piece.value?.code ?? null
        break
      }
      out = (out + piece.value.text).slice(-OUTPUT_CAP)
      if (cancelled.has(t.id)) {
        await stream.return(undefined as never)
        cancelled.delete(t.id)
        return finishTask($, t.id, 'cancelled', `${out}\n\n(stopped by the user)`)
      }
    }
  } catch (err) {
    return finishTask($, t.id, 'failed', `${out}\n\nCould not run ${argv[0]}: ${String(err)}`)
  }
  // A real run is the best health check there is: remember what it showed.
  if (code === 0) await recordHealth($, t.assignee.engine, { ok: true, at: Date.now() })
  else if (ACCOUNT_FAILURE.test(out)) await recordHealth($, t.assignee.engine, { ok: false, reason: failureReason(out), at: Date.now() })
  await finishTask($, t.id, code === 0 ? 'done' : 'failed', code === 0 ? out : `${out}\n\n(exit code ${code})`)
}

/** Starts every task whose dependencies and earlier sprints are done; ends the run when nothing is left. */
async function pump($: EngineInterface): Promise<void> {
  let toStart: PmTask[] = []
  let finished = false
  const p = await savePlan($, plan => {
    toStart = []
    finished = false
    if (!plan || plan.phase !== 'running') return plan
    const now = Date.now()
    let tasks = plan.tasks
    // A task whose dependency failed cannot run.
    for (let changed = true; changed; ) {
      changed = false
      tasks = tasks.map(t => {
        if (t.status !== 'todo') return t
        const bad = t.dependsOn.find(d => {
          const s = tasks.find(x => x.id === d)?.status
          return s === 'failed' || s === 'cancelled'
        })
        if (!bad) return t
        changed = true
        return { ...t, status: 'cancelled' as const, output: `Skipped: #${bad} did not finish.`, endedAt: now }
      })
    }
    const ready = (t: PmTask) =>
      t.status === 'todo' &&
      t.dependsOn.every(d => tasks.find(x => x.id === d)?.status === 'done') &&
      tasks.filter(x => x.sprint < t.sprint).every(x => x.status === 'done')
    tasks = tasks.map(t => {
      if (!ready(t)) return t
      const started = { ...t, status: 'running' as const, startedAt: now }
      toStart.push(started)
      return started
    })
    // The run ends when nothing runs and nothing more can start (a failed
    // task holds later sprints back for the orchestrator to re-plan).
    finished = toStart.length === 0 && !tasks.some(t => t.status === 'running')
    return { ...plan, tasks, phase: finished ? 'done' : plan.phase }
  })
  if (!p) return
  for (const t of toStart) void (t.assignee.engine === 'claude' ? startClaude($, p, t) : startExternal($, p, t))
  if (finished) await endRun($, p)
}

async function endRun($: EngineInterface, p: PmPlan) {
  stopTicker?.()
  stopTicker = undefined
  await update($, nowAtom, () => Date.now())
  const done = p.tasks.filter(t => t.status === 'done').length
  const reports = p.tasks
    .map(t => `### #${t.id} ${t.title} — ${assigneeLabel(t.assignee)} — ${t.status}\n${(t.output ?? '(no report)').slice(-3000)}`)
    .join('\n\n')
  $.ui.toast(`PM run finished: ${done}/${p.tasks.length} tasks done`)
  await $.prompt.submit({
    text: `[Claude mode for PM] The run for "${p.goal}" ended: ${done} of ${p.tasks.length} tasks done.\n\n${reports}\n\nAs the orchestrator: review these results against the plan, check the work, and fix or re-plan what failed (call ${PLAN_TOOL} for a follow-up sprint if needed). Then give me a short report.`,
  })
}

function startTicker($: EngineInterface) {
  stopTicker?.()
  const timer = $.clock.every(5000, () => void update($, nowAtom, () => Date.now()))
  stopTicker = () => timer.cancel()
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

type HealthMap = Partial<Record<Engine, AgentHealth>>

const readHealth = async ($: EngineInterface) => ((await $.store.get(STORE_HEALTH)) ?? {}) as HealthMap

/** Credentials say an agent may run; this is what its last real run said. */
async function detectWithHealth($: EngineInterface) {
  return applyHealth(await detectAgents($), await readHealth($))
}

async function refreshAgents($: EngineInterface) {
  const agents = await detectWithHealth($)
  await update($, agentsAtom, () => agents)
}

async function recordHealth($: EngineInterface, engine: Engine, health: AgentHealth) {
  await $.store.set(STORE_HEALTH, { ...(await readHealth($)), [engine]: health })
  await update($, agentsAtom, agents => applyHealth(agents, { [engine]: health }))
}

/** Runs a one-line prompt through an agent's CLI: the only proof it can run. */
async function testAgent($: EngineInterface, engine: Engine) {
  await update($, testingAtom, t => [...new Set([...t, engine])])
  let health: AgentHealth
  try {
    const r = await $.process.run(testArgv(engine, engine === 'opencode' ? ((await opencodeDefaultModel($)) ?? 'default') : 'default'), { timeoutMs: 120000, stdin: '' })
    health =
      r.exitCode === 0 && /\bOK\b/.test(r.stdout)
        ? { ok: true, at: Date.now() }
        : { ok: false, reason: failureReason(`${r.stdout}\n${r.stderr}`), at: Date.now() }
  } catch (err) {
    health = { ok: false, reason: `No answer within 2 minutes (${String(err).slice(0, 80)})`, at: Date.now() }
  }
  await recordHealth($, engine, health)
  await update($, testingAtom, t => t.filter(x => x !== engine))
}

/** Runs an agent CLI's sign-in, streaming what it prints (links, device codes) into the pane. */
async function runSignin($: EngineInterface, engine: Engine, argv: string[], input?: string) {
  await signinStream?.return(undefined).catch(() => undefined)
  await update($, signinAtom, () => ({ engine, log: '', isRunning: true }))
  await update($, showAgentsAtom, () => true)
  const append = (text: string) =>
    update($, signinAtom, s => (s && s.engine === engine ? { ...s, log: (s.log + stripAnsi(text)).slice(-4000) } : s))
  let code: number | null = null
  try {
    const stream = $.process.spawn({ argv, input: input ?? '' })
    signinStream = stream
    for (;;) {
      const piece = await stream.next()
      if (piece.done) {
        code = piece.value?.code ?? null
        break
      }
      await append(piece.value.text)
    }
  } catch (err) {
    await append(`\nCould not run ${argv[0]}: ${String(err)}`)
  }
  signinStream = undefined
  await refreshAgents($)
  // Success shows as the agent's own "Signed in" state; only a failure keeps a line under the row.
  await update($, signinAtom, s => (s && s.engine === engine ? (code === 0 ? null : { ...s, isRunning: false, ok: false }) : s))
}

async function saveAntigravityKey($: EngineInterface, key: string) {
  // agy ignores .env files: it reads GEMINI_API_KEY from its environment (set when pm-mode spawns it)
  // and only uses it when settings.json says modelProvider is "gemini".
  const home = await $.env.get('HOME')
  const dir = `${home}/.gemini`
  const keyPath = `${dir}/pm-mode-key`
  const settingsPath = `${dir}/antigravity-cli/settings.json`
  await $.process.run(['mkdir', '-p', `${dir}/antigravity-cli`]).catch(() => undefined)
  await $.fs.write(keyPath, `${key.trim()}\n`)
  await $.process.run(['chmod', '600', keyPath]).catch(() => undefined)
  let settings: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(await $.fs.read(settingsPath))
    if (parsed && typeof parsed === 'object') settings = parsed
  } catch {}
  settings.modelProvider = 'gemini'
  await $.fs.write(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  await update($, signinAtom, (): SigninState => ({ engine: 'antigravity', log: `Saved the key to ${keyPath} (readable by you only) and set modelProvider to "gemini".`, isRunning: false, ok: true }))
  await refreshAgents($)
}

/** Ids a task depends on, directly or through other tasks. */
function dependsTransitively(tasks: PmTask[], id: string, on: string, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false
  seen.add(id)
  const t = tasks.find(x => x.id === id)
  return !!t && t.dependsOn.some(d => d === on || dependsTransitively(tasks, d, on, seen))
}

const isAssignable = (t: PmTask) => t.status === 'todo' || t.status === 'failed' || t.status === 'cancelled'

const replan = (p: PmPlan, tasks: PmTask[]): PmPlan => ({ ...p, tasks: schedule(tasks) })

function actionsFor($: EngineInterface): ViewActions {
  return {
    toggleMode: () => void update($, isOnAtom, v => !v),
    setOrchestrator: model => {
      if (!CLAUDE_MODELS.some(m => m.id === model)) return
      void update($, orchestratorAtom, () => model)
      void $.store.set(STORE_ORCHESTRATOR, model)
    },
    setTab: tab => void update($, tabAtom, () => tab),
    select: id => {
      void update($, showReportAtom, () => false)
      void update($, selectedAtom, () => id)
      // A task opens in its own dialog pane, over the board; closing it clears the selection.
      if (!id) void $.ui.close({ id: TASK_PANE })
      else
        void read($, planAtom).then(p => {
          const t = p?.tasks.find(x => x.id === id)
          if (t) void $.ui.open({ id: TASK_PANE, title: `${t.id} · ${t.title}`, focus: true, closeOnEscape: true, holdToasts: true, rows: 18 })
        })
      // Opening a task from the list unfolds its sprint on the chart.
      if (id)
        void read($, planAtom).then(p => {
          const n = p?.tasks.find(t => t.id === id)?.sprint
          if (n !== undefined) void update($, collapsedAtom, c => c.filter(x => x !== n))
        })
    },
    // A task may change hands until it runs, and again after it failed (before Retry failed).
    assignTask: (id, key) =>
      void savePlan($, p =>
        p && p.phase !== 'running'
          ? { ...p, tasks: p.tasks.map(t => (t.id === id && isAssignable(t) ? { ...t, assignee: parseAssigneeKey(key, t.assignee) } : t)) }
          : p,
      ),
    assignType: (id, agentType) =>
      void savePlan($, p => (p?.phase === 'review' ? { ...p, tasks: p.tasks.map(t => (t.id === id ? { ...t, assignee: { ...t.assignee, agentType } } : t)) } : p)),
    editSprint: edit => void update($, sprintEditAtom, () => edit),
    applySprint: async () => {
      const edit = await read($, sprintEditAtom)
      if (!edit?.value) return
      await savePlan($, p =>
        p?.phase === 'review'
          ? { ...p, tasks: p.tasks.map(t => (t.sprint === edit.n ? { ...t, assignee: parseAssigneeKey(edit.value, t.assignee) } : t)) }
          : p,
      )
      await update($, sprintEditAtom, () => null)
    },
    toggleReport: () => void update($, showReportAtom, v => !v),
    nudgeEstimate: (id, dir) =>
      void savePlan($, p => {
        if (!p || p.phase !== 'review') return p
        return replan(p, p.tasks.map(t => {
          if (t.id !== id) return t
          const step = t.estimateMin + (dir > 0 ? 0 : -1) < 10 ? 1 : 5
          return { ...t, estimateMin: Math.max(1, t.estimateMin + dir * step) }
        }))
      }),
    setSprint: (id, target) =>
      void savePlan($, p => {
        if (!p || p.phase !== 'review') return p
        const t = p.tasks.find(x => x.id === id)
        if (!t) return p
        const sprint = Math.max(1, Math.round(target))
        const sprints = p.sprints.some(s => s.n === sprint) ? p.sprints : [...p.sprints, { n: sprint, name: `Sprint ${sprint}` }]
        // A task cannot wait on work planned for a later sprint.
        const tasks = p.tasks.map(x => {
          if (x.id === id) return { ...x, sprint, dependsOn: x.dependsOn.filter(d => (p.tasks.find(o => o.id === d)?.sprint ?? 0) <= sprint) }
          return x.dependsOn.includes(id) && x.sprint < sprint ? { ...x, dependsOn: x.dependsOn.filter(d => d !== id) } : x
        })
        return { ...replan(p, tasks), sprints }
      }),
    toggleDep: (id, depId) =>
      void savePlan($, p => {
        if (!p || p.phase !== 'review') return p
        const t = p.tasks.find(x => x.id === id)
        if (!t) return p
        const has = t.dependsOn.includes(depId)
        if (!has && dependsTransitively(p.tasks, depId, id)) {
          $.ui.toast(`${depId} already waits for ${id}, so ${id} cannot wait for it.`)
          return p
        }
        const dependsOn = has ? t.dependsOn.filter(d => d !== depId) : [...t.dependsOn, depId]
        return replan(p, p.tasks.map(x => (x.id === id ? { ...x, dependsOn } : x)))
      }),
    toggleSprint: n => void update($, collapsedAtom, c => (c.includes(n) ? c.filter(x => x !== n) : [...c, n])),
    setGroupBy: g => void update($, groupByAtom, () => g),
    toggleAgents: () => void update($, showAgentsAtom, v => !v),
    testAgent: engine => void testAgent($, engine),
    testAll: () =>
      void read($, agentsAtom).then(agents =>
        Promise.all(agents.filter(a => a.isInstalled && a.engine !== 'claude' && a.auth !== 'missing').map(a => testAgent($, a.engine))),
      ),
    signIn: engine => {
      const argv = signinArgv(engine)
      if (argv) void runSignin($, engine, argv)
    },
    install: engine => {
      const argv = installArgv(engine)
      if (argv) void runSignin($, engine, argv)
    },
    confirmSignin: async () => {
      await signinStream?.return(undefined).catch(() => undefined)
      await update($, signinAtom, () => null)
      await refreshAgents($)
    },
    showKeyInput: engine => void update($, keyForAtom, () => engine),
    submitKey: async (engine, value) => {
      const v = value.trim()
      await update($, keyForAtom, () => null)
      if (!v) return
      if (engine === 'codex') return runSignin($, engine, ['codex', 'login', '--with-api-key'], `${v}\n`)
      if (engine === 'antigravity') return saveAntigravityKey($, v)
      if (engine === 'pi') {
        const provider = v.split(/\s+/)[0]!
        // --no-browser prints a device code or link into the pane, so no terminal is needed.
        return runSignin($, engine, ['pi', 'auth', 'login', provider, '--no-browser'])
      }
      if (engine === 'opencode') {
        const provider = v.split(/\s+/)[0]!
        const { method, methods, error } = await opencodeMethod($, provider)
        if (!method) {
          await update($, signinAtom, () => ({ engine, log: error ?? 'No sign-in method found.', isRunning: false, ok: false }))
          return
        }
        if (method === 'key') {
          await update($, signinAtom, () => ({
            engine,
            log: `${provider} only takes an API key, which opencode asks for in a terminal: run \`opencode auth login ${provider}\`. (Methods: ${methods.join(', ')})`,
            isRunning: false,
            ok: false,
          }))
          return
        }
        return runSignin($, engine, ['opencode', 'auth', 'login', provider, '--method', method])
      }
    },
    closeSignin: () => {
      void signinStream?.return(undefined).catch(() => undefined)
      void update($, signinAtom, () => null)
    },
    approve: () => startRun($),
    stop: async () => {
      const p = await savePlan($, plan => {
        if (!plan) return plan
        const now = Date.now()
        return {
          ...plan,
          phase: 'stopped',
          tasks: plan.tasks.map(t => {
            if (t.status === 'running' && t.assignee.engine !== 'claude') cancelled.add(t.id)
            return t.status === 'todo' ? { ...t, status: 'cancelled' as const, output: 'Stopped before it started.', endedAt: now } : t
          }),
        }
      })
      stopTicker?.()
      stopTicker = undefined
      if (p?.tasks.some(t => t.status === 'running' && t.assignee.engine === 'claude')) {
        $.ui.toast('Stopped. Claude subagents already running finish their current task.')
      }
    },
    retryFailed: async () => {
      await savePlan($, p => {
        if (!p) return p
        const tasks = p.tasks.map(t =>
          t.status === 'failed' || t.status === 'cancelled'
            ? { ...t, status: 'todo' as const, output: undefined, startedAt: undefined, endedAt: undefined, agentId: undefined }
            : t,
        )
        return { ...p, tasks, phase: 'running', startedAt: p.startedAt ?? Date.now() }
      })
      startTicker($)
      await pump($)
    },
    clear: () => {
      void $.ui.close({ id: TASK_PANE })
      void savePlan($, () => null)
      void update($, selectedAtom, () => null)
    },
    refreshAgents: async () => {
      await update($, agentsAtom, () => [])
      await refreshAgents($)
    },
    setAutonomy: a => {
      void update($, autonomyAtom, () => a)
      void $.store.set(STORE_AUTONOMY, a)
    },
    openAgent: agentId => void $.ui.view({ agentId }),
  }
}

// Shared by the pane's approve button and `/pm start`.
async function beginRun($: EngineInterface): Promise<void> {
  await savePlan($, p => p && { ...p, phase: 'running', startedAt: Date.now() })
  await update($, nowAtom, () => Date.now())
  startTicker($)
}

async function startRun($: EngineInterface): Promise<void> {
  await beginRun($)
  await pump($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pm',
      description: 'Claude mode for PM: open the sprint board (/pm), plan a goal (/pm <goal>), add a task (/pm add <task>), run it (/pm start), or turn it off (/pm off)',
      argumentHint: '[goal | add <task> | start | off | clear | agents | backlog]',
    })
    await $.tool.register({
      name: 'pm_plan',
      description:
        'Claude mode for PM: put a sprint plan on the board and Gantt chart. Give every task a self-contained definition, an estimate in minutes, a sprint, dependencies, and the engine and model that should run it. The user reviews and approves it in the PM pane; nothing runs until then.',
      inputSchema: PLAN_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'pm_status',
      description: 'Claude mode for PM: the current plan with each task status, assignee and report.',
      inputSchema: { type: 'object', properties: {} },
      isDeferred: false,
    })
    const stored = (await $.store.get(STORE_PLAN)) as PmPlan | null | undefined
    if (stored && !(await read($, planAtom))) {
      // A run cut off by a restart cannot be resumed: its agents are gone.
      const restored: PmPlan =
        stored.phase === 'running'
          ? {
              ...stored,
              phase: 'stopped',
              tasks: stored.tasks.map(t => (t.status === 'running' ? { ...t, status: 'failed', output: 'Interrupted by a restart.' } : t)),
            }
          : stored
      await update($, planAtom, () => restored)
    }
    const orchestrator = await $.store.get(STORE_ORCHESTRATOR)
    if (typeof orchestrator === 'string' && CLAUDE_MODELS.some(m => m.id === orchestrator)) await update($, orchestratorAtom, () => orchestrator)
    const autonomy = await $.store.get(STORE_AUTONOMY)
    if (autonomy === 'full' || autonomy === 'edit') await update($, autonomyAtom, () => autonomy)
    // Detection runs in the background; if the session ends before it finishes, drop the result.
    void detectWithHealth($)
      .then(agents => update($, agentsAtom, () => agents))
      .catch(() => undefined)
    if ((await read($, planAtom))?.phase === 'running') startTicker($)
    if (await read($, isOnAtom)) void $.ui.open(PANE_ARGS)
    return next(e)
  })

  on('command.run', { command: 'pm' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'off') {
      await update($, isOnAtom, () => false)
      return { text: 'Claude mode for PM is off. The plan stays on the board.' }
    }
    if (arg === 'clear') {
      await archivePlan($, await read($, planAtom))
      await savePlan($, () => null)
      return { text: 'PM plan cleared.' }
    }
    if (arg === 'start') {
      const current = await read($, planAtom)
      if (!current || current.tasks.length === 0) return { text: 'No plan to start. Plan a goal with /pm <goal> or add a task with /pm add <task>.' }
      if (current.phase === 'running') return { text: 'A run is already in progress.' }
      if (!current.tasks.some(t => t.status === 'todo')) return { text: 'Nothing to run: no tasks are waiting.' }
      await update($, isOnAtom, () => true)
      await $.ui.open(PANE_ARGS)
      // Mark the run as started now so a second /pm start is refused, but spawn the agents
      // (and submit Opus's report when it ends) once the hook has returned: the host refuses
      // those while it holds this command.
      await beginRun($)
      $.clock.after(0, () => void pump($))
      return { text: 'Started the run.' }
    }
    const addMatch = /^add(?:\s+([\s\S]*))?$/.exec(arg)
    if (addMatch) {
      const title = (addMatch[1] ?? '').trim()
      if (!title) return { text: 'Usage: /pm add <task>' }
      const current = await read($, planAtom)
      if (current?.phase === 'running') return { text: 'A run is in progress. Add the task after it ends.' }
      let added = ''
      let sprintN = 1
      await savePlan($, p => {
        const base: PmPlan = p ?? { goal: 'Untitled plan', sprints: [], tasks: [], phase: 'review', createdAt: Date.now() }
        let n = base.tasks.length + 1
        while (base.tasks.some(t => t.id === `T${n}`)) n++
        added = `T${n}`
        // Current sprint: the first one with unfinished work, else the last one.
        const open = base.tasks.filter(t => t.status !== 'done').map(t => t.sprint)
        sprintN = open.length ? Math.min(...open) : Math.max(1, ...base.tasks.map(t => t.sprint))
        const task: PmTask = {
          id: added,
          title: title.slice(0, 60),
          definition: title,
          sprint: sprintN,
          estimateMin: 10,
          dependsOn: [],
          assignee: { ...DEFAULT_ASSIGNEE },
          status: 'todo',
          plannedStart: 0,
        }
        const sprints = base.sprints.some(s => s.n === sprintN) ? base.sprints : [...base.sprints, { n: sprintN, name: `Sprint ${sprintN}` }]
        return { ...replan(base, [...base.tasks, task]), sprints }
      })
      await update($, isOnAtom, () => true)
      await update($, tabAtom, () => 'timeline')
      await $.ui.open(PANE_ARGS)
      return { text: `Added #${added} to sprint ${sprintN}: ${title}` }
    }
    await update($, isOnAtom, () => true)
    await $.ui.open(PANE_ARGS)
    if (arg === 'backlog') {
      await update($, tabAtom, () => 'backlog')
      const cur = await read($, planAtom)
      const all = [...(await readHistory($)).filter(h => h.createdAt !== cur?.createdAt), ...(cur ? [cur] : [])]
      const n = all.reduce((c, h) => c + h.tasks.length, 0)
      return { text: `Backlog: ${all.length} plan(s), ${n} task(s) in this directory.` }
    }
    if (arg === 'agents') {
      await update($, showAgentsAtom, () => true)
      return { text: 'Claude mode for PM: showing the agents on this computer.' }
    }
    if (arg) {
      await update($, tabAtom, () => 'timeline')
      // A command.run hook may not submit: the host refuses a prompt that would wait on the
      // command it is holding. Submit once the hook has returned.
      $.clock.after(0, () => void $.prompt.submit({ text: arg }))
      return { text: `Claude mode for PM is on. Planning: ${arg}` }
    }
    return { text: 'Claude mode for PM is on. Describe what you want built; the orchestrator plans it on the board.' }
  })

  // While PM mode is on, the main conversation (the orchestrator) runs on the chosen model;
  // subagents keep the model their task was assigned.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId || !(await read($, isOnAtom))) return yield* next(e)
    const model = await read($, orchestratorAtom)
    return yield* next(model && model !== e.model ? { ...e, model } : e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, isOnAtom))) return composed
    return { sections: [...composed.sections, { id: 'pm-mode', text: await orchestratorBrief($), scope: 'session' as const }] }
  })

  on('tool.call', { tool: PLAN_TOOL }, async ($, e) => {
    const current = await read($, planAtom)
    if (current?.phase === 'running') {
      return { result: 'A run is in progress. Wait for it to end (its reports come back to you), then plan the next sprint.' }
    }
    let agents = await read($, agentsAtom)
    if (agents.length === 0) {
      agents = await detectWithHealth($)
      await update($, agentsAtom, () => agents)
    }
    // An agent that cannot run (refused account, no sign-in) gets no tasks; they fall back to Claude.
    const available = new Set<Engine>(['claude', ...agents.filter(a => a.isInstalled && a.auth !== 'failing' && a.auth !== 'missing').map(a => a.engine)])
    const plan = toPlan(e as unknown as PlanInput, available)
    if (typeof plan === 'string') return { result: `Plan refused: ${plan}` }
    await archivePlan($, current)
    await savePlan($, () => plan)
    await update($, selectedAtom, () => null)
    await $.ui.close({ id: TASK_PANE })
    await update($, tabAtom, () => 'timeline')
    await update($, isOnAtom, () => true)
    await $.ui.open(PANE_ARGS)
    const summary = plan.tasks
      .map(t => `#${t.id} [sprint ${t.sprint}, +${t.plannedStart}m, ${t.estimateMin}m] ${t.title} → ${assigneeLabel(t.assignee)}`)
      .join('\n')
    return {
      result: `The plan is on the PM board, waiting for the user's approval:\n${summary}\n\nStop here: tell the user in one or two sentences that the plan is ready for review in the PM pane (they can reassign models per task or sprint, then press Start sprint). Do not start the work yourself.`,
    }
  })

  // Answers the orchestrator and every subagent alike (a subagent's call carries e.agentId).
  // The plan comes from the atom, and from the persisted store when the atom cannot be read in
  // that loop, so a failing read never leaves the call without an answer.
  const statusResult = (plan: PmPlan | null | undefined) =>
    plan ? { result: JSON.stringify(plan, null, 1).slice(0, 60000) } : { result: 'No plan on the board.' }
  on('tool.call', { tool: STATUS_TOOL }, async $ => {
    let plan: PmPlan | null | undefined
    try {
      plan = await read($, planAtom)
    } catch {
      plan = undefined
    }
    if (!plan) plan = ((await $.store.get(STORE_PLAN)) as PmPlan | null | undefined) ?? null
    return statusResult(plan)
  }).catch(async ($, _e, next) => {
    if (next.called) return next(_e)
    return statusResult(((await $.store.get(STORE_PLAN)) as PmPlan | null | undefined) ?? null)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) return result
    const plan = await read($, planAtom)
    const task = plan?.tasks.find(t => t.agentId === e.agentId && t.status === 'running')
    const isOk = e.reason === 'answer'
    const answer = e.answer || (isOk ? '(no report)' : `Ended: ${e.reason}`)
    if (task) await finishTask($, task.id, isOk ? 'done' : 'failed', answer)
    else if (plan?.phase === 'running' || plan?.phase === 'stopped') earlyAnswers.set(e.agentId, { answer, isOk })
    return result
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === TASK_PANE) await update($, selectedAtom, () => null)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: TASK_PANE }, async ($, e) => {
    // The mobile app draws no dropdown or text field: leave them out so the view falls back to buttons.
    const el = e.surface === 'mobile' ? { ...$.ui.resolve(e), Select: undefined, Input: undefined } : $.ui.resolve(e)
    const data = {
      isOn: await read($, isOnAtom),
      plan: await read($, planAtom),
      tab: await read($, tabAtom),
      agents: await read($, agentsAtom),
      selected: await read($, selectedAtom),
      now: (await read($, nowAtom)) || Date.now(),
      autonomy: await read($, autonomyAtom),
      groupBy: await read($, groupByAtom),
      collapsed: await read($, collapsedAtom),
      showAgents: await read($, showAgentsAtom),
      signin: await read($, signinAtom),
      keyFor: await read($, keyForAtom),
      testing: await read($, testingAtom),
      sprintEdit: await read($, sprintEditAtom),
      showReport: await read($, showReportAtom),
      orchestrator: await read($, orchestratorAtom),
      history: await readHistory($),
      columns: e.props.bodyColumns ?? e.viewport?.columns ?? 100,
      surface: e.surface,
    }
    return TaskDialog({ el, data, actions: actionsFor($) })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // The mobile app draws no dropdown or text field: leave them out so the view falls back to buttons.
    const el = e.surface === 'mobile' ? { ...$.ui.resolve(e), Select: undefined, Input: undefined } : $.ui.resolve(e)
    const data = {
      isOn: await read($, isOnAtom),
      plan: await read($, planAtom),
      tab: await read($, tabAtom),
      agents: await read($, agentsAtom),
      selected: await read($, selectedAtom),
      now: (await read($, nowAtom)) || Date.now(),
      autonomy: await read($, autonomyAtom),
      groupBy: await read($, groupByAtom),
      collapsed: await read($, collapsedAtom),
      showAgents: await read($, showAgentsAtom),
      signin: await read($, signinAtom),
      keyFor: await read($, keyForAtom),
      testing: await read($, testingAtom),
      sprintEdit: await read($, sprintEditAtom),
      showReport: await read($, showReportAtom),
      orchestrator: await read($, orchestratorAtom),
      history: await readHistory($),
      columns: e.props.bodyColumns ?? e.viewport?.columns ?? 100,
      surface: e.surface,
    }
    return PmView({ el, data, actions: actionsFor($) })
  })
}
