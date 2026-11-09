// Update Claude Usage: downloads the latest "Claude Usage" widget script from GitHub into Scriptable.
const SRC = "https://raw.githubusercontent.com/mothoro/claude-usage-widget/main/Claude%20Usage.js"
const req = new Request(SRC)
const code = await req.loadString()
if (req.response.statusCode !== 200 || !code.includes("Claude Usage")) throw new Error(`Download failed (HTTP ${req.response.statusCode})`)
// Write next to this script, so it lands in the right folder whether Scriptable uses iCloud or local storage.
const fm = module.filename.includes("/Mobile Documents/") ? FileManager.iCloud() : FileManager.local()
fm.writeString(fm.joinPath(fm.documentsDirectory(), "Claude Usage.js"), code)
const a = new Alert()
a.title = "Updated"
a.addAction("OK")
await a.presentAlert()
