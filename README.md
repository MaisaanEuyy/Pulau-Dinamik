# Dynamic Island KW

MacBook-style **Dynamic Island** for Windows 11 (Electron + React + TypeScript).

The island is a borderless, transparent, always-on-top window that sits centred at
the top of the screen. Closing it only hides it — the app lives in the tray.

## Status

**Milestone 1 — shell** ✅

- [x] electron-vite + React + TypeScript scaffold
- [x] Transparent, frameless, always-on-top island window positioned top-centre
- [x] Tray icon (theme aware) with Show/Hide, display selection, launch-at-login, quit
- [x] Single instance (second launch shows the island)
- [x] Global hotkey `Ctrl+Alt+Space` to toggle the island
- [x] Persisted settings in `%APPDATA%\Dynamic Island KW\settings.json`
- [x] `--smoke-test` diagnostics mode

Next: Milestone 2 — collapse/expand motion, tabs, glass styling.

## Commands

```bash
npm install       # install dependencies
npm run dev       # run in development (HMR for the renderer)
npm run build     # production bundle into ./out
npm run typecheck # type-check main/preload and renderer
npm run smoke     # build + launch with --smoke-test, prints diagnostics and exits
npm run icons     # regenerate tray/app icons in ./resources
```

## Layout

```
src/
  main/                 Electron main process
    index.ts            lifecycle, single instance, hotkey, IPC
    settings.ts         tiny JSON settings store (no dependency)
    autostart.ts        Windows "run at login" sync
    tray.ts             tray icon + context menu
    windows/island.ts   transparent island BrowserWindow
  preload/index.ts      contextBridge API (window.island)
  renderer/             React UI
  shared/               types + IPC channel names shared by both sides
scripts/gen-icons.mjs   dependency-free PNG icon generator
resources/              generated icons (committed)
```

## Notes

- `sandbox: false` is required for the preload to use Node's `require`; the
  renderer itself still runs with `contextIsolation: true` and
  `nodeIntegration: false`.
- The window has `movable: false` and `resizable: false`; position is derived
  from the display work area plus `topOffset`.
- Placeholder menu entry “Settings…” is wired up in Milestone 2/7.