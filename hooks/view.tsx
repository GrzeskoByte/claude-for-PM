import type {
  Assignee,
  Autonomy,
  DetectedAgent,
  Engine,
  GroupBy,
  PmPlan,
  PmTab,
  PmTask,
  SigninState,
  SprintEdit,
  TaskStatus,
} from '../types'
import { actualWindow, assigneeKey, assigneeLabel, assigneeOptions, CLAUDE_MODELS, colorOf, fmtMin, maxParallel, modelLabel, planSpan, sprintName } from './plan'

export type ViewData = {
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
  testing: Engine[]
  sprintEdit: SprintEdit | null
  showReport: boolean
  orchestrator: string
  history: PmPlan[]
  surface: string
  columns: number
}

export type ViewActions = {
  toggleMode: () => void
  setOrchestrator: (model: string) => void
  setTab: (tab: PmTab) => void
  select: (id: string | null) => void
  assignTask: (id: string, key: string) => void
  assignType: (id: string, agentType: string) => void
  setSprint: (id: string, n: number) => void
  nudgeEstimate: (id: string, dir: 1 | -1) => void
  toggleDep: (id: string, depId: string) => void
  toggleSprint: (n: number) => void
  setGroupBy: (g: GroupBy) => void
  editSprint: (edit: SprintEdit | null) => void
  applySprint: () => void
  toggleReport: () => void
  toggleAgents: () => void
  approve: () => void
  stop: () => void
  retryFailed: () => void
  clear: () => void
  refreshAgents: () => void
  setAutonomy: (a: Autonomy) => void
  openAgent: (agentId: string) => void
  signIn: (engine: Engine) => void
  confirmSignin: () => void
  showKeyInput: (engine: Engine | null) => void
  submitKey: (engine: Engine, value: string) => void
  closeSignin: () => void
  testAgent: (engine: Engine) => void
  testAll: () => void
}

// Status drives color everywhere; a glyph goes with it so color is never the only cue.
const STATUS: Record<TaskStatus, { label: string; color: string; icon: string }> = {
  todo: { label: 'To do', color: 'suggestion', icon: '○' },
  running: { label: 'Running', color: 'claude', icon: '◐' },
  done: { label: 'Done', color: 'success', icon: '✓' },
  failed: { label: 'Failed', color: 'error', icon: '✕' },
  cancelled: { label: 'Skipped', color: 'inactive', icon: '–' },
}
const PHASE: Record<PmPlan['phase'], { label: string; color: string }> = {
  review: { label: 'Planned', color: 'inactive' },
  running: { label: 'Running', color: 'claude' },
  done: { label: 'Done', color: 'success' },
  stopped: { label: 'Stopped', color: 'warning' },
}
const VIEWS = [
  { value: 'timeline:task', label: 'Timeline · by sprint' },
  { value: 'timeline:agent', label: 'Timeline · by agent' },
  { value: 'board:task', label: 'Board' },
  { value: 'backlog:task', label: 'Backlog' },
]
const INSTALL: Partial<Record<Engine, string>> = {
  codex: 'https://github.com/openai/codex',
  antigravity: 'https://antigravity.google/docs/cli',
  opencode: 'https://opencode.ai',
}

type El = any

/** Widths that add up to 100 once rounded, so bars land where the ruler says. */
function percents(parts: number[], total: number): string[] {
  let acc = 0
  let used = 0
  return parts.map(p => {
    acc += p
    const end = Math.round((acc / total) * 100)
    const w = Math.max(0, end - used)
    used = end
    return `${w}%`
  })
}

function tickStep(span: number, count: number): number {
  return [1, 2, 5, 10, 15, 30, 60, 120, 240, 480].find(s => span / s <= count) ?? 960
}

const shortModel = (a: Assignee) => (a.engine === 'claude' ? modelLabel(a).split(' ')[0]! : modelLabel(a))

/** A solid status pill in the status color. */
function statusText(el: El, s: TaskStatus) {
  const { Text } = el
  return (
    <Text inverse bold color={STATUS[s].color}>
      {` ${STATUS[s].icon} ${STATUS[s].label} `}
    </Text>
  )
}

/** A colored model dot and name. */
function modelChip(el: El, a: Assignee) {
  const { Text } = el
  return (
    <Text wrap="truncate-end">
      <Text color={colorOf(a)}>●</Text> {assigneeLabel(a)}
    </Text>
  )
}

/** One clearly separated area of the pane: a colored border and a colored title row. */
function section(el: El, key: string, title: string, accent: string, body: unknown, right?: unknown) {
  const { Box, Text } = el
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={accent} paddingX="lg" paddingY="md">
      <Box flexDirection="row" gap="md" alignItems="center" marginBottom="md">
        <Text bold size="heading" color={accent}>
          {title}
        </Text>
        <Box flexGrow={1} />
        {right}
      </Box>
      {body}
    </Box>
  )
}

function modelSelect(el: El, data: ViewData, t: PmTask, actions: ViewActions, keyBase: string) {
  const { Text, Button, Select } = el
  if (data.plan?.phase === 'running' || t.status === 'done' || t.status === 'running') {
    return modelChip(el, t.assignee)
  }
  const options = assigneeOptions(data.agents)
  const value = assigneeKey(t.assignee)
  if (!options.some(o => o.value === value)) options.unshift({ value, label: assigneeLabel(t.assignee) })
  if (!Select) {
    const at = options.findIndex(o => o.value === value)
    const next = options[(at + 1) % options.length]!
    return (
      <Button key={`${keyBase}-${t.id}`} plain onPress={() => actions.assignTask(t.id, next.value)}>
        {assigneeLabel(t.assignee)} <Text dimColor>↻</Text>
      </Button>
    )
  }
  return <Select key={`${keyBase}-${t.id}`} options={options} value={value} onSelect={(v: string) => actions.assignTask(t.id, v)} />
}

/** A labelled field: a small dim label over its control. */
function field(el: El, key: string, label: string, control: unknown) {
  const { Box, Text } = el
  return (
    <Box key={key} flexDirection="column" gap="xs" minWidth={16}>
      <Text dimColor size="caption">
        {label.toUpperCase()}
      </Text>
      {control}
    </Box>
  )
}

/** The task dialog's body: a header, then one framed section per concern. */
function issuePanel(el: El, data: ViewData, plan: PmPlan, t: PmTask, actions: ViewActions) {
  const { Box, Text, Button, Select, Markdown } = el
  const editable = plan.phase === 'review'
  const narrow = data.columns < 75
  const earlier = plan.tasks.filter(o => o.id !== t.id && o.sprint <= t.sprint)
  const sprints = [...new Set([...plan.tasks.map(x => x.sprint), Math.max(...plan.tasks.map(x => x.sprint)) + 1])].sort((a, b) => a - b)
  const types = data.agents.find(a => a.engine === 'claude')?.agentTypes ?? []
  const at = plan.tasks.findIndex(x => x.id === t.id)
  const prev = plan.tasks[at - 1]
  const next = plan.tasks[at + 1]
  const actual = actualWindow(plan, t, data.now)
  const row = (key: string, children: unknown) => (
    <Box key={key} flexDirection={narrow ? 'column' : 'row'} gap="lg" flexWrap="wrap" alignItems={narrow ? 'flex-start' : 'flex-end'}>
      {children}
    </Box>
  )

  const assignment = section(
    el,
    `dlg-assign-${t.id}`,
    'Assignment',
    colorOf(t.assignee),
    row('assign-row', [
      field(el, 'f-model', 'Model', modelSelect(el, data, t, actions, 'as')),
      editable && Select && t.assignee.engine === 'claude' && types.length > 1
        ? field(
            el,
            'f-type',
            'Agent type',
            <Select
              key={`ty-${t.id}`}
              options={types.map(x => ({ value: x, label: x }))}
              value={t.assignee.agentType ?? 'general-purpose'}
              onSelect={(v: string) => actions.assignType(t.id, v)}
            />,
          )
        : null,
    ]),
  )

  const schedule = section(
    el,
    `dlg-sched-${t.id}`,
    'Schedule',
    'permission',
    <Box flexDirection="column" gap="md">
      {row('sched-row', [
        field(
          el,
          'f-est',
          'Estimate',
          <Box flexDirection="row" gap="sm" alignItems="center">
            {editable && (
              <Button key={`est-${t.id}-down`} onPress={() => actions.nudgeEstimate(t.id, -1)}>
                −
              </Button>
            )}
            <Text bold>{fmtMin(t.estimateMin)}</Text>
            {editable && (
              <Button key={`est-${t.id}-up`} onPress={() => actions.nudgeEstimate(t.id, 1)}>
                +
              </Button>
            )}
          </Box>,
        ),
        field(
          el,
          'f-sprint',
          'Sprint',
          editable && Select ? (
            <Select
              key={`spr-${t.id}`}
              options={sprints.map(n => ({ value: String(n), label: sprintName(plan.sprints, n) }))}
              value={String(t.sprint)}
              onSelect={(v: string) => actions.setSprint(t.id, Number(v))}
            />
          ) : (
            <Text bold>{sprintName(plan.sprints, t.sprint)}</Text>
          ),
        ),
        field(
          el,
          'f-when',
          actual ? 'Ran' : 'Planned',
          <Text>
            {actual
              ? `${fmtMin(actual.end - actual.start)}${t.status === 'running' ? ' so far' : ''}`
              : `+${fmtMin(t.plannedStart)} → +${fmtMin(t.plannedStart + t.estimateMin)}`}
          </Text>,
        ),
      ])}
      {earlier.length > 0 &&
        field(
          el,
          'f-deps',
          'Starts after',
          <Box flexDirection="row" gap="sm" flexWrap="wrap">
            {earlier.map(o => {
              const on = t.dependsOn.includes(o.id)
              return editable ? (
                <Button key={`dep-${t.id}-${o.id}`} variant={on ? 'primary' : undefined} onPress={() => actions.toggleDep(t.id, o.id)}>
                  {on ? `✓ ${o.id} ${o.title}` : `${o.id} ${o.title}`}
                </Button>
              ) : on ? (
                <Text key={`dep-${t.id}-${o.id}`}>
                  {o.id} {o.title}
                </Text>
              ) : null
            })}
            {!editable && t.dependsOn.length === 0 && <Text dimColor>Nothing: starts with its sprint</Text>}
          </Box>,
        )}
    </Box>,
  )

  const description = section(
    el,
    `dlg-desc-${t.id}`,
    'Description',
    'planMode',
    <Text wrap="wrap">{t.definition}</Text>,
  )

  const resultColor = t.status === 'done' ? 'success' : t.status === 'failed' ? 'error' : 'inactive'
  const result =
    t.output &&
    section(
      el,
      `dlg-result-${t.id}`,
      'Result',
      resultColor,
      <Box flexDirection="column" gap="sm">
        {data.showReport ? (
          <Markdown text={t.output.slice(-6000)} />
        ) : (
          <Text wrap="wrap">{(t.output.split('\n').find(l => l.trim()) ?? '').slice(0, 300)}</Text>
        )}
      </Box>,
      <Box flexDirection="row" gap="md">
        <Button key={`report-${t.id}`} plain onPress={actions.toggleReport}>
          <Text color="suggestion">{data.showReport ? 'Show less' : 'Full report'}</Text>
        </Button>
        {t.agentId && (
          <Button key={`view-${t.id}`} plain onPress={() => actions.openAgent(t.agentId!)}>
            <Text color="suggestion">Transcript →</Text>
          </Button>
        )}
      </Box>,
    )

  return (
    <Box key={`panel-${t.id}`} flexDirection="column" gap="lg" paddingX="md" paddingY="md">
      <Box flexDirection="column" gap="sm">
        <Box flexDirection="row" gap="md" alignItems="center">
          <Text dimColor size="heading">
            {t.id}
          </Text>
          <Text bold size="title" wrap="wrap">
            {t.title}
          </Text>
          <Box flexGrow={1} />
          {statusText(el, t.status)}
        </Box>
        <Text dimColor>
          {sprintName(plan.sprints, t.sprint)} · {assigneeLabel(t.assignee)} · {fmtMin(t.estimateMin)}
          {editable
            ? ''
            : plan.phase === 'running'
              ? ' · locked while the sprint runs'
              : t.status === 'failed' || t.status === 'cancelled'
                ? ' · pick another model, then Retry failed'
                : ' · finished'}
        </Text>
      </Box>
      {assignment}
      {schedule}
      {description}
      {result}
      <Box flexDirection="row" gap="md" alignItems="center">
        <Button key={`prev-${t.id}`} plain onPress={() => prev && actions.select(prev.id)}>
          <Text dimColor={!prev}>‹ {prev ? `${prev.id} ${prev.title}` : 'First task'}</Text>
        </Button>
        <Box flexGrow={1} />
        <Button key={`next-${t.id}`} plain onPress={() => next && actions.select(next.id)}>
          <Text dimColor={!next}>{next ? `${next.id} ${next.title}` : 'Last task'} ›</Text>
        </Button>
        <Button key={`close-${t.id}`} variant="primary" role="dismiss" onPress={() => actions.select(null)}>
          Done
        </Button>
      </Box>
    </Box>
  )
}

/** Work still ahead wears its model's color; finished work wears its outcome's. */
const barColor = (t: PmTask) => (t.status === 'todo' || t.status === 'running' ? colorOf(t.assignee) : STATUS[t.status].color)

function barLabel(t: PmTask, widthPct: number, data: ViewData, groupBy: GroupBy): string {
  const chars = Math.floor((widthPct / 100) * data.columns * 0.6) - 1
  const id = `${STATUS[t.status].icon} ${t.id}`
  const full = `${id} · ${groupBy === 'agent' ? t.title : shortModel(t.assignee)}`
  if (data.columns >= 75 && full.length <= chars) return full
  return id.length <= chars + 1 ? id : STATUS[t.status].icon
}

/** Adds the running time to a bar's label only where it fits, so a short bar never wraps. */
function fitLabel(label: string, took: string, widthPct: number, columns: number): string {
  const room = Math.floor((widthPct / 100) * columns * 0.6) - 1
  return took && (label + took).length <= room ? label + took : label
}

/** A row's right side: spacer, bars and spacers whose widths add up to 100%. */
function track(el: El, data: ViewData, plan: PmPlan, tasks: PmTask[], scale: number, actions: ViewActions) {
  const { Box, Text, Button } = el
  const sorted = [...tasks].sort((a, b) => a.plannedStart - b.plannedStart)
  const parts: { kind: 'gap' | 'bar'; size: number; t?: PmTask }[] = []
  let cursor = 0
  for (const t of sorted) {
    const start = Math.max(cursor, t.plannedStart)
    if (start > cursor) parts.push({ kind: 'gap', size: start - cursor })
    const size = Math.max(t.estimateMin, scale * 0.03)
    parts.push({ kind: 'bar', size, t })
    cursor = start + size
  }
  if (cursor < scale) parts.push({ kind: 'gap', size: scale - cursor })
  const widths = percents(parts.map(p => p.size), Math.max(scale, cursor))
  return (
    <Box width={data.columns < 75 ? '56%' : '62%'} flexDirection="row">
      {parts.map((p, i) => {
        if (p.kind === 'gap' || !p.t) return <Box key={`gap-${i}`} width={widths[i]} />
        const t = p.t
        const isSelected = data.selected === t.id
        const actual = actualWindow(plan, t, data.now)
        const took = t.status === 'running' && actual ? ` ${fmtMin(actual.end - actual.start)}` : ''
        return (
          <Box key={`barbox-${t.id}`} width={widths[i]} backgroundColor={barColor(t)} overflow="hidden" paddingY="xs" paddingX="xs">
            <Button key={`bar-${t.id}`} plain onPress={() => actions.select(isSelected ? null : t.id)}>
              <Text color="inverseText" bold={isSelected} underline={isSelected} wrap="truncate-end">
                {fitLabel(barLabel(t, parseInt(widths[i]!, 10), data, data.groupBy), took, parseInt(widths[i]!, 10), data.columns) || ' '}
              </Text>
            </Button>
          </Box>
        )
      })}
    </Box>
  )
}

function packLanes(tasks: PmTask[]): PmTask[][] {
  const lanes: { end: number; tasks: PmTask[] }[] = []
  for (const t of [...tasks].sort((a, b) => a.plannedStart - b.plannedStart)) {
    const lane = lanes.find(l => l.end <= t.plannedStart + 1e-6)
    if (lane) {
      lane.tasks.push(t)
      lane.end = t.plannedStart + t.estimateMin
    } else lanes.push({ end: t.plannedStart + t.estimateMin, tasks: [t] })
  }
  return lanes.map(l => l.tasks)
}

function timeline(el: El, data: ViewData, plan: PmPlan, actions: ViewActions) {
  const { Box, Text, Button, Select } = el
  const narrow = data.columns < 75
  const left = narrow ? '44%' : '38%'
  const span = planSpan(plan)
  const step = tickStep(span, narrow ? 3 : 5)
  const scale = Math.max(step, Math.ceil(span / step) * step)
  const ticks = Array.from({ length: Math.round(scale / step) }, (_, i) => i * step)
  const tickW = percents(ticks.map(() => step), scale)
  const editable = plan.phase === 'review'
  const rows: unknown[] = [
    <Box key="ruler" flexDirection="row" backgroundColor="inactive" paddingY="xs">
      <Box width={left} paddingLeft={1}>
        <Text bold color="inverseText">
          {data.groupBy === 'agent' ? 'Agent' : 'Task'}
        </Text>
      </Box>
      <Box width={narrow ? '56%' : '62%'} flexDirection="row">
        {ticks.map((m, i) => (
          <Box key={`tick-${m}`} width={tickW[i]}>
            <Text color="inverseText">{`│ ${fmtMin(m)}`}</Text>
          </Box>
        ))}
      </Box>
    </Box>,
  ]

  if (data.groupBy === 'agent') {
    const lanes = new Map<string, { a: Assignee; tasks: PmTask[] }>()
    for (const t of plan.tasks) {
      const k = `${assigneeKey(t.assignee)}|${t.assignee.agentType ?? ''}`
      lanes.set(k, { a: t.assignee, tasks: [...(lanes.get(k)?.tasks ?? []), t] })
    }
    for (const [k, lane] of lanes) {
      packLanes(lane.tasks).forEach((sub, i) => {
        rows.push(
          <Box key={`lane-${k}-${i}`} flexDirection="row">
            <Box width={left} paddingRight={1}>
              {i === 0 ? modelChip(el, lane.a) : <Text dimColor>{'  ∥'}</Text>}
            </Box>
            {track(el, data, plan, sub, scale, actions)}
          </Box>,
        )
        const open = sub.find(t => t.id === data.selected)
      })
    }
    return <Box flexDirection="column" gap="sm">{rows}</Box>
  }

  for (const n of [...new Set(plan.tasks.map(t => t.sprint))].sort((a, b) => a - b)) {
    const tasks = plan.tasks.filter(t => t.sprint === n)
    const isCollapsed = data.collapsed.includes(n)
    const start = Math.min(...tasks.map(t => t.plannedStart))
    const end = Math.max(...tasks.map(t => t.plannedStart + t.estimateMin))
    const done = tasks.filter(t => t.status === 'done').length
    const isEditing = data.sprintEdit?.n === n
    rows.push(
      <Box key={`sprint-${n}`} flexDirection="row" alignItems="center" marginTop="lg">
        <Button key={`fold-${n}`} plain onPress={() => actions.toggleSprint(n)}>
          <Text bold color="claude" wrap="truncate-end">
            {isCollapsed ? '▸' : '▾'} {sprintName(plan.sprints, n)}
          </Text>
        </Button>
        <Text color={done === tasks.length ? 'success' : 'inactive'}>{`  ${done}/${tasks.length} done`}</Text>
        <Text dimColor>{` · ${fmtMin(end - start)}`}</Text>
        <Box flexGrow={1} />
        {editable && (
          <Button key={`assign-${n}`} plain onPress={() => actions.editSprint(isEditing ? null : { n, value: '' })}>
            <Text color="suggestion">Assign all</Text>
          </Button>
        )}
      </Box>,
    )
    if (isEditing && Select) {
      rows.push(
        <Box key={`sprint-edit-${n}`} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap" paddingLeft={2}>
          <Text dimColor>Model for all</Text>
          <Select
            key={`sprint-${n}`}
            options={[{ value: '', label: 'Choose…' }, ...assigneeOptions(data.agents)]}
            value={data.sprintEdit!.value}
            onSelect={(v: string) => actions.editSprint({ n, value: v })}
          />
          <Button key={`apply-${n}`} variant="primary" onPress={actions.applySprint}>
            Apply
          </Button>
          <Button key={`cancel-${n}`} plain onPress={() => actions.editSprint(null)}>
            Close
          </Button>
        </Box>,
      )
    }
    if (isCollapsed) continue
    for (const t of tasks) {
      const isSelected = data.selected === t.id
      rows.push(
        <Box key={`row-${t.id}`} flexDirection="row" alignItems="center">
          <Box width={left} paddingLeft={2} paddingRight={1} overflow="hidden">
            <Button key={`row-${t.id}`} plain onPress={() => actions.select(isSelected ? null : t.id)}>
              <Text wrap="truncate-end" bold={isSelected}>
                <Text color={colorOf(t.assignee)}>●</Text> <Text dimColor>{t.id}</Text> {t.title}
              </Text>
            </Button>
          </Box>
          {track(el, data, plan, [t], scale, actions)}
        </Box>,
      )
    }
  }
  return <Box flexDirection="column" gap="sm">{rows}</Box>
}

/** Under the chart: the tasks, one row each, with the model picker. */
function taskList(el: El, data: ViewData, plan: PmPlan, actions: ViewActions) {
  const { Box, Text, Button } = el
  const narrow = data.columns < 75
  return (
    <Box flexDirection="column" gap="sm">
      {!narrow && (
        <Box key="li-head" flexDirection="row" backgroundColor="inactive" paddingY="xs">
          <Box width="8%" paddingLeft={1}>
            <Text bold color="inverseText">#</Text>
          </Box>
          <Box width="34%">
            <Text bold color="inverseText">Task</Text>
          </Box>
          <Box width="14%">
            <Text bold color="inverseText">Status</Text>
          </Box>
          <Box width="34%">
            <Text bold color="inverseText">Model</Text>
          </Box>
          <Box width="10%" justifyContent="flex-end">
            <Text bold color="inverseText">Est. </Text>
          </Box>
        </Box>
      )}
      {plan.tasks.map(t => {
        const title = (
          <Button key={`li-${t.id}`} plain onPress={() => actions.select(data.selected === t.id ? null : t.id)}>
            <Text wrap="truncate-end" bold={data.selected === t.id}>
              {t.title}
            </Text>
          </Button>
        )
        if (narrow) {
          return (
            <Box key={`li-${t.id}`} flexDirection="column" gap="xs" paddingY="xs">
              <Box flexDirection="row" gap={1}>
                <Text dimColor>{t.id}</Text>
                {title}
                <Box flexGrow={1} />
                {statusText(el, t.status)}
              </Box>
              <Box flexDirection="row" gap={1} alignItems="center">
                {modelSelect(el, data, t, actions, 'li-as')}
                <Text dimColor>{fmtMin(t.estimateMin)}</Text>
              </Box>
            </Box>
          )
        }
        return (
          <Box key={`li-${t.id}`} flexDirection="row" alignItems="center" paddingY="xs">
            <Box width="8%" paddingLeft={1}>
              <Text dimColor>{t.id}</Text>
            </Box>
            <Box width="34%" paddingRight={1}>
              {title}
            </Box>
            <Box width="14%">{statusText(el, t.status)}</Box>
            <Box width="34%">{modelSelect(el, data, t, actions, 'li-as')}</Box>
            <Box width="10%" justifyContent="flex-end">
              <Text dimColor>{fmtMin(t.estimateMin)}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

const COLUMNS: { title: string; statuses: TaskStatus[]; color: string }[] = [
  { title: 'To do', statuses: ['todo'], color: 'suggestion' },
  { title: 'Running', statuses: ['running'], color: 'claude' },
  { title: 'Done', statuses: ['done'], color: 'success' },
  { title: 'Failed', statuses: ['failed', 'cancelled'], color: 'error' },
]

function board(el: El, data: ViewData, plan: PmPlan, actions: ViewActions) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {COLUMNS.map(c => {
          const tasks = plan.tasks.filter(t => c.statuses.includes(t.status))
          return (
            <Box key={`col-${c.title}`} flexDirection="column" width="25%">
              <Text inverse bold color={c.color}>{` ${c.title} ${tasks.length} `}</Text>
              {tasks.map(t => (
                <Box key={`cardbox-${t.id}`} flexDirection="column" marginBottom={1}>
                  <Button key={`card-${t.id}`} plain onPress={() => actions.select(data.selected === t.id ? null : t.id)}>
                    <Text wrap="truncate-end" bold={data.selected === t.id}>
                      <Text color={STATUS[t.status].color}>{STATUS[t.status].icon}</Text> <Text dimColor>{t.id}</Text> {t.title}
                    </Text>
                  </Button>
                  {modelSelect(el, data, t, actions, 'card-as')}
                </Box>
              ))}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// What we know about each agent, from strongest proof to weakest.
const AUTH = {
  ok: { label: 'Works', color: 'success' },
  unverified: { label: 'Not tested', color: 'suggestion' },
  failing: { label: "Can't run", color: 'error' },
  missing: { label: 'Sign-in needed', color: 'warning' },
  unknown: { label: 'Unknown', color: 'inactive' },
}

function agentsPanel(el: El, data: ViewData, actions: ViewActions) {
  const { Box, Text, Button, Input, Link, Select } = el
  const narrow = data.columns < 75
  const s = data.signin
  const url = s?.log.match(/https?:\/\/[^\s"'<>)]+/)?.[0]
  const code = s?.log.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/)?.[0]
  return (
    <Box flexDirection="column" gap="md">
      {data.agents.length === 0 && <Text dimColor>Looking for agents…</Text>}
      {data.agents.map(raw => {
        // Entries detected by an older load of this mod lack the sign-in fields.
        const a = { ...raw, auth: raw.auth ?? 'unknown', signin: raw.signin ?? { browser: false } }
        const isTesting = data.testing.includes(a.engine)
        const state = !a.isInstalled ? { label: 'Not installed', color: 'inactive' } : isTesting ? { label: 'Testing…', color: 'claude' } : (AUTH[a.auth] ?? AUTH.unknown)
        const isPending = s?.engine === a.engine
        const action =
          a.engine === 'claude' ? null : !a.isInstalled ? (
            INSTALL[a.engine] ? <Link key={`install-${a.engine}`} href={INSTALL[a.engine]!} label="Install" /> : null
          ) : (
            <Box flexDirection="row" gap={1}>
              {a.auth !== 'missing' && !isTesting && (
                <Button
                  key={`test-${a.engine}`}
                  variant={a.auth === 'unverified' ? 'primary' : undefined}
                  plain={a.auth === 'unverified' ? undefined : true}
                  onPress={() => actions.testAgent(a.engine)}
                >
                  {a.auth === 'ok' || a.auth === 'failing' ? 'Test again' : 'Test'}
                </Button>
              )}
              {a.signin.browser && !isPending && (
                <Button key={`signin-${a.engine}`} variant={a.auth === 'missing' ? 'primary' : undefined} plain={a.auth === 'missing' ? undefined : true} onPress={() => actions.signIn(a.engine)}>
                  {a.auth === 'missing' ? 'Sign in' : 'Sign in again'}
                </Button>
              )}
              {(a.signin.apiKey || a.signin.provider) && Input && (
                <Button
                  key={`key-${a.engine}`}
                  variant={a.auth === 'missing' && !a.signin.browser ? 'primary' : undefined}
                  plain={a.auth === 'missing' && !a.signin.browser ? undefined : true}
                  onPress={() => actions.showKeyInput(data.keyFor === a.engine ? null : a.engine)}
                >
                  {a.signin.provider ? 'Connect provider' : 'Use API key'}
                </Button>
              )}
            </Box>
          )
        return (
          <Box key={`ag-${a.engine}`} flexDirection="column">
            <Box flexDirection={narrow ? 'column' : 'row'} gap={narrow ? 0 : 1} alignItems={narrow ? 'flex-start' : 'center'}>
              <Box flexDirection="row" gap={1} width={narrow ? undefined : '50%'}>
                <Text bold={a.isInstalled} dimColor={!a.isInstalled}>
                  {a.label}
                </Text>
                <Text inverse bold color={state.color}>{` ${state.label} `}</Text>
              </Box>
              <Box flexGrow={1} />
              {action}
            </Box>
            {a.auth === 'failing' && a.failReason && (
              <Text color="error" wrap="wrap">
                {a.failReason}
              </Text>
            )}
            {data.keyFor === a.engine && Input && (
              <Input
                key={`keyinput-${a.engine}`}
                label={a.signin.provider ?? a.signin.apiKey}
                placeholder={a.signin.provider ? 'openai, anthropic, openrouter…' : 'Paste the key; it goes straight to the CLI'}
                submitLabel={a.signin.provider ? 'Connect' : 'Save'}
                autoFocus
                onSubmit={(v: string) => actions.submitKey(a.engine, v)}
              />
            )}
            {isPending && s && (
              <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap" paddingLeft={2}>
                {s.isRunning ? (
                  <>
                    {url && <Link key={`url-${a.engine}`} href={url} label="Open sign-in page" />}
                    {code && <Text>code <Text bold>{code}</Text></Text>}
                    <Button key="signin-done" variant="primary" onPress={actions.confirmSignin}>
                      I've signed in
                    </Button>
                    <Button key="signin-close" plain onPress={actions.closeSignin}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Text color={s.ok ? 'success' : 'error'} wrap="truncate-end">
                      {s.ok ? 'Signed in' : `Sign-in failed: ${s.log.trim().split('\n').pop() ?? ''}`}
                    </Text>
                    <Button key="signin-close" plain onPress={actions.closeSignin}>
                      Close
                    </Button>
                  </>
                )}
              </Box>
            )}
          </Box>
        )
      })}
      <Box flexDirection="row" gap={1} alignItems="center" marginTop={1}>
        <Text dimColor>External agents may</Text>
        {Select ? (
          <Select
            key="autonomy"
            options={[
              { value: 'edit', label: 'Edit files only' },
              { value: 'full', label: 'Run anything' },
            ]}
            value={data.autonomy}
            onSelect={(v: string) => actions.setAutonomy(v === 'full' ? 'full' : 'edit')}
          />
        ) : (
          <Button key="autonomy" plain onPress={() => actions.setAutonomy(data.autonomy === 'full' ? 'edit' : 'full')}>
            {data.autonomy === 'full' ? 'Run anything' : 'Edit files only'} ↻
          </Button>
        )}
      </Box>
    </Box>
  )
}

export function PmView(props: { el: El; data: ViewData; actions: ViewActions }) {
  const { el, data, actions } = props
  const { Box, Text, Button, Select } = el
  const { plan } = data
  const narrow = data.columns < 75
  const installed = data.agents.filter(a => a.isInstalled).length
  const needsSignin = data.agents.some(a => a.isInstalled && (a.auth === 'missing' || a.auth === 'failing'))
  const hasFailed = plan?.tasks.some(t => t.status === 'failed' || t.status === 'cancelled')
  // A finished run with anything not done needs a look, not a green "Done".
  const phaseInfo = plan && (plan.phase === 'done' && plan.tasks.some(t => t.status !== 'done') ? { label: 'Needs attention', color: 'warning' } : PHASE[plan.phase])
  const mode = (
    <Button key="mode" plain onPress={actions.toggleMode}>
      <Text inverse bold color={data.isOn ? 'success' : 'inactive'}>{data.isOn ? ' PM ON ' : ' PM OFF '}</Text>
    </Button>
  )
  const viewValue = `${data.tab}:${data.tab === 'timeline' ? data.groupBy : 'task'}`
  const setView = (v: string) => {
    const [tab, group] = v.split(':') as [PmTab, GroupBy]
    actions.setTab(tab)
    if (tab === 'timeline') actions.setGroupBy(group)
  }
  const caption = plan ? `${plan.tasks.length} tasks · ~${fmtMin(planSpan(plan))} · up to ${maxParallel(plan)} in parallel` : ''
  const orchestratorLabel = CLAUDE_MODELS.find(m => m.id === data.orchestrator)?.label ?? data.orchestrator
  const orchestrator = Select ? (
    <Select
      key="orchestrator"
      options={CLAUDE_MODELS.map(m => ({ value: m.id, label: `Orchestrator: ${m.label}` }))}
      value={data.orchestrator}
      onSelect={(v: string) => actions.setOrchestrator(v)}
    />
  ) : (
    <Button
      key="orchestrator"
      plain
      onPress={() => actions.setOrchestrator(CLAUDE_MODELS[(CLAUDE_MODELS.findIndex(m => m.id === data.orchestrator) + 1) % CLAUDE_MODELS.length]!.id)}
    >
      Orchestrator: {orchestratorLabel} ↻
    </Button>
  )
  const phasePill = phaseInfo && (
    <Text inverse bold color={phaseInfo.color}>
      {` ${phaseInfo.label} `}
    </Text>
  )

  const project = section(
    el,
    'sec-project',
    'Claude mode for PM',
    'claude',
    <Box flexDirection="column" gap="md">
      <Box flexDirection="column" gap="sm">
        <Text bold size="title" wrap={narrow ? 'wrap' : 'truncate-end'}>
          {plan?.goal ?? 'No plan yet'}
        </Text>
        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          {phasePill}
          <Text dimColor wrap="wrap">
            {plan ? caption : data.isOn ? `Describe what to build in the prompt box; ${orchestratorLabel} plans it here.` : 'Turn PM mode on, then describe what to build.'}
          </Text>
        </Box>
      </Box>
      <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        {orchestrator}
        <Box flexGrow={1} />
        <Button key="agents-toggle" plain onPress={actions.toggleAgents}>
          <Text color={needsSignin ? 'warning' : 'ide'}>
            Agents {installed}
            {needsSignin ? ' ⚠' : ''}
          </Text>
        </Button>
        {plan?.phase === 'review' && (
          <Button key="approve" variant="primary" hotkey="a" onPress={actions.approve}>
            ▶ Start sprint
          </Button>
        )}
        {plan?.phase === 'running' && (
          <Button key="stop" variant="secondary" hotkey="s" onPress={actions.stop}>
            ■ Stop
          </Button>
        )}
        {plan && plan.phase !== 'running' && plan.phase !== 'review' && hasFailed && (
          <Button key="retry" variant="primary" onPress={actions.retryFailed}>
            ↻ Retry failed
          </Button>
        )}
      </Box>
    </Box>,
    mode,
  )

  const viewPicker = (plan || data.tab === 'backlog') && (
    <Box flexDirection="row" gap={1}>
      {Select ? (
        <Select key="view" options={VIEWS} value={viewValue} onSelect={(v: string) => setView(v)} />
      ) : (
        <Button key="view-next" plain onPress={() => setView(VIEWS[(VIEWS.findIndex(o => o.value === viewValue) + 1) % VIEWS.length]!.value)}>
          {VIEWS.find(o => o.value === viewValue)?.label} ↻
        </Button>
      )}
    </Box>
  )

  return (
    <Box flexDirection="column" gap="lg">
      {project}
      {data.showAgents &&
        section(
          el,
          'sec-agents',
          'Agents',
          needsSignin ? 'warning' : 'ide',
          agentsPanel(el, data, actions),
          <Box flexDirection="row" gap={1}>
            <Button key="test-all" plain onPress={actions.testAll}>
              <Text color="suggestion">Test all</Text>
            </Button>
            <Button key="refresh" plain onPress={actions.refreshAgents}>
              Refresh
            </Button>
            <Button key="agents-close" plain role="dismiss" onPress={actions.toggleAgents}>
              Close
            </Button>
          </Box>,
        )}
      {data.tab === 'backlog' && section(el, 'sec-backlog', 'Backlog', 'permission', backlog(el, data), viewPicker)}
      {plan &&
        data.tab !== 'backlog' &&
        section(
          el,
          'sec-plan',
          data.tab === 'board' ? 'Board' : 'Timeline',
          'permission',
          data.tab === 'board' ? board(el, data, plan, actions) : timeline(el, data, plan, actions),
          viewPicker,
        )}
      {plan &&
        data.tab === 'timeline' &&
        section(
          el,
          'sec-tasks',
          `Tasks · ${plan.tasks.length}`,
          'planMode',
          taskList(el, data, plan, actions),
          plan.phase !== 'running' ? (
            <Button key="clear" plain onPress={actions.clear}>
              <Text dimColor>Clear plan</Text>
            </Button>
          ) : undefined,
        )}
    </Box>
  )
}

/** Every sprint of this directory: archived plans first, the current plan last. */
function backlog(el: El, data: ViewData) {
  const { Box, Text } = el
  const cur = data.plan
  const plans = [...(data.history ?? []).filter(h => h.createdAt !== cur?.createdAt), ...(cur ? [cur] : [])]
  if (plans.length === 0) return <Text dimColor>No sprints in this directory yet. Plan a goal with /pm &lt;goal&gt;.</Text>
  return (
    <Box flexDirection="column" gap="md">
      {plans.map(p => {
        const ns = [...new Set([...p.sprints.map(s => s.n), ...p.tasks.map(t => t.sprint)])].sort((a, b) => a - b)
        return (
          <Box key={`plan-${p.createdAt}`} flexDirection="column" gap="sm">
            <Text bold wrap="wrap">
              {p.goal}
              {p === cur ? ' (current)' : ' (archived)'}
            </Text>
            {ns.map(n => {
              const tasks = p.tasks.filter(t => t.sprint === n)
              const done = tasks.filter(t => t.status === 'done').length
              return (
                <Box key={`sprint-${p.createdAt}-${n}`} flexDirection="column">
                  <Text bold dimColor>
                    {`Sprint ${n} · ${sprintName(p.sprints, n)} · ${done}/${tasks.length} done`}
                  </Text>
                  {tasks.map(t => (
                    <Box key={`task-${p.createdAt}-${t.id}`} flexDirection="row" gap={1}>
                      <Text color={STATUS[t.status].color}>{STATUS[t.status].icon}</Text>
                      <Text dimColor>{t.id}</Text>
                      <Text wrap="truncate-end">{t.title}</Text>
                      <Text dimColor>{`· ${assigneeLabel(t.assignee)} · ${fmtMin(t.estimateMin)}`}</Text>
                    </Box>
                  ))}
                </Box>
              )
            })}
          </Box>
        )
      })}
    </Box>
  )
}

/** The task dialog: its own pane, opened when a task is clicked. */
export function TaskDialog(props: { el: El; data: ViewData; actions: ViewActions }) {
  const { el, data, actions } = props
  const { Text } = el
  const t = data.plan?.tasks.find(x => x.id === data.selected)
  if (!data.plan || !t) return <Text dimColor>No task selected.</Text>
  return issuePanel(el, data, data.plan, t, actions)
}
