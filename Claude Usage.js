// Claude Usage: Scriptable widget showing claude.ai plan usage (% used, same numbers as claude.ai/settings/usage).
// Reads:   GET https://claude.ai/api/organizations/{orgId}/usage (unofficial endpoint; may change without notice).
// Key:     your claude.ai "sessionKey" cookie, kept only in Scriptable's Keychain ("cu.sessionKey", "cu.orgId").
//          Never in this file. Cache (claude-usage-cache.json) holds labels, percentages and timestamps only.
// Rotate:  run this script in the Scriptable app and paste the new key. When the key dies the widget says
//          "Sign in"; tap it to land here.
// Update:  run "Update Claude Usage" (re-downloads this file from GitHub).
// Network: claude.ai only.

const BASE = "https://claude.ai/api/organizations"
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
const K_KEY = "cu.sessionKey"
const K_ORG = "cu.orgId"
const STALE_MS = 60 * 60e3
const fm = FileManager.local()
const CACHE = fm.joinPath(fm.documentsDirectory(), "claude-usage-cache.json")

// ---- network ----

// Returns {status, cf, json}. status 0 = no response. cf = Cloudflare challenge (not a dead key).
async function get(url, key) {
  const r = new Request(url)
  r.headers = { Cookie: `sessionKey=${key}`, "User-Agent": UA, Accept: "application/json" }
  r.timeoutInterval = 10
  let body
  try { body = await r.loadString() } catch (e) { return { status: 0 } }
  const h = (r.response && r.response.headers) || {}
  const cf = Object.keys(h).some(k => k.toLowerCase() === "cf-mitigated")
  let json = null
  try { json = JSON.parse(body) } catch (e) {}
  return { status: r.response ? r.response.statusCode : 0, cf, json }
}

const isDead = r => (r.status === 401 || r.status === 403) && !r.cf

// The plan org is the one with the "chat" capability (an API org may also exist).
async function findOrg(key) {
  const r = await get(BASE, key)
  if (isDead(r)) return { dead: true }
  const orgs = Array.isArray(r.json) ? r.json : []
  const org = orgs.find(o => (o.capabilities || []).includes("chat"))
  return { org: org ? org.uuid : null }
}

// ---- parse ----

function label(l) {
  const model = l.scope && l.scope.model && l.scope.model.display_name
  if (model) return model
  const k = l.kind || ""
  if (k === "weekly_all") return "Week"
  if (/^(session|five_hour)/.test(k)) return "Session"
  return k.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase())
}

// Rows come from `limits` in API order; fall back to five_hour / seven_day if `limits` is absent or empty.
function parseRows(u) {
  if (Array.isArray(u.limits) && u.limits.length) {
    return u.limits.map(l => ({ label: label(l), pct: Number(l.percent) || 0, resets: l.resets_at || null,
                                kind: l.kind || "", active: l.is_active !== false }))
  }
  return [["Session", "five_hour", u.five_hour], ["Week", "weekly_all", u.seven_day]]
    .filter(([, , b]) => b && b.utilization != null)
    .map(([lbl, kind, b]) => ({ label: lbl, pct: Number(b.utilization) || 0, resets: b.resets_at || null,
                                kind, active: true }))
}

// Extra usage row, only when the plan has it switched on. No reset.
function parseExtra(u) {
  const e = u.extra_usage
  return e && e.is_enabled ? { label: "Extra usage", pct: Number(e.utilization) || 0, resets: null, kind: "extra" } : null
}

// Per-product share of weekly usage (seven_day_breakdown.rows), API order, zero rows dropped.
function parseMix(u) {
  const rows = u.seven_day_breakdown && u.seven_day_breakdown.rows
  if (!Array.isArray(rows)) return []
  return rows.filter(r => Number(r.percent) > 0)
    .map(r => ({ name: r.display_name || label({ kind: r.key }), pct: Number(r.percent) }))
}

// ---- cache ----

function readCache() {
  try { return fm.fileExists(CACHE) ? JSON.parse(fm.readString(CACHE)) : null } catch (e) { return null }
}

// ---- load: {dead} | {rows, ts} ----

async function load() {
  if (!Keychain.contains(K_KEY)) return { dead: true }
  const key = Keychain.get(K_KEY)
  const cached = readCache() || { rows: [], ts: 0 }
  let org = Keychain.contains(K_ORG) ? Keychain.get(K_ORG) : null
  if (!org) {
    const f = await findOrg(key)
    if (f.dead) return { dead: true }
    if (!f.org) return cached
    org = f.org
    Keychain.set(K_ORG, org)
  }
  const r = await get(`${BASE}/${org}/usage`, key)
  if (isDead(r)) return { dead: true }
  if (r.status === 200 && r.json) {
    const rows = parseRows(r.json)
    if (rows.length) {
      const fresh = { rows, mix: parseMix(r.json), extra: parseExtra(r.json), ts: Date.now() }
      fm.writeString(CACHE, JSON.stringify(fresh))
      return fresh
    }
  }
  return cached
}

// ---- render ----

// One unit, rounded down: "3d", "8h", "40m", "now".
function fmtReset(iso) {
  const m = iso ? Math.floor((new Date(iso) - Date.now()) / 60e3) : NaN
  if (isNaN(m)) return ""
  if (m < 1) return "now"
  if (m < 60) return `${m}m`
  if (m < 24 * 60) return `${Math.floor(m / 60)}h`
  return `${Math.floor(m / (24 * 60))}d`
}

const SHORT = { "Claude Code": "Code", "Claude Duet": "Duet" }
const SHADES = [1, 0.7, 0.45, 0.25, 0.15]
const ACCENT = ["#D97757", "#D97757"] // [light, dark]
const RED = ["#FF3B30", "#FF453A"]
const toneOf = r => (r.pct >= 90 ? RED : ACCENT)
const minute = r => (r && r.resets ? Math.floor(new Date(r.resets) / 60e3) : null)
// Widget size in points by screen height: [medium width, height]. Small is height x height.
const SIZES = { 932: [364, 170], 926: [364, 170], 896: [360, 169], 852: [338, 158], 844: [338, 158],
                812: [329, 155], 780: [329, 155], 736: [348, 157], 667: [321, 148], 568: [292, 141] }
// Rough width of system-font text, for legend fitting.
const textW = (s, size) => [...s].reduce((w, c) =>
  w + (c === " " ? 0.25 : c === "·" ? 0.3 : /[0-9]/.test(c) ? 0.62 : /[A-Z]/.test(c) ? 0.68 : 0.54), 0) * size

// Hero: an active session limit if there is one, else the all-models weekly limit.
function pickHero(rows) {
  return rows.find(r => /^(session|five_hour)/.test(r.kind || "") && r.active !== false)
    || rows.find(r => r.kind === "weekly_all") || rows[0]
}

// Ring gauge image with round caps, drawn for the dark tile: white track, `hex` progress.
function ring(pct, d, sw, hex, a) {
  const ctx = new DrawContext()
  ctx.size = new Size(d, d)
  ctx.opaque = false
  ctx.respectScreenScale = true
  const r = (d - sw) / 2, c = d / 2
  ctx.setLineWidth(sw)
  ctx.setStrokeColor(new Color("#FFFFFF", 0.14 * a))
  ctx.strokeEllipse(new Rect(sw / 2, sw / 2, d - sw, d - sw))
  const f = Math.max(0, Math.min(1, pct / 100))
  if (f > 0) {
    const at = t => new Point(c + r * Math.cos(2 * Math.PI * t - Math.PI / 2), c + r * Math.sin(2 * Math.PI * t - Math.PI / 2))
    const n = Math.max(2, Math.ceil(f * 120))
    const path = new Path()
    path.move(at(0))
    for (let i = 1; i <= n; i++) path.addLine(at(f * i / n))
    ctx.setStrokeColor(new Color(hex, a))
    ctx.addPath(path)
    ctx.strokePath()
    ctx.setFillColor(new Color(hex, a))
    for (const p of [at(0), at(f)]) ctx.fillEllipse(new Rect(p.x - sw / 2, p.y - sw / 2, sw, sw))
  }
  return ctx.getImage()
}

// Bento board: a dark hero tile, plus (medium) a column of light tiles for the other limits and the breakdown.
function render(state, family) {
  const w = new ListWidget()
  const a = state.stale ? 0.5 : 1
  const dyn = (light, dark, x = 1) => Color.dynamic(new Color(light, a * x), new Color(dark, a * x))
  const tint = (tone, x = 1) => dyn(tone[0], tone[1], x)
  const white = (x = 1) => new Color("#FFFFFF", a * x)
  const fg = dyn("#000000", "#FFFFFF")
  const dim = dyn("#000000", "#FFFFFF", 0.5)
  const num = size => (Font.boldRoundedSystemFont ? Font.boldRoundedSystemFont(size) : Font.boldMonospacedSystemFont(size))
  w.backgroundColor = Color.dynamic(new Color("#EFEFF1"), new Color("#000000"))
  w.refreshAfterDate = new Date(Date.now() + 15 * 60e3)
  w.url = state.dead ? "scriptable:///run/Claude%20Usage" : "https://claude.ai/settings/usage"
  w.setPadding(10, 10, 10, 10)

  const text = (parent, s, font, color) => {
    const t = parent.addText(s)
    t.font = font
    t.textColor = color
    t.lineLimit = 1
    return t
  }
  const centered = (parent, fill) => {
    const s = parent.addStack()
    s.addSpacer()
    fill(s)
    s.addSpacer()
  }
  const tile = (parent, dark) => {
    const t = parent.addStack()
    t.layoutVertically()
    t.cornerRadius = 18
    t.setPadding(12, 12, 12, 12)
    if (dark) {
      t.backgroundColor = new Color("#111113", a)
      t.borderWidth = 1 // shows in dark mode only
      t.borderColor = Color.dynamic(new Color("#FFFFFF", 0), white(0.1))
    } else t.backgroundColor = dyn("#FFFFFF", "#1C1C1E")
    return t
  }
  const bar = (parent, width, h, color) => {
    const s = parent.addStack()
    s.size = new Size(width, h)
    s.cornerRadius = h / 2
    s.backgroundColor = color
    return s
  }

  const rows = state.dead ? [] : state.rows || []
  const hero = pickHero(rows)

  // Dark tile: label + reset on top, ring centered below. Fills its parent unless given a width.
  const heroTile = (parent, width) => {
    const t = tile(parent, true)
    if (width) t.size = new Size(width, 0)
    if (!hero) {
      t.addSpacer()
      centered(t, s => text(s, state.dead ? "Sign in" : "–", Font.mediumSystemFont(15), white()))
      t.addSpacer()
      return
    }
    const top = t.addStack()
    top.centerAlignContent()
    text(top, hero.label, Font.systemFont(12), white(0.55))
    top.addSpacer()
    const z = fmtReset(hero.resets)
    if (z) {
      const sym = SFSymbol.named("clock")
      if (sym) {
        sym.applyFont(Font.systemFont(10))
        const im = top.addImage(sym.image)
        im.imageSize = new Size(10, 10)
        im.tintColor = white(0.55)
        top.addSpacer(3)
      }
      text(top, z, Font.systemFont(12), white(0.55))
    }
    t.addSpacer()
    centered(t, s => {
      const g = s.addStack()
      g.size = new Size(82, 82)
      g.backgroundImage = ring(hero.pct, 82, 8, toneOf(hero)[1], a)
      g.centerAlignContent()
      g.addSpacer()
      const n = g.addStack()
      n.bottomAlignContent()
      text(n, `${Math.round(hero.pct)}`, num(24), white())
      n.addSpacer(1)
      text(n, "%", Font.systemFont(11), white(0.55))
      g.addSpacer()
    })
    t.addSpacer()
  }

  const others = hero ? rows.filter(r => r !== hero).concat(state.extra ? [state.extra] : []) : []
  const mix = (state.mix || []).filter(m => m.pct > 0).sort((x, y) => y.pct - x.pct)
  const small = family !== "medium" && family !== "large"
  if (small || !hero || (!others.length && !mix.length)) {
    heroTile(w)
    return w
  }

  // Medium: square dark tile on the left, light tiles stacked on the right.
  const scr = Device.screenSize()
  const [MW, MH] = SIZES[Math.max(scr.width, scr.height)] || [338, 158]
  const S = MH - 20 // column height = dark tile side
  const CW = MW - 20 - S - 8 - 24 // content width inside a light tile
  const n = others.length
  // What fits in the column: full-size rows with the breakdown, else compact rows, else no breakdown.
  const MIX_H = 24 + 6 + 6 + 13
  const fits = ([compact, withMix]) =>
    !n || 24 + n * (compact ? 24 : 32) + 8 * (n - 1) <= S - (withMix ? MIX_H + 8 : 0)
  const hasMix = mix.length > 0
  const [compact, showMix] = [[false, hasMix], [true, hasMix], [false, false], [true, false]].find(fits) || [true, false]

  const body = w.addStack()
  heroTile(body, S)
  body.addSpacer(8)
  const right = body.addStack()
  right.layoutVertically()

  // (a) Limit tile: one row per non-hero limit; takes whatever height the breakdown leaves.
  if (n) {
    const lt = tile(right, false)
    lt.addSpacer()
    others.forEach((r, i) => {
      if (i) lt.addSpacer(8)
      const line = lt.addStack()
      line.centerAlignContent()
      text(line, r.label, Font.systemFont(12), dim)
      if (r.resets && minute(r) !== minute(hero)) {
        line.addSpacer(4)
        text(line, fmtReset(r.resets), Font.systemFont(11), dim)
      }
      line.addSpacer()
      text(line, `${Math.round(r.pct)}%`, num(compact ? 15 : 20), fg)
      lt.addSpacer(compact ? 2 : 4)
      const track = bar(lt, CW, 4, tint(ACCENT, 0.18))
      const fill = Math.max(0, Math.min(1, r.pct / 100)) * CW
      if (fill >= 1) bar(track, fill, 4, tint(toneOf(r)))
      track.addSpacer()
    })
    lt.addSpacer()
  }

  // (b) Breakdown tile: largest first, shades of the accent, one legend line.
  if (showMix) {
    if (n) right.addSpacer(8)
    const bt = tile(right, false)
    if (!n) bt.addSpacer()
    const total = mix.reduce((s, m) => s + m.pct, 0)
    const room = CW - 2 * (mix.length - 1)
    const stack = bt.addStack()
    stack.size = new Size(CW, 6)
    mix.forEach((m, i) => {
      if (i) stack.addSpacer(2)
      bar(stack, Math.max(2, m.pct / total * room), 6, tint(ACCENT, SHADES[Math.min(i, SHADES.length - 1)]))
    })
    stack.addSpacer()
    // One line, never wraps: drop the smallest items until it fits (the text may shrink up to 10%).
    const items = mix.map(m => `${SHORT[m.name] || m.name} ${Math.round(m.pct)}`)
    let legend = items.join(" · ")
    while (items.length > 1 && textW(legend, 11) > CW / 0.9) legend = (items.pop(), items.join(" · "))
    bt.addSpacer(6)
    const lg = bt.addStack()
    lg.size = new Size(CW, 0)
    text(lg, legend, Font.systemFont(11), dim).minimumScaleFactor = 0.9
    lg.addSpacer()
    if (!n) bt.addSpacer()
  }
  return w
}

// ---- setup (in-app only) ----

async function ask(title, message, secure) {
  const a = new Alert()
  a.title = title
  a.message = message
  secure ? a.addSecureTextField("sessionKey", "") : a.addTextField("org uuid", "")
  a.addAction("Save")
  a.addCancelAction(secure && Keychain.contains(K_KEY) ? "Preview" : "Cancel")
  return (await a.presentAlert()) === -1 ? "" : a.textFieldValue(0).trim()
}

async function setup() {
  const have = Keychain.contains(K_KEY)
  const key = (await ask("Claude sessionKey",
    have ? "Paste a new key to replace the saved one, or Preview." : "Paste the sessionKey cookie from claude.ai.",
    true)).replace(/^sessionKey=/, "")
  if (!key) return
  Keychain.set(K_KEY, key)
  if (Keychain.contains(K_ORG)) Keychain.remove(K_ORG)
  const f = await findOrg(key)
  const org = f.org || (f.dead ? "" : await ask("Organization ID",
    "Couldn't find it automatically. Paste the org uuid from claude.ai/settings/account.", false))
  if (org) Keychain.set(K_ORG, org)
}

// ---- main ----

if (config.runsInApp) await setup()
const state = await load()
if (!state.dead) state.stale = !state.ts || Date.now() - state.ts > STALE_MS
const widget = render(state, config.runsInWidget ? config.widgetFamily : "medium")
if (config.runsInWidget) Script.setWidget(widget)
else await widget.presentMedium()
Script.complete()
