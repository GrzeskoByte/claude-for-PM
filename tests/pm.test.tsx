import { expect, mock, test } from 'claude-code/testing'

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

function world(on: Parameters<Parameters<typeof test>[1]>[1], opts: { codexTest?: 'ok' | 'refused' } = {}) {
  mock.store(on)
  mock.clock(on)
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
  on('fs.read', () => ({ value: '{}' }))
  // Only codex is "installed" on this fake computer.
  on('process.run', (_, e) => {
    const cmd = e.argv.join(' ')
    if (cmd.includes('command -v codex')) return { value: { exitCode: 0, stdout: '/bin/codex\n', stderr: '' } }
    if (cmd.startsWith('codex exec') && cmd.includes('Reply with exactly the word OK')) {
      return opts.codexTest === 'ok'
        ? { value: { exitCode: 0, stdout: 'OK\n', stderr: '' } }
        : { value: { exitCode: 1, stdout: '', stderr: 'Error: API error (status 402 Payment Required): usage balance exhausted\n' } }
    }
    if (cmd === 'codex login status') return { value: { exitCode: 0, stdout: 'Logged in using ChatGPT', stderr: '' } }
    if (cmd === 'codex debug models') {
      return { value: { exitCode: 0, stdout: JSON.stringify({ models: [{ slug: 'gpt-6.1-sol', visibility: 'list' }] }), stderr: '' } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: '' } }
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
  return { spawned, submitted, opened }
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
      await ui.select({ key: 'view', value: 'timeline:agent' })
      expect(await ui.find({ type: 'Text', text: /^Agent$/ })).toBeDefined()
      await ui.select({ key: 'view', value: 'timeline:task' })
      await ui.select({ key: 'view', value: 'board:task' })
      expect(await ui.find({ type: 'Text', text: /Running 0/ })).toBeDefined()
      await ui.select({ key: 'view', value: 'timeline:task' })
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
  await dlg.select({ key: 'as-T3', value: 'claude|claude-haiku-5-5' })
  await dlg.unmount()
  let t3 = (await plan()).tasks.find(t => t.id === 'T3')!
  expect(t3.estimateMin).toBe(6)
  expect(t3.dependsOn).toEqual(['T1'])
  expect(t3.plannedStart).toBe(20)
  expect(t3.assignee.model).toBe('claude-haiku-5-5')

  // The task list under the chart reassigns too.
  await ui.select({ key: 'li-as-T5', value: 'codex|gpt-6.1-sol' })
  expect((await plan()).tasks.find(t => t.id === 'T5')!.assignee).toEqual({ engine: 'codex', model: 'gpt-6.1-sol' })

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
