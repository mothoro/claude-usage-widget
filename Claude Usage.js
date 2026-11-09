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
                                kind: l.kind || "", active: l.is_active !== false, warn: l.severity === "warning" }))
  }
  return [["Session", "five_hour", u.five_hour], ["Week", "weekly_all", u.seven_day]]
    .filter(([, , b]) => b && b.utilization != null)
    .map(([lbl, kind, b]) => ({ label: lbl, pct: Number(b.utilization) || 0, resets: b.resets_at || null,
                                kind, active: true, warn: false }))
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
const MONO_W = 0.6 // monospaced glyph width per point of font size, for legend fitting
const ACCENT = ["#D97757", "#D97757"] // [light, dark]
const ORANGE = ["#FF9500", "#FF9F0A"]
const RED = ["#FF3B30", "#FF453A"]
// `hot` is the pre-redesign cache flag (warning or >= 90).
const toneOf = r => (r.pct >= 90 ? RED : r.warn || r.hot ? ORANGE : ACCENT)
const minute = r => (r && r.resets ? Math.floor(new Date(r.resets) / 60e3) : null)

// Hero: an active session limit if there is one, else the all-models weekly limit.
function pickHero(rows) {
  return rows.find(r => /^(session|five_hour)/.test(r.kind || "") && r.active !== false)
    || rows.find(r => r.kind === "weekly_all") || rows[0]
}

// Ring gauge image, 7pt stroke with round caps. DrawContext colors are static, so it uses the light tint.
function ring(pct, d, tone, a) {
  const ctx = new DrawContext()
  ctx.size = new Size(d, d)
  ctx.opaque = false
  ctx.respectScreenScale = true
  const sw = 7, r = (d - sw) / 2, c = d / 2
  ctx.setLineWidth(sw)
  ctx.setStrokeColor(new Color(tone[0], 0.18 * a))
  ctx.strokeEllipse(new Rect(sw / 2, sw / 2, d - sw, d - sw))
  const f = Math.max(0, Math.min(1, pct / 100))
  if (f > 0) {
    const at = t => new Point(c + r * Math.cos(2 * Math.PI * t - Math.PI / 2), c + r * Math.sin(2 * Math.PI * t - Math.PI / 2))
    const n = Math.max(2, Math.ceil(f * 120))
    const path = new Path()
    path.move(at(0))
    for (let i = 1; i <= n; i++) path.addLine(at(f * i / n))
    ctx.setStrokeColor(new Color(tone[0], a))
    ctx.addPath(path)
    ctx.strokePath()
    ctx.setFillColor(new Color(tone[0], a))
    for (const p of [at(0), at(f)]) ctx.fillEllipse(new Rect(p.x - sw / 2, p.y - sw / 2, sw, sw))
  }
  return ctx.getImage()
}

function render(state, family) {
  const w = new ListWidget()
  const a = state.stale ? 0.5 : 1
  const dyn = (light, dark, x = 1) => Color.dynamic(new Color(light, a * x), new Color(dark, a * x))
  const col = (tone, x = 1) => dyn(tone[0], tone[1], x)
  const fg = dyn("#000000", "#FFFFFF")
  const dim = dyn("#000000", "#FFFFFF", 0.55)
  w.backgroundColor = Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E"))
  w.refreshAfterDate = new Date(Date.now() + 15 * 60e3)
  w.url = state.dead ? "scriptable:///run/Claude%20Usage" : "https://claude.ai/settings/usage"
  w.setPadding(16, 16, 16, 16)

  const text = (parent, s, font, color) => {
    const t = parent.addText(s)
    t.font = font
    t.textColor = color
    t.lineLimit = 1
    return t
  }

  if (state.dead || !state.rows || !state.rows.length) {
    w.addSpacer()
    const s = w.addStack()
    s.addSpacer()
    text(s, state.dead ? "Sign in" : "–", Font.mediumSystemFont(15), fg)
    s.addSpacer()
    w.addSpacer()
    return w
  }

  const small = family !== "medium" && family !== "large"
  const rows = state.rows
  const hero = pickHero(rows)
  const bar = (parent, width, h, color) => {
    const s = parent.addStack()
    s.size = new Size(width, h)
    s.cornerRadius = h / 2
    s.backgroundColor = color
    return s
  }
  const heroReset = () => {
    const z = fmtReset(hero.resets)
    return z === "now" ? "Resets now" : z ? `Resets in ${z}` : ""
  }
  // Ring with the percent centered on it.
  const gauge = (parent, d) => {
    const g = parent.addStack()
    g.size = new Size(d, d)
    g.backgroundImage = ring(hero.pct, d, toneOf(hero), a)
    g.centerAlignContent()
    g.addSpacer()
    const n = g.addStack()
    n.bottomAlignContent()
    text(n, `${Math.round(hero.pct)}`, Font.boldMonospacedSystemFont(22), fg)
    n.addSpacer(1)
    text(n, "%", Font.systemFont(11), dim)
    g.addSpacer()
  }

  // Small: hero only, centered.
  if (small) {
    const centered = fill => {
      const s = w.addStack()
      s.addSpacer()
      fill(s)
      s.addSpacer()
    }
    w.addSpacer()
    centered(s => gauge(s, 76))
    w.addSpacer(6)
    centered(s => text(s, hero.label, Font.systemFont(15), fg))
    const rz = heroReset()
    if (rz) {
      w.addSpacer(1)
      centered(s => text(s, rz, Font.systemFont(13), dim))
    }
    w.addSpacer()
    return w
  }

  // Medium: [ring][label / reset][rows container] on top, breakdown full width at the bottom.
  const W = 306, D = 84, TW = 80
  const others = rows.filter(r => r !== hero).concat(state.extra ? [state.extra] : [])
  const top = w.addStack()
  top.centerAlignContent()
  gauge(top, D)
  top.addSpacer(10)
  const info = top.addStack()
  info.layoutVertically()
  info.size = new Size(TW, 0)
  text(info, hero.label, Font.systemFont(15), fg)
  const rz = heroReset()
  if (rz) {
    info.addSpacer(2)
    text(info, rz, Font.systemFont(13), dim).minimumScaleFactor = 0.8
  }
  if (others.length) {
    top.addSpacer(12)
    const cw = W - D - 10 - TW - 12
    const bw = cw - 24
    const box = top.addStack()
    box.layoutVertically()
    box.size = new Size(cw, 0)
    box.setPadding(12, 12, 12, 12)
    box.cornerRadius = 12
    box.backgroundColor = Color.dynamic(new Color("#000000", 0.05 * a), new Color("#FFFFFF", 0.07 * a))
    others.forEach((r, i) => {
      if (i) box.addSpacer(8)
      const tone = toneOf(r)
      const line = box.addStack()
      line.centerAlignContent()
      text(line, r.label, Font.systemFont(13), fg).minimumScaleFactor = 0.8
      line.addSpacer()
      if (r.resets && minute(r) !== minute(hero)) {
        text(line, fmtReset(r.resets), Font.regularMonospacedSystemFont(11), dim)
        line.addSpacer(4)
      }
      text(line, `${Math.round(r.pct)}%`, Font.regularMonospacedSystemFont(13), col(tone))
      box.addSpacer(3)
      const track = bar(box, bw, 3, col(tone, 0.18))
      const fill = Math.max(0, Math.min(1, r.pct / 100)) * bw
      if (fill >= 1) bar(track, fill, 3, col(tone))
      track.addSpacer()
    })
  } else {
    top.addSpacer()
  }

  // Breakdown: largest first, shades of the accent. Skipped when 3+ rows already fill the height.
  const mix = (state.mix || []).filter(m => m.pct > 0).sort((x, y) => y.pct - x.pct)
  w.addSpacer()
  if (mix.length && others.length <= 2) {
    const total = mix.reduce((s, m) => s + m.pct, 0)
    const room = W - 2 * (mix.length - 1)
    const stack = w.addStack()
    stack.size = new Size(W, 4)
    mix.forEach((m, i) => {
      if (i) stack.addSpacer(2)
      bar(stack, Math.max(2, m.pct / total * room), 4, col(ACCENT, SHADES[Math.min(i, SHADES.length - 1)]))
    })
    stack.addSpacer()
    // One line, never wraps: drop the smallest items until it fits.
    const items = mix.map(m => `${SHORT[m.name] || m.name} ${Math.round(m.pct)}`)
    let legend = items.join(" · ")
    while (items.length > 1 && legend.length * 11 * MONO_W > W) legend = (items.pop(), items.join(" · "))
    w.addSpacer(4)
    text(w.addStack(), legend, Font.regularMonospacedSystemFont(11), dim)
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
