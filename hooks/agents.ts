import type { EngineInterface } from 'claude-code'

import type { Assignee, AuthState, Autonomy, DetectedAgent, Engine } from '../types'
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
  // Gemini CLI has no model listing: offer its default plus a model pinned in settings.
  const home = await $.env.get('HOME')
  try {
    const settings = JSON.parse(await $.fs.read(`${home}/.gemini/settings.json`)) as { model?: { name?: string } }
    return { models: settings.model?.name ? [settings.model.name] : [] }
  } catch {
    return { models: [] }
  }
}

const SIGNIN: Record<Engine, DetectedAgent['signin']> = {
  claude: { browser: false },
  codex: { browser: true, apiKey: 'OpenAI API key' },
  grok: { browser: true },
  gemini: { browser: false, apiKey: 'Gemini API key' },
  opencode: { browser: false, provider: 'Provider to connect' },
}

/** Whether an agent CLI holds credentials, read from its own status commands and files. */
async function authOf($: EngineInterface, engine: Engine): Promise<{ auth: AuthState; authNote?: string }> {
  if (engine === 'codex') {
    const r = await run($, ['codex', 'login', 'status'])
    const text = `${r?.stdout ?? ''}${r?.stderr ?? ''}`.trim()
    if (!r) return { auth: 'unknown' }
    return r.exitCode === 0 && /logged in/i.test(text) ? { auth: 'ok', authNote: text.split('\n')[0] } : { auth: 'missing' }
  }
  if (engine === 'grok') {
    const r = await run($, ['grok', 'models'])
    if (!r) return { auth: 'unknown' }
    return /not authenticated/i.test(`${r.stdout}${r.stderr}`) ? { auth: 'missing' } : { auth: 'ok' }
  }
  if (engine === 'opencode') {
    const r = await run($, ['opencode', 'auth', 'list'])
    const lines = (r?.stdout ?? '').split('\n').map(l => l.trim()).filter(l => /\b(stored|logged|oauth|api key)\b/i.test(l))
    const providers = lines.map(l => l.split(/\s{2,}/)[0]).filter(Boolean)
    return providers.length
      ? { auth: 'ok', authNote: `Connected: ${providers.join(', ')}. Free OpenCode models need no sign-in.` }
      : { auth: 'missing', authNote: 'No provider connected. Free OpenCode models still work.' }
  }
  // Gemini: an API key in the environment or ~/.gemini/.env, or a cached Google sign-in.
  const home = await $.env.get('HOME')
  if ((await $.env.get('GEMINI_API_KEY')) || (await $.env.get('GOOGLE_API_KEY'))) return { auth: 'ok', authNote: 'Using an API key from the environment.' }
  try {
    if (/GEMINI_API_KEY\s*=\s*\S/.test(await $.fs.read(`${home}/.gemini/.env`))) return { auth: 'ok', authNote: 'Using the API key in ~/.gemini/.env.' }
  } catch {}
  if (home && (await $.fs.exists(`${home}/.gemini/oauth_creds.json`))) return { auth: 'ok', authNote: 'Signed in with Google.' }
  return { auth: 'missing', authNote: 'Add an API key here, or run `gemini` once in a terminal to sign in with Google.' }
}

/** The sign-in command for an agent's browser or device flow. */
export function signinArgv(engine: Engine): string[] | undefined {
  if (engine === 'codex') return ['codex', 'login']
  if (engine === 'grok') return ['grok', 'login', '--device-auth']
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
  const external: Engine[] = ['codex', 'gemini', 'opencode', 'grok']
  const found = await Promise.all(
    external.map(async (engine): Promise<DetectedAgent> => {
      const path = await which($, engine)
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
    case 'gemini':
      return ['gemini', '--skip-trust', '--approval-mode', full ? 'yolo' : 'auto_edit',
        ...(model ? ['-m', model] : []), '-p', prompt]
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
