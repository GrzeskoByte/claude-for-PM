import { expect, mock, test } from 'claude-code/testing'
import { argvFor, parsePiModels, signinArgv } from '../hooks/agents.js'
import type { On } from 'claude-code'
import type { Engine as TestEngine } from 'claude-code/testing'
import type { PmPlan } from '../types'
import { DEFAULT_ASSIGNEE, agentOptions, defaultModelKey, modelOptions } from '../hooks/plan.js'

const PANE = {
  plugin: 'pm-mode',
  component: 'Pane',
  requestId: 'pm-mode',
  props: {
    title: 'Claude mode for PM',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const PLAN = {
  goal: 'Add CSV export to the reports page',
  sprints: [
    { n: 1, name: 'Sprint 1 · Backend' },
    { n: 2, name: 'Sprint 2 · UI & docs' },
  ],
  tasks: [
    { id: 'T1', title: 'Export endpoint', definition: 'Add GET /reports.csv', sprint: 1, estimateMin: 20, engine: 'claude', model: 'claude-sonnet-5-5' },
    { id: 'T2', title: 'Endpoint tests', definition: 'Test it', sprint: 1, estimateMin: 10, dependsOn: ['T1'], engine: 'claude', model: 'claude-haiku-5-5' },
    { id: 'T3', title: 'Find report code', definition: 'Locate files', sprint: 1, estimateMin: 5, engine: 'codex', model: 'gpt-6.1-sol' },
    { id: 'T4', title: 'Export button', definition: 'Add the button', sprint: 2, estimateMin: 15, engine: 'claude', model: 'claude-sonnet-5-5' },
    { id: 'T5', title: 'Docs', definition: 'Document it', sprint: 2, estimateMin: 5, engine: 'claude', model: 'claude-haiku-5-5' },
  ],
}

function world(on: On, opts: { codexTest?: 'ok' | 'refused'; agy?: boolean; plan?: PmPlan } = {}) {
  mock.store(on, opts.plan ? { plan: opts.plan } : {})
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/u' })
  const spawned: { prompt: string; model?: string; description?: string }[] = []
  const submitted: string[] = []
  on('command.register', () => ({ value: { command: 'pm' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__pm-mode__${e.name}` } }))
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.exists', (_, e) => ({ value: !!opts.agy && e.path.endsWith('antigravity-cli/settings.json') }))
  on('fs.read', (_, e) => {
    if (opts.agy && e.path.endsWith('pm-mode-key')) return { value: 'KEY123\n' }
    if (opts.agy && e.path.endsWith('antigravity-cli/settings.json')) return { value: JSON.stringify({ modelProvider: 'gemini' }) }
    return { value: '{}' }
  })
  // Only codex is "installed" on this fake computer.
  on('process.run', (_, e) => {
    const cmd = e.argv.join(' ')
    if (opts.agy && cmd.includes('command -v agy')) return { value: { isStdoutTruncated: false, isStderrTruncated: false, exitCode: 0, stdout: '/bin/agy\n', stderr: '' } }
    if (opts.agy && cmd === 'agy models') return { value: { isStdoutTruncated: false, isStderrTruncated: false, exitCode: 0, stdout: 'gemini-3-pro\ngemini-3-flash\n', stderr: '' } }
    if (cmd.includes('command -v codex')) return { value: { isStdoutTruncated: false, isStderrTruncated: false, exitCode: 0, stdout: '/bin/codex\n', stderr: '' } }
    if (cmd.startsWith('codex exec') && cmd.includes('Reply with exactly the word OK')) {
      return opts.codexTest === 'ok'
        ? { value: { isStdoutTruncated: false, isStderrTruncated: false, exitCode: 0, stdout: 'OK\n', stderr: '' } }
        : { value: { isStdoutTruncated: false, isStderrTruncated: false, exitCode: 1, stdout: '', stderr: 'Error: API error (status 402 Payment Required): usage balance exhausted\n' } }
    }
    if (cmd === 'codex login status') return { value: { isStdoutTruncated: false, isStderrTruncated: false, exitCode: 0, stdout: 'Logged in using ChatGPT', stderr: '' } }
    if (cmd === 'codex debug models') {
      return { value: { isStdoutTruncated: false, isStderrTruncated: false, exitCode: 0, stdout: JSON.stringify({ models: [{ slug: 'gpt-6.1-sol', visibility: 'list' }] }), stderr: '' } }
    }
    return { value: { isStdoutTruncated: false, isStderrTruncated: false, exitCode: 1, stdout: '', stderr: '' } }
  })
  on('agent.spawn', (_, e) => {
    spawned.push({ prompt: e.prompt, model: e.model, description: e.description })
    return { model: e.model ?? 'x', agentId: `agent-${spawned.length}` }
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('process.spawn', async function* (_, e) {
    if (e.argv.join(' ') === 'codex login') {
      yield { stream: 'stdout' as const, text: 'Open https://auth.openai.com/oauth/authorize?x=1 to sign in' }
      return { value: { code: 0, signal: null } }
    }
    yield { stream: 'stdout' as const, text: 'codex found src/reports.ts' }
    return { value: { code: 0, signal: null } }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return { spawned, submitted, opened, clock }
}

const DIALOG = { ...PANE, requestId: 'pm-task', props: { ...PANE.props, title: 'Task' } } as const

test('Opus plan lands on the board, Gantt and agents view on every surface', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const res = await $.tool.call({ tool: 'mcp__pm-mode__pm_plan', ...PLAN })
  expect(JSON.stringify(res)).toContain('waiting for the user')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Add CSV export/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Planned/ })).toBeDefined()
    // Every task has a bar on the timeline and a line in the list below it.
    for (const id of ['T1', 'T2', 'T3', 'T4', 'T5']) {
      expect(await ui.find({ key: `bar-${id}` })).toBeDefined()
      expect(await ui.find({ key: `li-${id}` })).toBeDefined()
    }
    if (surface === 'mobile') expect(await ui.find({ key: 'view-next' })).toBeDefined()
    else {
      await $.ui.select({ plugin: 'pm-mode', surface, key: 'view', value: 'timeline:agent' })
      expect(await ui.find({ type: 'Text', text: /^Agent$/ })).toBeDefined()
      await $.ui.select({ plugin: 'pm-mode', surface, key: 'view', value: 'timeline:task' })
      await $.ui.select({ plugin: 'pm-mode', surface, key: 'view', value: 'board:task' })
      expect(await ui.find({ type: 'Text', text: /Running 0/ })).toBeDefined()
      await $.ui.select({ plugin: 'pm-mode', surface, key: 'view', value: 'timeline:task' })
    }
    await ui.press({ key: 'agents-toggle' })
    expect(await ui.find({ type: 'Text', text: /Not tested/ })).toBeDefined()
    await ui.press({ key: 'agents-toggle' })
    await ui.unmount()
  }
})

test('clicking a task opens it in a dialog where it is edited', async ($, on) => {
  const { opened } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__pm-mode__pm_plan', ...PLAN })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const plan = async () =>
    JSON.parse(String((await $.tool.call({ tool: 'mcp__pm-mode__pm_status' })).result)) as {
      tasks: { id: string; estimateMin: number; sprint: number; dependsOn: string[]; plannedStart: number; assignee: { engine: string; model: string } }[]
    }

  await ui.press({ key: 'bar-T3' })
  expect(opened).toContain('pm-task')
  // The task is no longer drawn inline under its row.
  expect(await ui.find({ key: 'close-T3' })).toBeUndefined()
  let dlg = await $.ui.mount({ ...DIALOG, surface: 'desktop' })
  expect(await dlg.find({ key: 'close-T3' })).toBeDefined()
  await dlg.press({ key: 'est-T3-up' })
  await dlg.press({ key: 'dep-T3-T1' })
  await dlg.select({ key: 'as-ag-T3', value: 'claude' })
  await dlg.select({ key: 'as-md-T3', value: 'claude-haiku-5-5' })
  await dlg.unmount()
  let t3 = (await plan()).tasks.find(t => t.id === 'T3')!
  expect(t3.estimateMin).toBe(6)
  expect(t3.dependsOn).toEqual(['T1'])
  expect(t3.plannedStart).toBe(20)
  expect(t3.assignee.model).toBe('claude-haiku-5-5')

  // The task list under the chart reassigns too.
  // Picking an agent resets the model to that agent's first model; the model picker then narrows it.
  await ui.select({ key: 'li-as-ag-T5', value: 'codex' })
  expect((await plan()).tasks.find(t => t.id === 'T5')!.assignee.engine).toBe('codex')
  await ui.select({ key: 'li-as-ag-T5', value: 'claude' })
  expect((await plan()).tasks.find(t => t.id === 'T5')!.assignee).toEqual({ engine: 'claude', model: 'claude-sonnet-5-5' })
  await ui.select({ key: 'li-as-md-T5', value: 'claude-opus-5-5' })
  expect((await plan()).tasks.find(t => t.id === 'T5')!.assignee.model).toBe('claude-opus-5-5')

  // T1 cannot wait for T3 now: that would be a loop.
  await ui.press({ key: 'bar-T1' })
  dlg = await $.ui.mount({ ...DIALOG, surface: 'desktop' })
  await dlg.press({ key: 'dep-T1-T3' })
  await dlg.unmount()
  expect((await plan()).tasks.find(t => t.id === 'T1')!.dependsOn).toEqual([])

  await ui.press({ key: 'bar-T3' })
  dlg = await $.ui.mount({ ...DIALOG, surface: 'desktop' })
  await dlg.select({ key: 'spr-T3', value: '2' })
  await dlg.press({ key: 'close-T3' })
  await dlg.unmount()
  t3 = (await plan()).tasks.find(t => t.id === 'T3')!
  expect(t3.sprint).toBe(2)
  await ui.unmount()
})

test('sign in to an external agent from the pane', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__pm-mode__pm_plan', ...PLAN })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'agents-toggle' })
  await ui.press({ key: 'signin-codex' })
  // The browser sign-in ran and finished: no error line is left under Codex.
  expect(await ui.find({ type: 'Text', text: /Sign-in failed/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Not tested/ })).toBeDefined()
  await ui.unmount()
})

test('reassign a sprint, approve, run in order, and report back to Opus', async ($, on) => {
  const { spawned, submitted } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__pm-mode__pm_plan', ...PLAN })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'assign-2' })
  await ui.select({ key: 'sprint-2', value: 'claude|claude-opus-5-5' })
  await ui.press({ key: 'apply-2' })
  await ui.press({ key: 'approve' })

  // Sprint 1: T1 goes to a Sonnet subagent and T3 runs in the Codex CLI, in
  // parallel; T2 waits for T1, and sprint 2 waits for all of sprint 1.
  expect(spawned.map(s => [s.description, s.model])).toEqual([['#T1 Export endpoint', 'sonnet']])
  expect(spawned[0]!.prompt).toContain('Add GET /reports.csv')
  const plan = JSON.parse(String((await $.tool.call({ tool: 'mcp__pm-mode__pm_status' })).result)) as {
    phase: string
    tasks: { id: string; status: string; output?: string; assignee: { model: string } }[]
  }
  const byId = Object.fromEntries(plan.tasks.map(t => [t.id, t]))
  expect(byId.T3!.status).toBe('done')
  expect(byId.T3!.output).toContain('codex found src/reports.ts')
  // Nothing beneath a test starts a real subagent, so T1 fails to start:
  // T2 is skipped, sprint 2 is held back, and the run goes back to Opus.
  expect(byId.T1!.status).toBe('failed')
  expect(byId.T2!.status).toBe('cancelled')
  expect(byId.T4!.status).toBe('todo')
  expect(byId.T4!.assignee.model).toBe('claude-opus-5-5')
  expect(plan.phase).toBe('done')
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('1 of 5 tasks done')
  expect(await ui.find({ key: 'retry' })).toBeDefined()
  await ui.unmount()
})

test('an agent that cannot run is shown with its reason and gets no tasks', async ($, on) => {
  world(on, { codexTest: 'refused' })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__pm-mode__pm_plan', ...PLAN })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'agents-toggle' })
  await ui.press({ key: 'test-codex' })
  expect(await ui.find({ type: 'Text', text: /Can't run/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /402 Payment Required/ })).toBeDefined()
  // A new plan that still names Codex falls back to Claude.
  await $.tool.call({ tool: 'mcp__pm-mode__pm_plan', ...PLAN })
  const plan = JSON.parse(String((await $.tool.call({ tool: 'mcp__pm-mode__pm_status' })).result)) as {
    tasks: { id: string; assignee: { engine: string } }[]
  }
  expect(plan.tasks.find(t => t.id === 'T3')!.assignee.engine).toBe('claude')
  await ui.unmount()
})

test('a test prompt that answers marks the agent as working', async ($, on) => {
  world(on, { codexTest: 'ok' })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__pm-mode__pm_plan', ...PLAN })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'agents-toggle' })
  expect(await ui.find({ type: 'Text', text: /Not tested/ })).toBeDefined()
  await ui.press({ key: 'test-codex' })
  expect(await ui.find({ type: 'Text', text: /Works/ })).toBeDefined()
  await ui.unmount()
})

test('Antigravity (agy) is detected, runs with the saved key, and reports its auth', async ($, on) => {
  world(on, { agy: true })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__pm-mode__pm_plan', ...PLAN })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'agents-toggle' })
  // Installed, and the saved key + gemini provider count as credentials (auth "unverified"), so it offers a test.
  expect(await ui.find({ key: 'test-antigravity' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Not tested/ })).toBeDefined()
  await ui.unmount()

  const argv = argvFor({ engine: 'antigravity', model: 'gemini-3-pro' }, 'do it', 'edit')
  expect(argv.slice(-6)).toEqual(['--mode', 'accept-edits', '--model', 'gemini-3-pro', '-p', 'do it'])
  expect(argv).toContain('agy')
  expect(argv.join(' ')).toContain('GEMINI_API_KEY')
  expect(argv.join(' ')).not.toContain('KEY123')
})

const PM_COMMAND = { command: 'pm', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

async function currentPlan($: TestEngine): Promise<PmPlan> {
  return JSON.parse(String((await $.tool.call({ tool: 'mcp__pm-mode__pm_status' })).result)) as PmPlan
}

// Seed persisted plans so command guards can be tested without racing a live run.
function savedPlan(phase: PmPlan['phase'] = 'review'): PmPlan {
  return {
    goal: PLAN.goal,
    sprints: PLAN.sprints,
    phase,
    createdAt: 0,
    tasks: PLAN.tasks.map((t, i) => ({
      ...t,
      dependsOn: t.dependsOn ?? [],
      assignee: { engine: t.engine, model: t.model } as PmPlan['tasks'][number]['assignee'],
      status: i < 3 ? 'done' : 'todo',
      plannedStart: 0,
    })),
  }
}

test('browser and device sign-in use the expected CLI arguments', async () => {
  expect(signinArgv('antigravity')).toEqual(['agy', '-p', 'Reply with exactly the word OK and nothing else.'])
  expect(signinArgv('opencode')).toEqual(['opencode', 'auth', 'login', 'openai', '--method', 'chatgpt-headless'])
  expect(signinArgv('codex')).toEqual(['codex', 'login'])
  expect(signinArgv('grok')).toEqual(['grok', 'login', '--device-auth'])
  expect(signinArgv('claude')).toBeUndefined()
})

test('pi runs headless with the chosen model and reads its model table', async () => {
  expect(argvFor({ engine: 'pi', model: 'anthropic/claude-sonnet-5-5' }, 'go', 'edit')).toEqual(
    ['pi', '-p', '--no-session', '--exclude-tools', 'bash', '--model', 'anthropic/claude-sonnet-5-5', 'go'],
  )
  expect(argvFor({ engine: 'pi', model: 'default' }, 'go', 'full')).toEqual(['pi', '-p', '--no-session', 'go'])
  const table = 'provider    model            context  max-out  thinking  images\nanthropic   claude-opus-5-5  1M       128K     yes       yes\nopenrouter  ~openai/gpt-6    400K     128K     yes       no\n'
  expect(parsePiModels(table)).toEqual(['anthropic/claude-opus-5-5', 'openrouter/~openai/gpt-6'])
  expect(parsePiModels('No models available. Use /login to log into a provider via OAuth or API key. See:\n  /x/providers.md\n')).toEqual([])
})

test('agent and model selectors default to Claude Sonnet and list every model', async () => {
  expect(DEFAULT_ASSIGNEE).toEqual({ engine: 'claude', model: 'claude-sonnet-5-5' })
  const oc = Array.from({ length: 500 }, (_, i) => `prov${i % 20}/model-${i}`)
  const agents = [
    { engine: 'opencode', label: 'OpenCode', isInstalled: true, models: oc, needsAuth: oc.slice(100) },
    { engine: 'pi', label: 'Pi', isInstalled: true, models: ['anthropic/claude-opus-5-5'] },
    { engine: 'codex', label: 'Codex', isInstalled: false, models: ['gpt-6.1-sol'] },
  ] as unknown as Parameters<typeof agentOptions>[0]
  expect(agentOptions(agents).map(o => o.value)).toEqual(['claude', 'opencode', 'pi'])
  expect(modelOptions(agents, 'opencode').map(o => o.value)).toEqual(oc)
  expect(modelOptions(agents, 'pi').map(o => o.value)).toEqual(['anthropic/claude-opus-5-5'])
  expect(defaultModelKey(agents, 'claude')).toBe('claude|claude-sonnet-5-5')
  expect(defaultModelKey(agents, 'pi')).toBe('pi|anthropic/claude-opus-5-5')
})

test('/pm add appends to the current unfinished sprint and persists the task', async ($, on) => {
  const original = savedPlan()
  const { opened, submitted } = world(on, { plan: original })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const text = 'Add export regression coverage for quoted fields and embedded newlines in CSV reports'
  const result = await $.command.run({ ...PM_COMMAND, args: `add ${text}` })
  expect(result.text).toBe(`Added #T6 to sprint 2: ${text}`)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const plan = await currentPlan($)
  expect(plan.tasks.slice(0, 5).map(t => [t.id, t.status, t.sprint])).toEqual(original.tasks.map(t => [t.id, t.status, t.sprint]))
  expect(plan.tasks[5]).toEqual(expect.objectContaining({
    id: 'T6', title: text.slice(0, 60), definition: text, sprint: 2,
    estimateMin: 10, dependsOn: [], assignee: DEFAULT_ASSIGNEE, status: 'todo',
  }))
  expect(plan.tasks[5]!.plannedStart).toBe(30)
  expect(opened).toContain('pm-mode')
  expect(submitted).toEqual([])
})

test('/pm add creates a review plan when none exists', async ($, on) => {
  const { opened } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  expect((await $.command.run({ ...PM_COMMAND, args: 'add Write docs' })).text).toBe('Added #T1 to sprint 1: Write docs')
  const plan = await currentPlan($)
  expect(plan.goal).toBe('Untitled plan')
  expect(plan.phase).toBe('review')
  expect(plan.sprints).toEqual([{ n: 1, name: 'Sprint 1' }])
  expect(plan.tasks.length).toBe(1)
  expect(plan.tasks[0]).toEqual(expect.objectContaining({ id: 'T1', definition: 'Write docs', sprint: 1, status: 'todo', plannedStart: 0 }))
  expect(opened).toContain('pm-mode')
})

test('/pm add with empty text shows usage without creating a plan', async ($, on) => {
  const { opened, submitted } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  for (const args of ['add', 'add   ', ' add \n\t ']) {
    expect((await $.command.run({ ...PM_COMMAND, args })).text).toBe('Usage: /pm add <task>')
  }
  expect((await $.tool.call({ tool: 'mcp__pm-mode__pm_status' })).result).toBe('No plan on the board.')
  expect(opened).toEqual([])
  expect(submitted).toEqual([])
})

test('/pm start without a plan explains how to create one', async ($, on) => {
  const { spawned, opened, submitted } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  expect((await $.command.run({ ...PM_COMMAND, args: 'start' })).text).toBe('No plan to start. Plan a goal with /pm <goal> or add a task with /pm add <task>.')
  expect((await $.tool.call({ tool: 'mcp__pm-mode__pm_status' })).result).toBe('No plan on the board.')
  expect(spawned).toEqual([])
  expect(opened).toEqual([])
  expect(submitted).toEqual([])
})

test('/pm start rejects an already running plan without restarting work', async ($, on) => {
  const { spawned, clock } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__pm-mode__pm_plan', ...PLAN })
  expect((await $.command.run({ ...PM_COMMAND, args: 'start' })).text).toBe('Started the run.')
  expect((await $.command.run({ ...PM_COMMAND, args: 'start' })).text).toBe('A run is already in progress.')
  await clock.advance(1)
  expect(spawned.map(s => s.description)).toEqual(['#T1 Export endpoint'])
})

test('/pm start launches the reviewed plan and reports its result', async ($, on) => {
  const { spawned, submitted, opened, clock } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__pm-mode__pm_plan', ...PLAN })
  expect((await $.command.run({ ...PM_COMMAND, args: 'start' })).text).toBe('Started the run.')
  // The run starts once the command hook has returned.
  expect(spawned).toEqual([])
  await clock.advance(1)
  const plan = JSON.parse(String((await $.tool.call({ tool: 'mcp__pm-mode__pm_status' })).result)) as PmPlan
  expect(spawned.map(s => s.description)).toEqual(['#T1 Export endpoint'])
  expect(plan.startedAt).toBeDefined()
  expect(plan.tasks.find(t => t.id === 'T3')!.status).toBe('done')
  expect(plan.phase).toBe('done')
  expect(submitted.length).toBe(1)
  expect(opened).toContain('pm-mode')
})

test('/pm <goal> returns first and submits the goal as a prompt afterwards', async ($, on) => {
  const { submitted, opened, clock } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const result = await $.command.run({ ...PM_COMMAND, args: 'write a hello world script' })
  expect(result.text).toBe('Claude mode for PM is on. Planning: write a hello world script')
  expect(opened).toContain('pm-mode')
  // Submitting from inside the command hook is refused by the host, so it happens on a later tick.
  expect(submitted).toEqual([])
  await clock.advance(1)
  expect(submitted).toEqual(['write a hello world script'])
})

test('/pm backlog with nothing planned shows an empty state', async ($, on) => {
  const { opened } = world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  expect((await $.command.run({ ...PM_COMMAND, args: 'backlog' })).text).toBe('Backlog: 0 plan(s), 0 task(s) in this directory.')
  expect(opened).toContain('pm-mode')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /No sprints in this directory yet/ })).toBeDefined()
  await ui.unmount()
})

test('/pm clear archives the plan and /pm backlog lists archived and current sprints', async ($, on) => {
  const { opened } = world(on, { plan: savedPlan() })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.command.run({ ...PM_COMMAND, args: 'clear' })
  expect((await $.tool.call({ tool: 'mcp__pm-mode__pm_status' })).result).toBe('No plan on the board.')
  await $.command.run({ ...PM_COMMAND, args: 'add Fresh task' })
  const result = await $.command.run({ ...PM_COMMAND, args: 'backlog' })
  expect(result.text).toBe('Backlog: 2 plan(s), 6 task(s) in this directory.')
  expect(opened).toContain('pm-mode')
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Add CSV export to the reports page \(archived\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Untitled plan \(current\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Sprint 1 · Sprint 1 · Backend|Sprint 1 · .*3\/3 done/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Export endpoint/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Fresh task/ })).toBeDefined()
    await ui.unmount()
  }
})

test('pm_status answers a subagent call', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__pm-mode__pm_plan', ...PLAN })
  const r = await $.tool.call({ tool: 'mcp__pm-mode__pm_status', agentId: 'agent-1' })
  expect(String(r.result)).toContain('Add CSV export')
})
