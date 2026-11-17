export type Engine = 'claude' | 'gemini' | 'codex' | 'opencode' | 'grok'
export type Assignee = { engine: Engine; model: string; agentType?: string }
export type TaskStatus = 'todo' | 'running' | 'done' | 'failed' | 'cancelled'
export type PmTask = {
  id: string
  title: string
  definition: string
  sprint: number
  estimateMin: number
  dependsOn: string[]
  assignee: Assignee
  status: TaskStatus
  plannedStart: number
  startedAt?: number
  endedAt?: number
  output?: string
  agentId?: string
}
export type PmSprint = { n: number; name: string }
export type PmPhase = 'review' | 'running' | 'done' | 'stopped'
export type PmPlan = {
  goal: string
  sprints: PmSprint[]
  tasks: PmTask[]
  phase: PmPhase
  createdAt: number
  startedAt?: number
}
/**
 * ok: a test prompt or a delegated task ran; unverified: credentials found but
 * nothing has run yet; failing: the last run was refused (sign-in, billing,
 * quota); missing: no credentials; unknown: the CLI did not answer.
 */
export type AuthState = 'ok' | 'unverified' | 'failing' | 'missing' | 'unknown'
/** What the last test prompt or delegated task said about an agent. */
export type AgentHealth = { ok: boolean; reason?: string; at: number }
export type DetectedAgent = {
  engine: Engine
  label: string
  isInstalled: boolean
  path?: string
  models: string[]
  agentTypes: string[]
  note?: string
  auth: AuthState
  /** Why the last run was refused, when auth is failing. */
  failReason?: string
  authNote?: string
  /** How this agent signs in from the pane: a browser/device flow, and the label of an API key field. */
  signin: { browser: boolean; apiKey?: string; provider?: string }
}
export type PmTab = 'timeline' | 'board'
export type GroupBy = 'task' | 'agent'
export type Autonomy = 'edit' | 'full'
export type SprintEdit = { n: number; value: string }
export type SigninState = { engine: Engine; log: string; isRunning: boolean; ok?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'pm-mode': {
      isOn: boolean
      plan: PmPlan | null
      tab: PmTab
      agents: DetectedAgent[]
      selected: string | null
      now: number
      autonomy: Autonomy
      groupBy: GroupBy
      collapsed: number[]
      showAgents: boolean
      signin: SigninState | null
      keyFor: Engine | null
      sprintEdit: SprintEdit | null
      testing: Engine[]
      showReport: boolean
      orchestrator: string
    }
  }
}
