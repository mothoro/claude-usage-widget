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
    return u.limits.map(l => {
      const pct = Number(l.percent) || 0
      return { label: label(l), pct, resets: l.resets_at || null,
               hot: l.severity === "warning" || pct >= 90 }
    })
  }
  return [["Session", u.five_hour], ["Week", u.seven_day]]
    .filter(([, b]) => b && b.utilization != null)
    .map(([lbl, b]) => {
      const pct = Number(b.utilization) || 0
      return { label: lbl, pct, resets: b.resets_at || null, hot: pct >= 90 }
    })
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
      const fresh = { rows, mix: parseMix(r.json), ts: Date.now() }
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

function render(state, family) {
  const w = new ListWidget()
  const a = state.stale ? 0.5 : 1
  const dyn = (light, dark, x = 1) => Color.dynamic(new Color(light, a * x), new Color(dark, a * x))
  const fg = dyn("#000000", "#FFFFFF")
  const dim = dyn("#3C3C43", "#EBEBF5", 0.6)
  const blue = x => dyn("#007AFF", "#0A84FF", x)
  const red = x => dyn("#FF3B30", "#FF453A", x)
  w.backgroundColor = Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E"))
  w.refreshAfterDate = new Date(Date.now() + 15 * 60e3)
  w.url = state.dead ? "scriptable:///run/Claude%20Usage" : "https://claude.ai/settings/usage"
  w.setPadding(16, 16, 16, 16)

  if (state.dead || !state.rows || !state.rows.length) {
    w.addSpacer()
    const s = w.addStack()
    s.addSpacer()
    const t = s.addText(state.dead ? "Sign in" : "–")
    t.font = Font.mediumSystemFont(15)
    t.textColor = fg
    s.addSpacer()
    w.addSpacer()
    return w
  }

  const small = family !== "medium" && family !== "large"
  const rows = small ? state.rows.slice(0, 2) : state.rows
  const barW = small ? 126 : 306
  const minute = r => (r.resets ? Math.floor(new Date(r.resets) / 60e3) : null)
  const shared = minute(rows[0]) !== null && rows.every(r => minute(r) === minute(rows[0]))

  const bar = (parent, width, tint) => {
    const s = parent.addStack()
    s.size = new Size(width, 4)
    s.cornerRadius = 4
    s.backgroundColor = tint
    return s
  }
  const small10 = (parent, text) => {
    const t = parent.addText(text)
    t.font = Font.regularMonospacedSystemFont(10)
    t.textColor = dim
    t.lineLimit = 1
    return t
  }

  if (small) w.addSpacer()
  rows.forEach((r, i) => {
    if (i) w.addSpacer(10)
    const tint = r.hot ? red : blue
    const top = w.addStack()
    top.centerAlignContent()
    const l = top.addText(r.label)
    l.font = Font.systemFont(13)
    l.textColor = fg
    l.lineLimit = 1
    top.addSpacer()
    const p = top.addText(`${Math.round(r.pct)}%`)
    p.font = Font.semiboldMonospacedSystemFont(13)
    p.textColor = fg
    if (!shared && r.resets) {
      top.addSpacer(6)
      small10(top, fmtReset(r.resets))
    }
    w.addSpacer(4)
    const track = bar(w, barW, tint(0.15))
    const fill = Math.max(0, Math.min(1, r.pct / 100)) * barW
    if (fill >= 1) bar(track, fill, tint(1))
    track.addSpacer()
  })
  if (shared) {
    w.addSpacer(4)
    const s = w.addStack()
    s.addSpacer()
    const z = fmtReset(rows[0].resets)
    small10(s, z === "now" ? "Resets now" : `Resets in ${z}`)
  }

  // Medium only: per-product share, largest first, shades of the one tint.
  const mix = small ? [] : (state.mix || []).filter(m => m.pct > 0).sort((x, y) => y.pct - x.pct)
  if (mix.length) {
    w.addSpacer()
    w.addSpacer(14)
    const total = mix.reduce((s, m) => s + m.pct, 0)
    const room = barW - 2 * (mix.length - 1)
    const stack = w.addStack()
    stack.size = new Size(barW, 4)
    mix.forEach((m, i) => {
      if (i) stack.addSpacer(2)
      bar(stack, Math.max(2, m.pct / total * room), blue(SHADES[Math.min(i, SHADES.length - 1)]))
    })
    stack.addSpacer()
    // One line, never wraps: drop the smallest items until it fits the bar width.
    const items = mix.map(m => `${SHORT[m.name] || m.name} ${Math.round(m.pct)}`)
    let legend = items.join(" · ")
    while (items.length > 1 && legend.length * 10 * MONO_W > barW) legend = (items.pop(), items.join(" · "))
    w.addSpacer(4)
    small10(w.addStack(), legend)
  } else {
    w.addSpacer()
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
