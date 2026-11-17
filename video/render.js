// Intro video from a real Claude Code session: terminal frames recorded with
// `tmux capture-pane -e` (ANSI colors) are redrawn cell by cell, then cut,
// sped up, zoomed and captioned.
// The cut (SEGMENTS) picks seconds from one or more recordings made by record.sh.
// node render.js <dir1>,<dir2>              -> raw RGBA frames on stdout
// node render.js <dir1>,<dir2> --still 3 12 -> PNG stills in ./stills
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas')
const fs = require('fs')
const path = require('path')

GlobalFonts.registerFromPath('/usr/share/fonts/noto/NotoSans-Regular.ttf', 'Sans')
GlobalFonts.registerFromPath('/usr/share/fonts/noto/NotoSans-Bold.ttf', 'SansBold')
GlobalFonts.registerFromPath('/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Regular.ttf', 'Mono')
GlobalFonts.registerFromPath('/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Bold.ttf', 'MonoBold')
GlobalFonts.registerFromPath('/usr/share/fonts/noto/NotoSansSymbols2-Regular.ttf', 'Sym')
GlobalFonts.registerFromPath('/usr/share/fonts/noto/NotoSansSymbols-Regular.ttf', 'Sym1')

const W = 1280
const H = 720
const FPS = 30
const COLS = 160
const ROWS = 45
const CW = 8
const CH = 16

const C = {
  bg: '#141413',
  term: '#1a1a19',
  fg: '#e8e6e3',
  panel: '#22211f',
  line: '#3a3936',
  text: '#f0eee6',
  dim: '#a3a19a',
  claude: '#D97757',
  sonnet: '#9FA8F5',
  haiku: '#4FA99D',
}

// ---------- recorded frames ----------
const SOURCES = process.argv[2].split(',').map(dir => {
  const files = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.ans'))
    .sort()
  const t0 = Number(files[0].slice(0, -4))
  return files.map(f => ({ t: (Number(f.slice(0, -4)) - t0) / 1000, file: path.join(dir, f) }))
})
const frameAt = (cap, srcT) => {
  const frames = SOURCES[cap]
  let lo = 0
  for (let i = 0; i < frames.length; i++) if (frames[i].t <= srcT) lo = i
  return frames[lo].file
}

function xterm(n) {
  const base = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5', '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff']
  if (n < 16) return base[n]
  if (n < 232) {
    n -= 16
    const v = [0, 95, 135, 175, 215, 255]
    return `rgb(${v[Math.floor(n / 36)]},${v[Math.floor(n / 6) % 6]},${v[n % 6]})`
  }
  const g = 8 + (n - 232) * 10
  return `rgb(${g},${g},${g})`
}

/** Parses one capture into rows of cells { ch, fg, bg, bold, dim }. */
function parse(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').slice(0, ROWS)
  return lines.map(line => {
    const cells = []
    let st = { fg: null, bg: null, bold: false, dim: false, inv: false }
    let i = 0
    while (i < line.length) {
      if (line[i] === '\x1b' && line[i + 1] === '[') {
        const end = line.slice(i + 2).search(/[A-Za-z]/)
        const body = line.slice(i + 2, i + 2 + end)
        const cmd = line[i + 2 + end]
        i += 3 + end
        if (cmd !== 'm') continue
        const ps = body === '' ? [0] : body.split(';').map(Number)
        for (let k = 0; k < ps.length; k++) {
          const p = ps[k]
          if (p === 0) st = { fg: null, bg: null, bold: false, dim: false, inv: false }
          else if (p === 1) st.bold = true
          else if (p === 2) st.dim = true
          else if (p === 22) st.bold = st.dim = false
          else if (p === 7) st.inv = true
          else if (p === 27) st.inv = false
          else if (p === 39) st.fg = null
          else if (p === 49) st.bg = null
          else if (p >= 30 && p <= 37) st.fg = xterm(p - 30)
          else if (p >= 90 && p <= 97) st.fg = xterm(p - 90 + 8)
          else if (p >= 40 && p <= 47) st.bg = xterm(p - 40)
          else if ((p === 38 || p === 48) && ps[k + 1] === 5) {
            st[p === 38 ? 'fg' : 'bg'] = xterm(ps[k + 2])
            k += 2
          } else if ((p === 38 || p === 48) && ps[k + 1] === 2) {
            st[p === 38 ? 'fg' : 'bg'] = `rgb(${ps[k + 2]},${ps[k + 3]},${ps[k + 4]})`
            k += 4
          }
        }
        continue
      }
      const cp = line.codePointAt(i)
      const ch = String.fromCodePoint(cp)
      i += ch.length
      let fg = st.fg ?? C.fg
      let bg = st.bg
      if (st.inv) [fg, bg] = [bg ?? C.term, fg]
      cells.push({ ch, fg, bg, bold: st.bold, dim: st.dim })
    }
    return cells
  })
}

const term = createCanvas(COLS * CW, ROWS * CH)
const tg = term.getContext('2d')
let drawnFile = ''
function drawTerminal(file) {
  if (file === drawnFile) return
  drawnFile = file
  const rows = parse(file)
  tg.fillStyle = C.term
  tg.fillRect(0, 0, term.width, term.height)
  tg.textBaseline = 'middle'
  rows.forEach((cells, r) => {
    cells.forEach((c, x) => {
      if (x >= COLS) return
      if (c.bg) {
        tg.fillStyle = c.bg
        tg.fillRect(x * CW, r * CH, CW + 0.5, CH + 0.5)
      }
      if (c.ch === ' ') return
      tg.globalAlpha = c.dim ? 0.55 : 1
      tg.fillStyle = c.fg
      tg.font = `13.3px ${c.bold ? 'MonoBold' : 'Mono'}, Sym, Sym1`
      tg.fillText(c.ch, x * CW, r * CH + CH / 2 + 1)
      tg.globalAlpha = 1
    })
  })
}

// ---------- output canvas helpers ----------
const canvas = createCanvas(W, H)
const g = canvas.getContext('2d')
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const lerp = (a, b, t) => a + (b - a) * t
const ease = t => {
  t = clamp(t)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
const easeOut = t => 1 - Math.pow(1 - clamp(t), 3)
const prog = (t, a, b) => clamp((t - a) / (b - a))

function rr(x, y, w, h, r) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}
function text(s, x, y, { size = 20, color = C.text, font = 'Sans', align = 'left', base = 'alphabetic' } = {}) {
  g.font = `${size}px ${font}, Sym, Sym1`
  g.fillStyle = color
  g.textAlign = align
  g.textBaseline = base
  g.fillText(s, x, y)
}
function measure(s, size, font = 'Sans') {
  g.font = `${size}px ${font}, Sym, Sym1`
  return g.measureText(s).width
}
function glow(x, y, r, color) {
  const grd = g.createRadialGradient(x, y, 0, x, y, r)
  grd.addColorStop(0, color)
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(x - r, y - r, r * 2, r * 2)
}
function wrap(s, size, font, maxW) {
  const words = s.split(' ')
  const lines = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (measure(next, size, font) > maxW && cur) {
      lines.push(cur)
      cur = w
    } else cur = next
  }
  if (cur) lines.push(cur)
  return lines
}

// Source rectangles of the recorded terminal (in its pixels)
const VIEW = {
  full: { x: 0, y: 0, w: 1280, h: 720 },
  panel: { x: 88 * CW, y: 0, w: 72 * CW, h: 45 * CH },
  panelTop: { x: 88 * CW, y: 0, w: 72 * CW, h: 31 * CH },
  chat: { x: 0, y: 14 * CH, w: 88 * CW, h: 27 * CH },
  upper: { x: 0, y: 0, w: 1280, h: 27 * CH },
  timeline: { x: 88 * CW, y: 11 * CH, w: 72 * CW, h: 17 * CH },
  tasks: { x: 88 * CW, y: 28 * CH, w: 72 * CW, h: 12 * CH },
  report: { x: 0, y: 20.5 * CH, w: 88 * CW, h: 11.5 * CH },
  report2: { x: 0, y: 22.6 * CH, w: 88 * CW, h: 11.4 * CH },
  prompt: { x: 0, y: 33 * CH, w: 88 * CW, h: 12 * CH },
  chatTop: { x: 0, y: 0, w: 88 * CW, h: 28 * CH },
  run: { x: 88 * CW, y: 19.6 * CH, w: 72 * CW, h: 17.8 * CH },
  agentsPanel: { x: 88 * CW, y: 13 * CH, w: 72 * CW, h: 21 * CH },
  lanes: { x: 88 * CW, y: 13 * CH, w: 72 * CW, h: 10 * CH },
  taskList: { x: 88 * CW, y: 29 * CH, w: 72 * CW, h: 12 * CH },
}

/**
 * The cut. Each segment plays recorded seconds [src0, src1] over `dur` output
 * seconds, framed by a view; `side` puts the footage on the right with the
 * caption on the left.
 */
const SEGMENTS = [
  { dur: 1.4, cap: 1, src: [58, 59], view: 'panelTop', side: true, hook: true, step: '', caption: 'Claude orchestrates. Your agents build.' },
  { dur: 1.8, cap: 1, src: [8.2, 12.8], view: 'prompt', step: '1', caption: 'Describe the goal' },
  { dur: 2.2, cap: 1, src: [13.4, 23.4], view: 'chatTop', step: '2', caption: 'Opus plans the sprints and picks the agents' },
  { dur: 2.2, cap: 1, src: [23.4, 24.4], view: 'taskList', side: true, step: '3', caption: 'Each task gets its own agent and model', focus: { c: 92, r: 33.5, w: 30, h: 6, label: 'Claude · Codex · Gemini' } },
  { dur: 1.8, cap: 1, src: [63.5, 73], view: 'agentsPanel', side: true, step: '4', caption: 'Codex, Gemini, OpenCode, Grok on board', focus: { c: 92, r: 16.5, w: 30, h: 13, label: 'detected and signed in' } },
  { dur: 1.6, cap: 1, src: [55, 62], view: 'lanes', side: true, step: '5', caption: 'One lane per agent', focus: { c: 92, r: 17.5, w: 66, h: 4, label: 'Sonnet · Codex · Gemini' } },
  { dur: 3.0, cap: 1, src: [76, 146], view: 'run', side: true, step: '6', caption: 'Watch every sprint, live', focus: { c: 92, r: 20.6, w: 66, h: 3.4, label: 'live, per agent' } },
  { dur: 1.8, cap: 1, src: [176, 189.6], view: 'taskList', side: true, step: '7', caption: 'Failed? Hand it to another agent', focus: { c: 92, r: 30, w: 30, h: 8, label: 'Gemini → Codex' } },
  { dur: 2.4, cap: 1, src: [226, 240], view: 'report2', step: '8', caption: 'One report from the orchestrator', focus: { c: 1, r: 22.8, w: 86, h: 10.8, label: 'Sonnet · Codex · Codex' } },
  { dur: 1.5, outro: true },
]
let acc = 0
for (const s of SEGMENTS) {
  s.start = acc
  acc += s.dur
}
const DURATION = acc

function footage(seg, local) {
  const p = local / seg.dur
  const srcT = lerp(seg.src[0], seg.src[1], p)
  drawTerminal(frameAt(seg.cap ?? 0, srcT))
  const v = VIEW[seg.view]
  // punch in on each cut, then keep drifting in so no beat sits still
  // GIF=1 drops the slow drift: pixels that change every frame defeat GIF compression
  const push = 1 + 0.1 * (1 - easeOut(prog(local, 0, 0.35))) + (process.env.GIF === '1' ? 0 : 0.04 * p)
  let dw
  let dh
  let dx
  let dy
  if (seg.side) {
    const maxH = H - 64
    const maxW = 700
    const k = Math.min(maxW / v.w, maxH / v.h) * push
    dw = v.w * k
    dh = v.h * k
    dx = W - dw - 40
    dy = (H - dh) / 2
  } else {
    const k = Math.min(W / v.w, (H - 110) / v.h) * push
    dw = v.w * k
    dh = v.h * k
    dx = (W - dw) / 2
    // centred in the room under the caption
    dy = 84 + (H - 84 - dh) / 2
  }
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.55)'
  g.shadowBlur = 40
  rr(dx, dy, dw, dh, 14)
  g.fillStyle = C.term
  g.fill()
  g.restore()
  g.save()
  rr(dx, dy, dw, dh, 14)
  g.clip()
  g.imageSmoothingQuality = 'high'
  g.drawImage(term, v.x, v.y, v.w, v.h, dx, dy, dw, dh)
  g.restore()
  rr(dx, dy, dw, dh, 14)
  g.strokeStyle = 'rgba(240,238,230,0.12)'
  g.lineWidth = 1.5
  g.stroke()
  if (seg.focus) {
    const f = seg.focus
    const kx = dw / v.w
    const ky = dh / v.h
    const fa = easeOut(prog(local, 0.3, 0.6))
    const fx = dx + (f.c * CW - v.x) * kx
    const fy = dy + (f.r * CH - v.y) * ky
    const fw = f.w * CW * kx
    const fh = f.h * CH * ky
    const grow = 8 * (1 - fa)
    g.save()
    g.globalAlpha = fa
    rr(fx - grow, fy - grow, fw + grow * 2, fh + grow * 2, 10)
    g.strokeStyle = C.claude
    g.lineWidth = 3 + Math.sin(local * 8) * 0.8
    g.stroke()
    const lw = measure(f.label, 15, 'SansBold') + 22
    rr(fx + fw - lw, fy - 15, lw, 28, 14)
    g.fillStyle = C.claude
    g.fill()
    text(f.label, fx + fw - lw / 2, fy - 1, { size: 15, font: 'SansBold', color: '#141413', align: 'center', base: 'middle' })
    g.restore()
  }
  if (p < 1 && seg.src[1] - seg.src[0] > seg.dur * 1.5) {
    const speed = Math.round((seg.src[1] - seg.src[0]) / seg.dur)
    const label = `▶▶ ${speed}× speed · real session`
    const w = measure(label, 14, 'SansBold') + 22
    rr(dx + dw - w - 14, dy + 14, w, 28, 14)
    g.fillStyle = 'rgba(20,20,19,0.85)'
    g.fill()
    text(label, dx + dw - w / 2 - 14, dy + 29, { size: 14, font: 'SansBold', color: C.dim, align: 'center', base: 'middle' })
  }
}

function captionLeft(seg, local) {
  const a = easeOut(prog(local, 0, 0.3))
  g.save()
  g.globalAlpha = a
  const x = 64 - (1 - a) * 60
  let y = seg.hook ? 250 : 230
  if (seg.step) {
    const label = `STEP ${seg.step}`
    const w = measure(label, 14, 'SansBold') + 24
    rr(x, y - 86, w, 28, 14)
    g.fillStyle = C.claude
    g.fill()
    text(label, x + w / 2, y - 71, { size: 14, font: 'SansBold', color: '#141413', align: 'center', base: 'middle' })
  } else {
    // product mark: three Gantt bars
    ;[
      [0, 54, C.claude],
      [16, 46, C.sonnet],
      [30, 38, C.haiku],
    ].forEach(([ox, w, col], i) => {
      rr(x + ox, y - 92 + i * 16, w * easeOut(prog(local, 0.2 + i * 0.15, 0.8 + i * 0.15)), 11, 5.5)
      g.fillStyle = col
      g.fill()
    })
  }
  const size = seg.hook ? 50 : 40
  const lines = wrap(seg.caption, size, 'SansBold', 470)
  lines.forEach((l, i) => text(l, x, y + i * (size * 1.18), { size, font: 'SansBold' }))
  if (seg.sub) {
    const subs = wrap(seg.sub, 20, 'Sans', 450)
    subs.forEach((l, i) => text(l, x, y + lines.length * size * 1.18 + 18 + i * 28, { size: 20, color: C.dim }))
  }
  g.restore()
}

function captionTop(seg, local) {
  const a = easeOut(prog(local, 0, 0.3))
  g.save()
  g.globalAlpha = a
  g.translate(-(1 - a) * 60, 0)
  const label = `STEP ${seg.step}`
  const w = measure(label, 14, 'SansBold') + 24
  rr(48, 30, w, 28, 14)
  g.fillStyle = C.claude
  g.fill()
  text(label, 48 + w / 2, 45, { size: 14, font: 'SansBold', color: '#141413', align: 'center', base: 'middle' })
  text(seg.caption, 48 + w + 16, 54, { size: 32, font: 'SansBold' })
  g.restore()
}

function outro(local) {
  const a = easeOut(prog(local, 0, 0.3))
  g.save()
  g.globalAlpha = a
  glow(W / 2, H / 2 - 60, 380, 'rgba(217,119,87,0.32)')
  ;[
    [-40, 80, C.claude],
    [-12, 66, C.sonnet],
    [12, 54, C.haiku],
  ].forEach(([ox, w, col], i) => {
    rr(W / 2 + ox, H / 2 - 190 + i * 22, w * easeOut(prog(local, i * 0.08, 0.35 + i * 0.08)), 15, 7.5)
    g.fillStyle = col
    g.fill()
  })
  text('Claude mode for PM', W / 2, H / 2 - 40, { size: 64, font: 'SansBold', align: 'center' })
  text('Claude orchestrates. Codex, Gemini, OpenCode and Grok build.', W / 2, H / 2 + 10, { size: 24, color: C.dim, align: 'center' })
  const p = easeOut(prog(local, 0.25, 0.6))
  g.globalAlpha = a * p
  const cmd = '/plugin install pm-mode --marketplace GrzeskoByte/claude-for-PM'
  const w = measure(cmd, 22, 'Mono') + 60
  rr(W / 2 - w / 2, H / 2 + 60, w, 60, 14)
  g.fillStyle = C.panel
  g.fill()
  g.strokeStyle = C.claude
  g.lineWidth = 1.5
  g.stroke()
  text(cmd, W / 2, H / 2 + 91, { size: 22, font: 'Mono', align: 'center', base: 'middle' })
  text('github.com/GrzeskoByte/claude-for-PM', W / 2, H / 2 + 162, { size: 20, color: C.sonnet, align: 'center' })
  g.restore()
}

function frame(t) {
  g.fillStyle = C.bg
  g.fillRect(0, 0, W, H)
  glow(W * 0.85, H * 0.08, 520, 'rgba(217,119,87,0.18)')
  glow(W * 0.08, H * 0.95, 460, 'rgba(159,168,245,0.10)')
  const seg = SEGMENTS.find(s => t >= s.start && t < s.start + s.dur) ?? SEGMENTS[SEGMENTS.length - 1]
  const local = t - seg.start
  if (seg.outro) outro(local)
  else {
    footage(seg, local)
    if (seg.side) captionLeft(seg, local)
    else captionTop(seg, local)
  }
  // dip through the background between segments
  if (seg.start > 0 && local < 0.12) {
    g.fillStyle = `rgba(217,119,87,${0.22 * (1 - local / 0.12)})`
    g.fillRect(0, 0, W, H)
  }
  g.fillStyle = 'rgba(217,119,87,0.85)'
  g.fillRect(0, H - 4, (t / DURATION) * W, 4)
}

const args = process.argv.slice(3)
if (args[0] === '--still') {
  fs.mkdirSync('stills', { recursive: true })
  for (const s of args.slice(1)) {
    frame(Number(s))
    fs.writeFileSync(`stills/real-${s}.png`, canvas.toBuffer('image/png'))
  }
} else if (args[0] === '--duration') {
  console.log(DURATION)
} else {
  const total = Math.round(DURATION * FPS)
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
