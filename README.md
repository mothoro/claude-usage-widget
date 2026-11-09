# Claude Usage widget
Scriptable iOS widget showing your claude.ai plan usage (% used). Reads an unofficial claude.ai endpoint; your sessionKey stays in Scriptable's Keychain.
**Install:** in Scriptable, create a script named `Update Claude Usage`, paste in `Update Claude Usage.js`, run it, then run `Claude Usage` and paste your sessionKey.
**Rotate key:** run `Claude Usage` in the app and paste the new key. The widget shows "Sign in" when the old key stops working.
**Update:** run `Update Claude Usage`.
Network: claude.ai only (the updater also reads raw.githubusercontent.com). No analytics.
