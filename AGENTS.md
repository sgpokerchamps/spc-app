<!-- BEGIN:spc-app-project-context -->
# SPC Tournament Director (TD) App — Project Context

## What this is
Electron desktop app used to run live poker tournaments on the M/V Aegean Paradise during SPC events. Serves the tournament floor, tracks POTY, syncs with Supabase, and drives HDMI displays for players. NOT a web app, NOT the same as the sgpokerchamps main site or the spc-members Community Card backend.

## CRITICAL: pushes to this repo are effectively live deploys
- The Electron app self-updates by pulling from `sgpokerchamps/spc-app` main branch (see main.js lines 27-28)
- The 🔄 button in the app sidebar fetches and applies changes to `app.html` and `server.js`
- Any push to origin/main can be pulled by any live SPC device during an event
- NEVER push during a live event without explicit user confirmation
- Prefer feature branches for anything experimental; merge to main only when tested

## Architecture
- No `package.json` — Electron ships bundled in the packaged .app; this repo only holds the source files pulled by the auto-updater
- `main.js` (~11KB) — Electron main process: window management, tray, embedded sync server, self-update mechanism
- `server.js` (~54KB) — SPC Floor Server: pure Node `http` (NOT Express), handles table closing, seating, floor staff mobile UI. Different codebase from spc-members/server.js — do not confuse them.
- `app.html` (~407KB) — single-page React/Babel frontend loaded into BrowserWindow, no build step (Babel runs in-browser via <script>)

## Auto-update scope
- 🔄 button covers: `app.html` and `server.js` (pulled from GitHub main)
- `main.js` requires manual copy + asar repack on each machine — the update button CANNOT ship main.js changes
- If a task requires editing main.js, warn the user explicitly and remind them of the manual repack step

## Deployment
- Devices: MacBook Pro (primary/source of truth), MacBook Neo (event runner), Lenovo Windows (counter URL duties)
- HDMI connects to whichever machine is running the visible event
- Dual-instance support: `open -n "/Applications/SPC Tournament Director.app" --args --port=3457`

## Data model
- localStorage for tournament state persistence
- Supabase project `drzqkhcnoiebmplwahfo` for POTY cloud sync (any machine can commit)
- 55 historical tournaments (SPC I–XXI), 975 result rows, 582 unique players loaded

## Key features (do not remove without asking)
- POTY system: multi-year, unlimited undo, cloud sync via Supabase
- Break Table (app + floor UI)
- Country flags (QR scan + member lookup; Windows shows code not emoji)
- Shared regLog (app + counter sync)
- Undo bust restores previous seat
- Activity log (register/move/bust/clock/table)
- Dual-instance support (satellite + main event 1A/1B overlap)

## Explicitly removed features (do not reintroduce)
- Pre-registration drawer (multi-instance solved the actual problem)

## Build notes (rarely needed via Claude Code — user handles builds locally)
- macOS: `npx electron-builder --mac --arm64 --config.dmg.writeUpdateInfo=false` bypasses the Python-dependent blockmap step that fails on macOS 12+
- Windows via Parallels: `win-unpacked` folder is functional even when NSIS installer step fails; use `\\Mac\Home` UNC to access Mac home
- `main.js` bundled in asar — repack required after edits

## Coding conventions
- app.html: ASCII-only JSX, single-line JSX tags where possible
- Verify every edit with `grep -c` counts before committing
- Recover originals with `git show <hash>:<path>` before edits
- Review with `git diff | cat` before committing
- Always `git fetch` before starting new work to catch out-of-band GitHub web edits

## Working style
- Direct, no-fluff communication
- Test locally by running the app before committing anything that affects live behavior
- Never push during a live event
<!-- END:spc-app-project-context -->
