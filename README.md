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
- [x] The window keeps its 420×260 footprint for its entire lifetime and is only
      *shaped* down to the pill when collapsed — no resize, so no blink
- [x] Hover to open (70 ms intent), 160 ms grace period before closing
- [x] Click the header to pin, `Esc` to collapse, blur auto-collapses
- [x] Pin and hide buttons, live clock while collapsed
- [x] Four sections (Media / System / Keys / Alerts) with a sliding tab indicator,
      `←`/`→` to switch, placeholder panels for M3–M6
- [x] Layered glass styling: specular top edge, radial sheen, inset shading
- [x] `npm run smoke` now also checks expand, pin, Esc collapse and state reset on hide

**Milestone 3 — system monitoring** ✅

- [x] 1 s tick: CPU load from `os.cpus()` deltas, RAM from `os`, uptime
- [x] Network throughput from cumulative Win32 interface counters (`GetIfTable`
      through koffi), with 32-bit wrap handling and an offline fallback
- [x] GPU utilisation / VRAM / temperature / power via `systeminformation` (5 s)
- [x] Disk, battery and CPU temperature on a 15 s background loop
- [x] 60-sample sparklines for CPU, GPU and RAM, per-metric accent colours
- [x] CPU/GPU model line in the cards (`i7-13620H`, `RTX 3050 6GB`)
- [x] Footer strip: live network rates, system-disk free space, battery + charging
- [x] Sampling only runs while the System tab is open inside the expanded island
      (and stops when the island collapses or hides)
- [x] Temperature is hidden when the sensor is unavailable (no admin / no OHM)
- [x] `npm run smoke` verifies the sampler end-to-end (CPU, RAM, GPU, disk, battery, net)

Next: Milestone 4 — media (SMTC / YouTube now playing).

## Try it

```bash
npm run dev
```

- The island appears centred at the top of the primary display.
- Hover it to open the card, move away to collapse.
- Click the header (or the pin button) to keep it open; `Esc` collapses it.
- `←` / `→` switch sections, double-click the pill to hide the island.
- The **System** section shows live CPU/GPU/RAM cards with model names and
  sparklines plus network, disk free space and battery in the footer.
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
    services/system.ts  system sampler (os + koffi + systeminformation)
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
- The window is created at the expanded 420×260 footprint and never moves or
  resizes. `island:set-expanded` only changes the window **shape**
  (`win.setShape`): the full card while open, the 248×46 pill rect while
  collapsed, so clicks around the pill fall through to the desktop. Resizing a
  visible transparent window makes Windows present one stale frame at the new
  origin (the pill jumped ~108 px for a frame and looked like a blink).
- No native `title` tooltips inside the island — Windows renders them as a separate
  always-on-top window that covers the card.
- `systeminformation` is slow on Windows (its `currentLoad`/`networkStats` wait
  ~1.3 s per call), so the 1 s path uses `os` for CPU/RAM and raw `GetIfTable`
  counters through **koffi** for network. Only GPU (5 s), disk/battery/temp (15 s)
  use `systeminformation`. Sampling is paused unless the System tab is visible.
- `koffi` ships a prebuilt N-API binary; when packaging, its `.node` file must be
  unpacked from the asar archive (Milestone 7).
- CPU temperature needs admin rights or an OHM-compatible sensor; when
  `systeminformation` returns `null` the UI shows thread count instead.
- Placeholder menu entry “Settings…” is wired up in Milestone 7.
- If `npm install` finishes without `node_modules/electron/dist`, download the
  runtime manually: `node node_modules/electron/install.js`.