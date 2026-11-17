import type { EngineInterface } from 'claude-code'

import type { AgentHealth, Assignee, AuthState, Autonomy, DetectedAgent, Engine } from '../types'
import { CLAUDE_MODELS, ENGINE_LABEL } from './plan'

const BUILTIN_AGENT_TYPES = ['general-purpose', 'Explore', 'Plan']

async function run($: EngineInterface, argv: string[], timeoutMs = 30000) {
  try {
    return await $.process.run(argv, { timeoutMs })
  } catch {
    return undefined
  }
}

async function which($: EngineInterface, bin: string): Promise<string | undefined> {
  const r = await run($, ['sh', '-c', `command -v ${bin}`], 5000)
  return r && r.exitCode === 0 ? r.stdout.trim() : undefined
}

async function agentFiles($: EngineInterface, dir: string): Promise<string[]> {
  try {
    const entries = await $.fs.list(dir)
    return entries.filter(f => f.kind === 'file' && f.name.endsWith('.md')).map(f => f.name.slice(0, -3))
  } catch {
    return []
  }
}

async function detectClaude($: EngineInterface): Promise<DetectedAgent> {
  const home = await $.env.get('HOME')
  const cwd = await $.session.cwd()
  const types = [
    ...BUILTIN_AGENT_TYPES,
    ...(home ? await agentFiles($, `${home}/.claude/agents`) : []),
    ...(await agentFiles($, `${cwd}/.claude/agents`)),
  ]
  return {
    engine: 'claude',
    label: 'Claude Code',
    isInstalled: true,
    models: CLAUDE_MODELS.map(m => m.id),
    agentTypes: [...new Set(types)],
    note: 'Subagents run inside this session.',
    auth: 'ok',
    signin: { browser: false },
  }
}

async function modelsOf($: EngineInterface, engine: Engine): Promise<{ models: string[]; note?: string }> {
  if (engine === 'codex') {
    const r = await run($, ['codex', 'debug', 'models'])
    try {
      const data = JSON.parse(r?.stdout ?? '') as { models?: { slug: string; visibility?: string }[] }
      return { models: (data.models ?? []).filter(m => m.visibility !== 'hide').map(m => m.slug) }
    } catch {
      return { models: [], note: 'Could not read the model list (codex debug models).' }
    }
  }
  if (engine === 'opencode') {
    const r = await run($, ['opencode', 'models'], 60000)
    const models = (r?.stdout ?? '').split('\n').map(l => l.trim()).filter(l => /^[\w.-]+\/\S+$/.test(l))
    return { models, note: models.length ? undefined : 'No models listed (opencode auth?).' }
  }
  if (engine === 'grok') {
    const r = await run($, ['grok', 'models'])
    const text = `${r?.stdout ?? ''}\n${r?.stderr ?? ''}`
    const models = [...text.matchAll(/^\s*[*-]\s+([\w.-]+)/gm)].map(m => m[1]!)
    return { models }
  }
  // Antigravity CLI (`agy models`) lists model slugs, one per line; needs a signed-in session.
  const r = await run($, ['agy', 'models'], 60000)
  const models = (r?.stdout ?? '').split('\n').map(l => l.trim().replace(/^[*-]\s+/, '').split(/\s+/)[0] ?? '').filter(l => /^[\w.-]+$/.test(l))
  return { models, note: models.length ? undefined : 'No models listed (sign in with `agy` once).' }
}

const BIN: Partial<Record<Engine, string>> = { antigravity: 'agy' }

const SIGNIN: Record<Engine, DetectedAgent['signin']> = {
  claude: { browser: false },
  codex: { browser: true, apiKey: 'OpenAI API key' },
  grok: { browser: true },
  antigravity: { browser: true, apiKey: 'Gemini API key' },
  opencode: { browser: true, provider: 'Provider to connect' },
}

/** Whether an agent CLI holds credentials, read from its own status commands and files. */
async function authOf($: EngineInterface, engine: Engine): Promise<{ auth: AuthState; authNote?: string }> {
  if (engine === 'codex') {
    const r = await run($, ['codex', 'login', 'status'])
    const text = `${r?.stdout ?? ''}${r?.stderr ?? ''}`.trim()
    if (!r) return { auth: 'unknown' }
    return r.exitCode === 0 && /logged in/i.test(text) ? { auth: 'unverified', authNote: text.split('\n')[0] } : { auth: 'missing' }
  }
  if (engine === 'grok') {
    const r = await run($, ['grok', 'models'])
    if (!r) return { auth: 'unknown' }
    return /not authenticated/i.test(`${r.stdout}${r.stderr}`) ? { auth: 'missing' } : { auth: 'unverified' }
  }
  if (engine === 'opencode') {
    const r = await run($, ['opencode', 'auth', 'list'])
    const lines = (r?.stdout ?? '').split('\n').map(l => l.trim()).filter(l => /\b(stored|logged|oauth|api key)\b/i.test(l))
    const providers = lines.map(l => l.split(/\s{2,}/)[0]).filter(Boolean)
    return providers.length
      ? { auth: 'unverified', authNote: `Connected: ${providers.join(', ')}.` }
      : { auth: 'unverified', authNote: 'No provider connected; the free OpenCode models still work.' }
  }
  // Antigravity: GEMINI_API_KEY (with modelProvider "gemini"), or a cached sign-in kept in the OS keyring.
  const home = await $.env.get('HOME')
  if (await $.env.get('GEMINI_API_KEY')) return { auth: 'unverified', authNote: 'Using an API key from the environment.' }
  try {
    const hasKey = (await $.fs.read(`${home}/.gemini/pm-mode-key`)).trim().length > 0
    const provider = JSON.parse(await $.fs.read(`${home}/.gemini/antigravity-cli/settings.json`))?.modelProvider
    if (hasKey && provider === 'gemini') return { auth: 'unverified', authNote: 'Using the saved Gemini API key.' }
  } catch {}
  if (home && (await $.fs.exists(`${home}/.gemini/antigravity-cli/settings.json`))) return { auth: 'unverified', authNote: 'Antigravity is set up; sign-in is cached by agy.' }
  return { auth: 'missing', authNote: 'Add an API key here, or run `agy` once in a terminal to sign in.' }
}

// Words an agent CLI prints when it refuses to run for its account, not for the task.
export const ACCOUNT_FAILURE =
  /(not authenticated|authenticat\w*|unauthori[sz]ed|forbidden|\b40[123]\b|payment|billing|credits?\b|balance|quota|exhausted|(?:no longer|not) supported|ineligible|free tier|rate.?limit|invalid api key|api key|log ?in|sign ?in|permission denied)/i

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

/** The most telling line of a failed run: an account error if there is one, else the last line. */
export function failureReason(output: string): string {
  const lines = stripAnsi(output)
    .split('\n')
    .map(l => l.trim())
    // stack frames say where it broke, not why
    .filter(l => l && !/^at\s/.test(l))
  const line = lines.find(l => ACCOUNT_FAILURE.test(l)) ?? lines[lines.length - 1] ?? 'It exited without saying why.'
  return line.length > 180 ? `${line.slice(0, 177)}…` : line
}

/** The command that runs a one-line test prompt through an agent's CLI. */
export function testArgv(engine: Engine): string[] {
  return argvFor({ engine, model: 'default' }, 'Reply with exactly the word OK and nothing else.', 'edit')
}

/** Lays what is known from real runs over what the credentials suggest. */
export function applyHealth(agents: DetectedAgent[], health: Partial<Record<Engine, AgentHealth>>): DetectedAgent[] {
  return agents.map(a => {
    const h = health[a.engine]
    if (!a.isInstalled || a.engine === 'claude' || !h || a.auth === 'missing') return a
    return h.ok ? { ...a, auth: 'ok', failReason: undefined } : { ...a, auth: 'failing', failReason: h.reason }
  })
}

/** The sign-in command for an agent's browser or device flow. */
export function signinArgv(engine: Engine): string[] | undefined {
  if (engine === 'codex') return ['codex', 'login']
  if (engine === 'grok') return ['grok', 'login', '--device-auth']
  // agy has no login subcommand: a print-mode run starts its browser sign-in when no session is cached.
  if (engine === 'antigravity') return ['agy', '-p', 'Reply with exactly the word OK and nothing else.']
  // ChatGPT device flow works without a terminal; other providers go through "Connect provider".
  if (engine === 'opencode') return ['opencode', 'auth', 'login', 'openai', '--method', 'chatgpt-headless']
  return undefined
}

/** Picks the opencode sign-in method for a provider: device, then browser, then key. */
export async function opencodeMethod($: EngineInterface, provider: string): Promise<{ method?: string; methods: string[]; error?: string }> {
  const r = await run($, ['opencode', 'auth', 'login', provider, '--method', '__pm_mode_list__'])
  const text = `${r?.stdout ?? ''}${r?.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '')
  const listed = text.match(/Available:\s*([^\n]+)/)?.[1]
  if (!listed) return { methods: [], error: text.split('\n').map(l => l.replace(/^[│■└┌\s]+/, '')).filter(Boolean).join(' ') || 'Unknown provider.' }
  const methods = listed.split(',').map(m => m.trim()).filter(Boolean)
  const method = methods.find(m => /headless|device/.test(m)) ?? methods.find(m => /browser|oauth/.test(m)) ?? methods[0]
  return { method, methods }
}

export async function detectAgents($: EngineInterface): Promise<DetectedAgent[]> {
  const external: Engine[] = ['codex', 'antigravity', 'opencode', 'grok']
  const found = await Promise.all(
    external.map(async (engine): Promise<DetectedAgent> => {
      const path = await which($, BIN[engine] ?? engine)
      if (!path) {
        return { engine, label: ENGINE_LABEL[engine], isInstalled: false, models: [], agentTypes: [], auth: 'unknown', signin: SIGNIN[engine] }
      }
      const [{ models, note }, { auth, authNote }] = await Promise.all([modelsOf($, engine), authOf($, engine)])
      return {
        auth,
        authNote,
        signin: SIGNIN[engine],
        engine,
        label: ENGINE_LABEL[engine],
        isInstalled: true,
        path,
        models: ['default', ...models.filter(m => m !== 'default')],
        agentTypes: [],
        note,
      }
    }),
  )
  return [await detectClaude($), ...found]
}

/** The headless command line for an external agent CLI. */
export function argvFor(a: Assignee, prompt: string, autonomy: Autonomy): string[] {
  const full = autonomy === 'full'
  const model = a.model && a.model !== 'default' ? a.model : undefined
  switch (a.engine) {
    case 'antigravity':
      // agy ignores .env: pass the saved key as GEMINI_API_KEY (read from a private file, not argv).
      return ['sh', '-c', 'f="$HOME/.gemini/pm-mode-key"; if [ -r "$f" ]; then GEMINI_API_KEY=$(cat "$f"); export GEMINI_API_KEY; fi; exec "$@"', 'sh',
        'agy', ...(full ? ['--dangerously-skip-permissions'] : ['--mode', 'accept-edits']),
        ...(model ? ['--model', model] : []), '-p', prompt]
    case 'codex':
      return ['codex', 'exec', '--skip-git-repo-check', '-s', full ? 'danger-full-access' : 'workspace-write',
        ...(model ? ['-m', model] : []), prompt]
    case 'opencode':
      return ['opencode', 'run', ...(full ? ['--auto'] : []), ...(model ? ['-m', model] : []), prompt]
    case 'grok':
      return ['grok', ...(full ? ['--always-approve'] : []), ...(model ? ['-m', model] : []), '-p', prompt]
    default:
      return []
  }
}
