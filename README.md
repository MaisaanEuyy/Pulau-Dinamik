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
- [x] Double-click the pill to hide it, `--hidden` starts quietly at login
- [x] Persisted settings in `%APPDATA%\Dynamic Island KW\settings.json`

**Milestone 2 — motion, tabs and glass** ✅

- [x] Spring morph between the 248×46 pill and the 420×260 card
- [x] The window grows *before* the animation and only shrinks after it settles,
      so the pill is never clipped
- [x] Hover to open (70 ms intent), 160 ms grace period before closing
- [x] Click the header to pin, `Esc` to collapse, blur auto-collapses
- [x] Pin and hide buttons, live clock while collapsed
- [x] Four sections (Media / System / Keys / Alerts) with a sliding tab indicator,
      `←`/`→` to switch, placeholder panels for M3–M6
- [x] Layered glass styling: specular top edge, radial sheen, inset shading
- [x] `npm run smoke` now also checks expand, pin, Esc collapse and state reset on hide

Next: Milestone 3 — system monitoring (CPU, RAM, GPU, disk, network, battery).

## Try it

```bash
npm run dev
```

- The island appears centred at the top of the primary display.
- Hover it to open the card, move away to collapse.
- Click the header (or the pin button) to keep it open; `Esc` collapses it.
- `←` / `→` switch sections, double-click the pill to hide the island.
- `Ctrl+Alt+Space` (or the tray icon) toggles it; right-click the tray icon for
  display selection, launch-at-login and quit.

Windows 11 keeps new tray icons in the overflow flyout; drag the island icon onto the
taskbar if you want it permanently visible.

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
- Window resizing happens in two phases (`island:set-expanded`): grow immediately,
  shrink only after the collapse spring settles. Never call `setBounds` per frame.
- No native `title` tooltips inside the island — Windows renders them as a separate
  always-on-top window that covers the card.
- Placeholder menu entry “Settings…” is wired up in Milestone 7.
- If `npm install` finishes without `node_modules/electron/dist`, download the
  runtime manually: `node node_modules/electron/install.js`.