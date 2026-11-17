// Intro video for "Claude mode for PM": every frame is drawn in code.
// node render.js            -> raw RGBA frames on stdout (pipe into ffmpeg)
// node render.js --still 5.2 9 -> PNG stills in ./stills for review
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas')
const fs = require('fs')

GlobalFonts.registerFromPath('/usr/share/fonts/noto/NotoSans-Regular.ttf', 'Sans')
GlobalFonts.registerFromPath('/usr/share/fonts/noto/NotoSans-Bold.ttf', 'SansBold')
GlobalFonts.registerFromPath('/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Regular.ttf', 'Mono')
GlobalFonts.registerFromPath('/usr/share/fonts/noto/NotoSansSymbols2-Regular.ttf', 'Sym')
GlobalFonts.registerFromPath('/usr/share/fonts/noto/NotoSansSymbols-Regular.ttf', 'Sym1')

const W = 1280
const H = 720
const FPS = 30
const DURATION = 36

const C = {
  bg: '#141413',
  bg2: '#1c1b19',
  panel: '#22211f',
  line: '#3a3936',
  text: '#f0eee6',
  dim: '#a3a19a',
  faint: '#6b6a64',
  claude: '#D97757',
  sonnet: '#9FA8F5',
  haiku: '#4FA99D',
  codex: '#4F8AD6',
  gemini: '#7AA7FF',
  opencode: '#AF87FF',
  grok: '#9A9A9A',
  success: '#4EBA65',
  error: '#FF6B80',
  warning: '#F2B33D',
}

const canvas = createCanvas(W, H)
const g = canvas.getContext('2d')

// ---------- helpers ----------
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const lerp = (a, b, t) => a + (b - a) * t
const easeOut = t => 1 - Math.pow(1 - clamp(t), 3)
const easeInOut = t => {
  t = clamp(t)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
const back = t => {
  t = clamp(t)
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
/** 0..1 progress of t inside [a, b] */
const prog = (t, a, b) => clamp((t - a) / (b - a))
/** fade in over `fi` after a, fade out over `fo` before b */
const window_ = (t, a, b, fi = 0.5, fo = 0.5) => Math.min(prog(t, a, a + fi), 1 - prog(t, b - fo, b))

function rr(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}
function fillRR(x, y, w, h, r, color) {
  rr(x, y, w, h, r)
  g.fillStyle = color
  g.fill()
}
function strokeRR(x, y, w, h, r, color, lw = 1.5) {
  rr(x, y, w, h, r)
  g.strokeStyle = color
  g.lineWidth = lw
  g.stroke()
}
function text(s, x, y, { size = 20, color = C.text, font = 'Sans', align = 'left', base = 'alphabetic', alpha = 1 } = {}) {
  g.save()
  g.globalAlpha *= alpha
  g.font = `${size}px ${font}, Sym, Sym1`
  g.fillStyle = color
  g.textAlign = align
  g.textBaseline = base
  g.fillText(s, x, y)
  g.restore()
}
function measure(s, size, font = 'Sans') {
  g.font = `${size}px ${font}, Sym, Sym1`
  return g.measureText(s).width
}
function withAlpha(a, fn) {
  g.save()
  g.globalAlpha *= clamp(a)
  fn()
  g.restore()
}
function pill(label, x, y, color, { size = 14, fg = '#141413', pad = 10, h = 26, align = 'left' } = {}) {
  const w = measure(label, size, 'SansBold') + pad * 2
  const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
  fillRR(px, y, w, h, h / 2, color)
  text(label, px + w / 2, y + h / 2 + 1, { size, color: fg, font: 'SansBold', align: 'center', base: 'middle' })
  return w
}
function chip(label, x, y, color, { size = 15 } = {}) {
  g.beginPath()
  g.arc(x + 6, y, 6, 0, Math.PI * 2)
  g.fillStyle = color
  g.fill()
  text(label, x + 18, y + 1, { size, color: C.text, base: 'middle' })
  return 18 + measure(label, size)
}
function glow(x, y, r, color, a) {
  const grd = g.createRadialGradient(x, y, 0, x, y, r)
  grd.addColorStop(0, color)
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  withAlpha(a, () => {
    g.fillStyle = grd
    g.fillRect(x - r, y - r, r * 2, r * 2)
  })
}
function cursor(x, y, pressed = 0) {
  g.save()
  g.translate(x, y)
  g.scale(1 - pressed * 0.12, 1 - pressed * 0.12)
  g.beginPath()
  g.moveTo(0, 0)
  g.lineTo(0, 22)
  g.lineTo(6, 17)
  g.lineTo(10, 26)
  g.lineTo(14, 24)
  g.lineTo(10, 15)
  g.lineTo(17, 15)
  g.closePath()
  g.fillStyle = '#ffffff'
  g.fill()
  g.strokeStyle = '#141413'
  g.lineWidth = 1.5
  g.stroke()
  g.restore()
}
/** The product mark: three staggered Gantt bars. */
function mark(cx, cy, s, t) {
  const bars = [
    { x: -1, w: 1.3, c: C.claude },
    { x: -0.4, w: 1.1, c: C.sonnet },
    { x: 0.1, w: 0.9, c: C.haiku },
  ]
  bars.forEach((b, i) => {
    const p = easeOut(prog(t, 0.2 + i * 0.18, 0.9 + i * 0.18))
    fillRR(cx + b.x * s, cy + (i - 1) * s * 0.42 - s * 0.15, b.w * s * p, s * 0.3, s * 0.15, b.c)
  })
}

// ---------- background ----------
// A still background for the GIF: drifting pixels defeat GIF compression.
const STILL_BG = process.env.STILL_BG === '1'

function background(t) {
  if (STILL_BG) t = 0
  g.fillStyle = C.bg
  g.fillRect(0, 0, W, H)
  // drifting dot grid
  const off = (t * 6) % 32
  g.fillStyle = 'rgba(240,238,230,0.045)'
  for (let x = -32; x < W + 32; x += 32) for (let y = -32; y < H + 32; y += 32) g.fillRect(x + off, y + off * 0.5, 2, 2)
  glow(W * 0.85 + Math.sin(t * 0.3) * 40, H * 0.1, 520, 'rgba(217,119,87,0.22)', 1)
  glow(W * 0.1, H * 0.95 + Math.cos(t * 0.25) * 30, 480, 'rgba(159,168,245,0.12)', 1)
}

function caption(step, title, t, a, b) {
  const p = window_(t, a, b, 0.6, 0.4)
  withAlpha(p, () => {
    const dx = (1 - easeOut(prog(t, a, a + 0.6))) * -30
    pill(`STEP ${step}`, 64 + dx, 46, C.claude, { size: 13, h: 26 })
    text(title, 64 + dx, 112, { size: 38, font: 'SansBold' })
  })
}

// ---------- data ----------
const TASKS = [
  { id: 'T1', title: 'Export endpoint', model: 'Sonnet 5.5', color: C.sonnet, sprint: 1, start: 0, len: 20 },
  { id: 'T2', title: 'Endpoint tests', model: 'Haiku 5.5', color: C.haiku, sprint: 1, start: 20, len: 10 },
  { id: 'T3', title: 'Find report code', model: 'Opus 5.5', color: C.claude, sprint: 1, start: 0, len: 6 },
  { id: 'T4', title: 'Export button', model: 'Sonnet 5.5', color: C.sonnet, sprint: 2, start: 30, len: 15 },
  { id: 'T5', title: 'Docs', model: 'Haiku 5.5', color: C.haiku, sprint: 2, start: 30, len: 6 },
]

// ---------- scenes ----------
function sceneTitle(t) {
  const a = window_(t, 0, 4.2, 0.3, 0.6)
  if (a <= 0) return
  withAlpha(a, () => {
    glow(W / 2, H / 2 - 40, 360, 'rgba(217,119,87,0.35)', easeOut(prog(t, 0, 1.5)))
    mark(W / 2, H / 2 - 110, 70, t)
    const p = easeOut(prog(t, 0.6, 1.6))
    text('Claude mode for PM', W / 2, H / 2 + 20 + (1 - p) * 20, { size: 72, font: 'SansBold', align: 'center', alpha: p })
    const p2 = easeOut(prog(t, 1.2, 2.2))
    text('Plan sprints. Delegate to agents. Ship in parallel.', W / 2, H / 2 + 78, { size: 26, color: C.dim, align: 'center', alpha: p2 })
    const p3 = easeOut(prog(t, 1.8, 2.8))
    withAlpha(p3, () => {
      const labels = ['Gantt timeline', 'Board', 'Claude subagents', 'Codex · Gemini · OpenCode · Grok']
      const widths = labels.map(l => measure(l, 16, 'SansBold') + 28)
      let x = W / 2 - (widths.reduce((s, w) => s + w, 0) + 12 * (labels.length - 1)) / 2
      labels.forEach((l, i) => {
        strokeRR(x, H / 2 + 112, widths[i], 34, 17, C.line)
        text(l, x + widths[i] / 2, H / 2 + 130, { size: 16, color: C.text, font: 'SansBold', align: 'center', base: 'middle' })
        x += widths[i] + 12
      })
    })
  })
}

function scenePrompt(t) {
  const a = window_(t, 4, 9, 0.5, 0.5)
  if (a <= 0) return
  caption(1, 'Describe the goal. Opus takes it from there.', t, 4, 9)
  withAlpha(a, () => {
    const bx = 160
    const by = 300
    const bw = W - 320
    // orchestrator node
    const think = prog(t, 6.6, 9)
    if (think > 0) {
      withAlpha(easeOut(prog(t, 6.6, 7.1)), () => {
        fillRR(W / 2 - 170, 200, 340, 64, 32, C.panel)
        strokeRR(W / 2 - 170, 200, 340, 64, 32, C.claude, 2)
        mark(W / 2 - 112, 238, 22, 10)
        text('Orchestrator · Opus 5.5', W / 2 - 80, 226, { size: 18, font: 'SansBold' })
        const dots = '•••'.slice(0, 1 + (Math.floor(t * 4) % 3))
        text(`Planning the sprint ${dots}`, W / 2 - 80, 250, { size: 15, color: C.dim })
        glow(W / 2, 232, 220, 'rgba(217,119,87,0.25)', 0.6 + 0.4 * Math.sin(t * 5))
      })
    }
    // prompt box
    fillRR(bx, by + 120, bw, 120, 18, C.panel)
    strokeRR(bx, by + 120, bw, 120, 18, C.line, 1.5)
    const full = 'Add CSV export to the reports page'
    const typed = full.slice(0, Math.floor(prog(t, 4.8, 6.3) * full.length))
    text(typed, bx + 30, by + 175, { size: 26 })
    if (typed.length < full.length || Math.floor(t * 2) % 2 === 0) {
      const cx = bx + 32 + measure(typed, 26)
      g.fillStyle = C.claude
      g.fillRect(cx, by + 152, 2.5, 30)
    }
    text('PM mode on · /pm', bx + 30, by + 220, { size: 15, color: C.success })
    // send button
    const press = prog(t, 6.35, 6.55) * (1 - prog(t, 6.55, 6.8))
    const sx = bx + bw - 76
    const sy = by + 180
    fillRR(sx - press * 3, sy - press * 3, 52 + press * 6, 44 + press * 6, 12, C.claude)
    g.strokeStyle = '#141413'
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(sx + 26, sy + 32)
    g.lineTo(sx + 26, sy + 12)
    g.moveTo(sx + 17, sy + 20)
    g.lineTo(sx + 26, sy + 11)
    g.lineTo(sx + 35, sy + 20)
    g.stroke()
    // message flying up
    const fly = easeInOut(prog(t, 6.5, 7.1))
    if (fly > 0 && fly < 1) withAlpha(1 - fly, () => fillRR(W / 2 - 60, lerp(by + 150, 240, fly), 120, 10, 5, C.claude))
  })
}

function sceneTasks(t) {
  const a = window_(t, 8.8, 13.4, 0.4, 0.5)
  if (a <= 0) return
  caption(2, 'Short, clear tasks, each with an agent and model', t, 8.8, 13.4)
  withAlpha(a, () => {
    TASKS.forEach((task, i) => {
      const p = back(prog(t, 9.2 + i * 0.22, 9.8 + i * 0.22))
      const y = 170 + i * 92
      const x = 160 + (1 - p) * 120
      withAlpha(clamp(p * 1.4), () => {
        fillRR(x, y, W - 320, 74, 14, C.panel)
        fillRR(x, y, 6, 74, 3, task.color)
        text(task.id, x + 30, y + 44, { size: 20, color: C.faint, font: 'Mono' })
        text(task.title, x + 90, y + 45, { size: 24, font: 'SansBold' })
        const cw = measure(task.model, 16) + 18
        chip(task.model, x + W - 320 - 230 - cw / 2 + 40, y + 37, task.color, { size: 16 })
        text(`${task.len}m`, x + W - 320 - 30, y + 45, { size: 18, color: C.dim, align: 'right', font: 'Mono' })
        text(`Sprint ${task.sprint}`, x + 420, y + 45, { size: 16, color: C.dim })
      })
    })
  })
}

// Gantt geometry shared by the next scenes
const G = { x: 120, y: 170, w: W - 240, left: 300, rowH: 58, scale: 50 }
/** Top of a task's row; each sprint header gets its own line above its first task. */
function rowY(i) {
  return G.y + 114 + i * 52 + (i >= 3 ? 64 : 0)
}
function barX(m) {
  return G.x + G.left + (m / G.scale) * (G.w - G.left - 20)
}

function gantt(t, { grow = 1, colors = TASKS.map(x => x.color), labels = TASKS.map(x => x.model), progress = [0, 0, 0, 0, 0], status = ['todo', 'todo', 'todo', 'todo', 'todo'], highlight = -1 } = {}) {
  fillRR(G.x, G.y, G.w, 470, 18, C.panel)
  strokeRR(G.x, G.y, G.w, 470, 18, C.line)
  // header
  text('Timeline', G.x + 28, G.y + 40, { size: 22, font: 'SansBold', color: C.sonnet })
  fillRR(G.x + 20, G.y + 56, G.w - 40, 30, 8, '#3a3936')
  text('TASK', G.x + 34, G.y + 76, { size: 13, font: 'SansBold', color: C.dim })
  for (let m = 0; m <= 40; m += 10) {
    const x = barX(m)
    text(`${m}m`, x + 6, G.y + 76, { size: 13, font: 'Mono', color: C.dim })
    g.fillStyle = 'rgba(240,238,230,0.06)'
    g.fillRect(x, G.y + 92, 1, 360)
  }
  const sprintHeader = (label, y, done, total) => {
    text(`▾ ${label}`, G.x + 30, y, { size: 17, font: 'SansBold', color: C.claude })
    text(`${done}/${total} done`, G.x + 30 + measure(`▾ ${label}`, 17, 'SansBold') + 14, y, { size: 15, color: done === total ? C.success : C.dim })
  }
  const done = status.map(s => s === 'done')
  sprintHeader('Sprint 1 · Backend', rowY(0) - 6, done.slice(0, 3).filter(Boolean).length, 3)
  sprintHeader('Sprint 2 · UI & docs', rowY(3) - 6, done.slice(3).filter(Boolean).length, 2)
  TASKS.forEach((task, i) => {
    const y = rowY(i) + 36
    const p = easeOut(prog(grow, i * 0.12, 0.5 + i * 0.12))
    const isHi = highlight === i
    text(task.id, G.x + 48, y + 6, { size: 16, font: 'Mono', color: C.faint })
    text(task.title, G.x + 92, y + 6, { size: 18, color: isHi ? C.text : C.text, font: isHi ? 'SansBold' : 'Sans' })
    const x0 = barX(task.start)
    const w = (barX(task.start + task.len) - x0) * p
    const st = status[i]
    const col = st === 'done' ? C.success : st === 'failed' ? C.error : colors[i]
    if (w > 2) {
      withAlpha(st === 'todo' && progress[i] === 0 ? 1 : 0.35, () => fillRR(x0, y - 16, w, 32, 8, col))
      if (progress[i] > 0 || st !== 'todo') {
        const pw = st === 'done' ? w : w * progress[i]
        fillRR(x0, y - 16, pw, 32, 8, col)
        // moving stripes while running
        if (st === 'running') {
          g.save()
          rr(x0, y - 16, pw, 32, 8)
          g.clip()
          g.strokeStyle = 'rgba(255,255,255,0.18)'
          g.lineWidth = 8
          for (let k = -40; k < pw + 40; k += 22) {
            const sx = x0 + k + ((t * 40) % 22)
            g.beginPath()
            g.moveTo(sx, y + 16)
            g.lineTo(sx + 18, y - 16)
            g.stroke()
          }
          g.restore()
        }
      }
      if (isHi) strokeRR(x0 - 3, y - 19, w + 6, 38, 10, '#ffffff', 2)
      const icon = st === 'done' ? '✓' : st === 'running' ? '◐' : st === 'failed' ? '✕' : '○'
      const label = w > 150 ? `${icon} ${task.id} · ${labels[i]}` : `${icon} ${task.id}`
      withAlpha(clamp(p * 2 - 0.8), () => text(label, x0 + 10, y + 1, { size: 15, font: 'SansBold', color: '#141413', base: 'middle' }))
    }
  })
}

function sceneGantt(t) {
  const a = window_(t, 13.2, 19.4, 0.5, 0.4)
  if (a <= 0) return
  caption(3, 'Sprints on a Gantt timeline', t, 13.2, 19.4)
  withAlpha(a, () => {
    gantt(t, { grow: prog(t, 13.6, 15.4) })
    // parallel bracket
    const pb = easeOut(prog(t, 15.8, 16.5)) * (1 - prog(t, 18.6, 19))
    if (pb > 0)
      withAlpha(pb, () => {
        const x = barX(0) - 26
        g.strokeStyle = C.warning
        g.lineWidth = 3
        g.beginPath()
        g.moveTo(x + 10, rowY(0) + 20)
        g.lineTo(x, rowY(0) + 20)
        g.lineTo(x, rowY(2) + 52)
        g.lineTo(x + 10, rowY(2) + 52)
        g.stroke()
        pill('T1 + T3 run in parallel', barX(6) + 14, rowY(2) + 23, C.warning, { size: 13 })
      })
    // dependency arrow T1 -> T2
    const pd = easeOut(prog(t, 16.6, 17.4)) * (1 - prog(t, 18.6, 19))
    if (pd > 0)
      withAlpha(pd, () => {
        const sx = barX(20)
        const sy = rowY(0) + 36
        const ex = barX(20) + 8
        const ey = rowY(1) + 36
        g.strokeStyle = C.text
        g.lineWidth = 2
        g.setLineDash([5, 5])
        g.beginPath()
        g.moveTo(sx, sy + 16)
        g.bezierCurveTo(sx + 30, sy + 30, ex - 30, ey - 30, ex, ey - 16)
        g.stroke()
        g.setLineDash([])
        pill('T2 waits for T1', barX(20) + 40, rowY(0) + 8, C.text, { size: 13 })
      })
  })
}

function sceneAssign(t) {
  const a = window_(t, 19.2, 23.6, 0.4, 0.4)
  if (a <= 0) return
  caption(4, 'Assign any agent and model, per task or per sprint', t, 19.2, 23.6)
  const picked = t > 21.2
  const sprintAll = t > 22.6
  const colors = TASKS.map((x, i) => (i === 2 && picked ? C.codex : i >= 3 && sprintAll ? C.haiku : x.color))
  const labels = TASKS.map((x, i) => (i === 2 && picked ? 'Codex · gpt-6.1' : i >= 3 && sprintAll ? 'Haiku 5.5' : x.model))
  withAlpha(a, () => {
    gantt(t, { colors, labels, highlight: t > 19.9 && t < 22 ? 2 : -1 })
    // cursor path to T3 bar, then dropdown
    const target = { x: barX(3), y: rowY(2) + 36 }
    const c1 = easeInOut(prog(t, 19.4, 19.9))
    let cx = lerp(W - 200, target.x, c1)
    let cy = lerp(H - 80, target.y, c1)
    const ddOpen = prog(t, 20.0, 20.25) * (1 - prog(t, 21.2, 21.4))
    const ddx = target.x + 20
    const ddy = target.y + 24
    const items = [
      ['Claude · Opus 5.5', C.claude],
      ['Claude · Sonnet 5.5', C.sonnet],
      ['Claude · Haiku 5.5', C.haiku],
      ['Codex · gpt-6.1-sol', C.codex],
      ['Gemini · default', C.gemini],
      ['OpenCode · deepseek-v4', C.opencode],
      ['Grok · grok-4.7', C.grok],
    ]
    if (ddOpen > 0)
      withAlpha(ddOpen, () => {
        const h = items.length * 34 + 16
        g.save()
        g.shadowColor = 'rgba(0,0,0,0.5)'
        g.shadowBlur = 30
        fillRR(ddx, ddy, 280, h * easeOut(ddOpen), 12, '#2b2a27')
        g.restore()
        strokeRR(ddx, ddy, 280, h * easeOut(ddOpen), 12, C.line)
        items.forEach(([label, col], i) => {
          const iy = ddy + 12 + i * 34
          if (iy + 30 > ddy + h * easeOut(ddOpen)) return
          const hover = i === 3 && t > 20.7
          if (hover) fillRR(ddx + 6, iy, 268, 30, 8, 'rgba(79,138,214,0.25)')
          chip(label, ddx + 16, iy + 15, col, { size: 15 })
        })
      })
    if (t > 20.0 && t < 21.3) {
      const c2 = easeInOut(prog(t, 20.3, 20.75))
      cx = lerp(target.x, ddx + 140, c2)
      cy = lerp(target.y, ddy + 12 + 3 * 34 + 15, c2)
    }
    if (t >= 21.3) {
      // then to the sprint 2 "Assign all"
      const c3 = easeInOut(prog(t, 21.5, 22.2))
      cx = lerp(ddx + 140, G.x + G.w - 110, c3)
      cy = lerp(ddy + 117, rowY(3) - 32, c3)
    }
    withAlpha(easeOut(prog(t, 21.6, 21.9)), () => {
      text('Assign all', G.x + G.w - 140, rowY(3) - 26, { size: 15, font: 'SansBold', color: C.sonnet })
      if (t > 22.3 && t < 23.4) pill('Sprint 2 → Haiku 5.5', G.x + G.w - 150, rowY(3) - 12, C.haiku, { size: 13, align: 'right' })
    })
    const press = (t > 20.85 && t < 21.1) || (t > 22.3 && t < 22.55) || (t > 19.9 && t < 20.1) ? 1 : 0
    cursor(cx, cy, press)
  })
}

function sceneRun(t) {
  const a = window_(t, 23.4, 29.6, 0.4, 0.5)
  if (a <= 0) return
  caption(5, 'Start sprint: agents work in parallel', t, 23.4, 29.6)
  const colors = TASKS.map((x, i) => (i === 2 ? C.codex : i >= 3 ? C.haiku : x.color))
  const labels = TASKS.map((x, i) => (i === 2 ? 'Codex · gpt-6.1' : i >= 3 ? 'Haiku 5.5' : x.model))
  // run schedule in video seconds
  const runs = [
    [24.3, 26.6],
    [26.7, 27.6],
    [24.3, 25.2],
    [27.7, 28.9],
    [27.7, 28.3],
  ]
  const progress = runs.map(([s, e]) => prog(t, s, e))
  const status = runs.map(([s, e]) => (t >= e ? 'done' : t >= s ? 'running' : 'todo'))
  withAlpha(a, () => {
    gantt(t, { colors, labels, progress, status })
    // start sprint button
    const bx = G.x + G.w - 190
    const by = G.y + 18
    const press = prog(t, 23.9, 24.05) * (1 - prog(t, 24.05, 24.3))
    const running = t > 24.2 && t < 28.9
    fillRR(bx - press * 2, by - press * 2, 168 + press * 4, 40 + press * 4, 10, running ? '#3a3936' : C.claude)
    text(running ? '■  Stop' : t >= 28.9 ? '✓  Sprint done' : '▶  Start sprint', bx + 84, by + 21, { size: 17, font: 'SansBold', color: running ? C.text : '#141413', align: 'center', base: 'middle' })
    const done = status.filter(s => s === 'done').length
    withAlpha(easeOut(prog(t, 24.3, 24.8)), () => {
      pill(`${done}/5 done`, G.x + 160, G.y + 22, done === 5 ? C.success : C.claude, { size: 14, h: 30 })
    })
    if (t < 24.4) cursor(lerp(W - 140, bx + 90, easeInOut(prog(t, 23.5, 23.95))), lerp(H - 60, by + 26, easeInOut(prog(t, 23.5, 23.95))), press > 0 ? 1 : 0)
  })
}

function sceneReport(t) {
  const a = window_(t, 29.4, 32.8, 0.4, 0.5)
  if (a <= 0) return
  caption(6, 'Reports flow back to the orchestrator', t, 29.4, 32.8)
  withAlpha(a, () => {
    const cx = W / 2
    const cy = 420
    // orchestrator hub
    glow(cx, cy, 260, 'rgba(217,119,87,0.35)', 0.7 + 0.3 * Math.sin(t * 4))
    fillRR(cx - 160, cy - 46, 320, 92, 46, C.panel)
    strokeRR(cx - 160, cy - 46, 320, 92, 46, C.claude, 2.5)
    mark(cx - 100, cy, 26, 10)
    text('Opus 5.5', cx - 60, cy - 6, { size: 24, font: 'SansBold' })
    const phase = t < 31.3 ? 'Reviewing reports' : 'Fix · re-plan · next sprint'
    text(phase, cx - 60, cy + 22, { size: 16, color: C.dim })
    TASKS.forEach((task, i) => {
      const ang = Math.PI * (1.1 + i * 0.2)
      const sx = cx + Math.cos(ang) * 460
      const sy = cy + Math.sin(ang) * 230 + 40
      const p = easeInOut(prog(t, 30.4 + i * 0.3, 31.6 + i * 0.3))
      const appear = easeOut(prog(t, 29.7 + i * 0.12, 30.2 + i * 0.12))
      const x = lerp(sx, cx, p)
      const y = lerp(sy, cy, p)
      withAlpha(appear * (1 - prog(p, 0.6, 0.85)), () => {
        fillRR(x - 70, y - 22, 140, 44, 12, C.panel)
        strokeRR(x - 70, y - 22, 140, 44, 12, C.success, 1.5)
        text(`✓ ${task.id} report`, x, y + 1, { size: 15, font: 'SansBold', align: 'center', base: 'middle' })
      })
    })
  })
}

function sceneOutro(t) {
  const a = window_(t, 32.6, DURATION + 1, 0.6, 0.1)
  if (a <= 0) return
  withAlpha(a, () => {
    glow(W / 2, H / 2 - 60, 380, 'rgba(217,119,87,0.32)', 1)
    mark(W / 2, H / 2 - 160, 56, t - 32.6)
    text('Claude mode for PM', W / 2, H / 2 - 40, { size: 64, font: 'SansBold', align: 'center' })
    text('Your next sprint, planned and shipped by a team of agents.', W / 2, H / 2 + 10, { size: 24, color: C.dim, align: 'center' })
    const p = easeOut(prog(t, 33.2, 33.9))
    withAlpha(p, () => {
      const cmd = '/plugin install pm-mode --marketplace GrzeskoByte/claude-for-PM'
      const w = measure(cmd, 22, 'Mono') + 60
      fillRR(W / 2 - w / 2, H / 2 + 60, w, 60, 14, C.panel)
      strokeRR(W / 2 - w / 2, H / 2 + 60, w, 60, 14, C.claude, 1.5)
      text(cmd, W / 2, H / 2 + 91, { size: 22, font: 'Mono', align: 'center', base: 'middle' })
      text('github.com/GrzeskoByte/claude-for-PM', W / 2, H / 2 + 162, { size: 20, color: C.sonnet, align: 'center' })
    })
  })
}

function frame(t) {
  background(t)
  sceneTitle(t)
  scenePrompt(t)
  sceneTasks(t)
  sceneGantt(t)
  sceneAssign(t)
  sceneRun(t)
  sceneReport(t)
  sceneOutro(t)
  // progress line along the bottom
  g.fillStyle = 'rgba(217,119,87,0.85)'
  g.fillRect(0, H - 4, (t / DURATION) * W, 4)
}

const args = process.argv.slice(2)
if (args[0] === '--still') {
  fs.mkdirSync('stills', { recursive: true })
  for (const s of args.slice(1)) {
    frame(Number(s))
    fs.writeFileSync(`stills/t${s}.png`, canvas.toBuffer('image/png'))
  }
} else {
  const total = DURATION * FPS
  let i = 0
  const writeNext = () => {
    while (i < total) {
      frame(i / FPS)
      const data = g.getImageData(0, 0, W, H).data
      i++
      if (!process.stdout.write(Buffer.from(data.buffer))) return process.stdout.once('drain', writeNext)
    }
    process.stdout.end()
  }
  writeNext()
}
