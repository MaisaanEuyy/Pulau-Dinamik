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
- [x] The close button (or the hotkey/tray) tucks the island into the top edge;
      `--hidden` starts quietly at login
- [x] Persisted settings in `%APPDATA%\Dynamic Island KW\settings.json`

**Milestone 2 — motion, tabs and glass** ✅

- [x] Spring morph between the 300×46 pill and the 468×260 card
- [x] The window keeps its 468×260 footprint for its entire lifetime and is only
      *shaped* down to the pill when collapsed — no resize, so no blink
- [x] Click the pill to open, click the header again to pin, `Esc` to collapse,
      blur auto-collapses, unpinned cards close 280 ms after the pointer leaves
- [x] Pin and hide buttons, live clock in the pill
- [x] Five sections (Media / System / Keys / Alerts / Settings) with a sliding
      tab indicator, `←`/`→` to switch
- [x] Layered glass styling: specular top edge, radial sheen, inset shading
- [x] `npm run smoke` now also checks open, pin, Esc collapse and state reset on hide

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

**Milestone 4 — media / now playing** ✅

- [x] Reads the Windows SMTC session (`GlobalSystemMediaTransportControlsSessionManager`)
      through the shared PowerShell 5.1 WinRT helper (`src/main/services/winrt.ps1`)
- [x] Track title, artist, source app and cover art (artwork is optional — some
      players/browsers expose none, so the panel falls back to a music icon)
- [x] Previous / play-pause / next buttons, disabled when the session does not
      support them; the panel follows play state changes made outside the island
- [x] The shared helper starts lazily on the first Media/Toast subscription,
      speaks one JSON state line per change over stdout and takes
      `toggle`/`next`/`previous` on stdin
- [x] Media polling is switched off 30 s after the panel closes (and on
      hide/quit), so an idle island only pays for the toast listener
- [x] `npm run smoke` boots the helper and reports the detected session

**Revisions — volume HUD & album ambient** ✅

- [x] Volume and mute keys pop a HUD inside the island (speaker icon, animated
      level bar, percentage) that fades out after 1.5 s — collapsed and expanded
- [x] The level is read straight from the default render device
      (`IAudioEndpointVolume` through koffi COM vtable calls, 150 ms poll), so
      mixer, browser and media-key changes all show up — no helper process
- [x] The default endpoint is re-resolved every couple of seconds, so switching
      to headphones or another output device keeps working
- [x] Cover art is reduced to an ambient colour (`--ambient` CSS variable) that
      tints the island glass and the artwork shadow while Media is open
- [x] Ambient strength follows the artwork: vivid covers glow, greyscale sleeves
      stay almost neutral; the collapsed pill only picks up a hint
- [x] `npm run smoke` also reports the current volume and mute state

**Milestone 5 — keyboard indicator** ✅

- [x] Lock indicators for Caps / Num / Scroll and live modifier indicators for
      Shift / Ctrl / Alt / Win
- [x] Rhythm strip and a keys-per-minute meter fed by anonymous key-down counts
- [x] Key presses are counted with a `WH_KEYBOARD_LL` hook through koffi; the
      virtual key code is only used to keep the lock state in sync and is never
      stored, logged or sent to the renderer
- [x] The hook exists only while the Keys section is open — closing the section,
      collapsing the island or hiding it removes it again
- [x] Falls back to `GetKeyState` polling for the locks when the hook cannot be
      installed
- [x] `npm run smoke` reports the lock state and whether the hook is installed

**Revisions — mini views, smiley & notifications** ✅

- [x] The pill shows a live mini view of the active section instead of the
      "Dynamic Island" wordmark: artwork + title/artist + transport buttons,
      CPU/RAM/GPU, Caps/Num/Scroll + typing meter, or the latest alert
- [x] The mini view stays in the header when the card is open, so the quick
      controls never move — play/pause, next and previous work from the pill
- [x] The white dot became an interactive smiley: it bobs and blinks while idle,
      follows the pointer with its eyes, squishes when the island is pressed and
      grins while the card is open
- [x] Sections subscribe while they are *visible*, so the mini is live while
      collapsed and the sampling still stops when the island is hidden
- [x] **Milestone 6 — notifications**: a local HTTP API on `127.0.0.1:43110`
      (`POST /notify`, `GET /health`), a CLI (`npm run notify -- -t "Title"`),
      an Alerts list with clear/badge, and a transient header card for new ones
- [x] `npm run smoke` checks the notification API end-to-end (health + POST)

**Revisions — wide open card, white face & tuck-away hide** ✅

- [x] The mini view belongs to the pill only: opening the card drops the strip
      from the header, so the card no longer repeats the pill on top of itself.
      The open header is `face · clock · pin · close`
- [x] The smiley is now just white eyes and a mouth — no head, no colour — and it
      plays along with the current song: closed, blissful eyes + a wide grin and a
      slow sway while playing, a plain blink-and-float face when paused, pointer
      tracking on hover and a small "o" while pressed
- [x] Media subscribes for as long as the island is on screen (not just on the
      Media tab), so the face reacts to the song from any section
- [x] Double-click-to-hide is gone: the island now folds toward its top edge while
      the window slides up out of the work area, and slides back down on show
- [x] `npm run smoke` checks that the close button hides, that the window actually
      travels upwards, and that it is parked back at rest afterwards

**Revisions — Windows toast mirroring** ✅

- [x] The Alerts section now mirrors **real Windows notifications** (WhatsApp,
      Chrome, Outlook, Telegram, Discord …) instead of only the local API: the
      shared PowerShell helper reads the notification centre through the WinRT
      `UserNotificationListener` and forwards each toast as it arrives
- [x] Each toast lands in the same list/HUD/badge as `POST /notify`, labelled with
      the app that sent it ("Google Chrome", "Outlook", …)
- [x] Each toast is imported once, de-duplicated by Windows' own notification id,
      including the ones that landed while the island was tucked away
- [x] Windows asks for permission once; if it is denied the Alerts section explains
      where to turn it back on instead of staying silently empty
- [x] `npm run smoke` reports `toasts.access` and how many notification-centre
      entries the bridge imported

**Revisions — music nod, tighter face & pop-open notifications** ✅

- [x] The face now nods to the song itself instead of a fixed timer: the default
      output's Core Audio peak meter drives a nod, a squash and an alternating lean,
      so it bobs and dances with what is actually playing (one cheap COM read per
      frame in the main process — no capture stream, nothing recorded)
- [x] The eyes travel less (about half a pixel) and sit closer to the mouth, so
      pointer tracking reads as a glance instead of the face pulling apart
- [x] A new notification opens the card by itself for ~4 s — and if the island was
      hidden it slides back down first, then folds and hides again unless the
      pointer touched it or it is pinned
- [x] The card that pops open is always the **Alerts** section, even if a song (or
      the stats/keys panel) was up: the notification is what you are meant to look
      at. The section you were on comes back when the HUD folds, unless you clicked
      into the card during it
- [x] The peek shows **only the newest notification** ("Just arrived") instead of
      dumping the whole history; clicking anywhere in the card unfolds the list
- [x] The volume HUD no longer ends in a hard vertical seam next to the pin/close
      buttons in the expanded view: its backdrop runs edge to edge and the buttons
      float above it, so the header reads as one strip
- [x] The toast bridge now runs for the app's whole lifetime (it used to idle out
      30 s after a hide), so a notification can pop the island open while it is
      tucked away
- [x] While a song is playing, little white notes drift up off the face — pure CSS,
      beat-scaled and off under `prefers-reduced-motion` — so the pill reads as
      "humming" even when you are on another section
- [x] Fixed the play/pause button blinking under the cursor: the primary buttons
      swapped an opaque gradient for a flat colour while `background-color` faded
      in from transparent, so the white circle flashed dark for ~140 ms on every
      hover. Hover now brightens an inset shadow and never touches the background
- [x] Packaging: `npm run dist` builds an NSIS installer (desktop + Start Menu
      shortcut, per-user install, no admin prompt) — see **Build installer**

**Revisions — settings menu & readable notifications** ✅

- [x] New **Settings** section in the tabbar: light/dark appearance, start with
      Windows, and the current toggle hotkey
- [x] The Appearance switch flips the whole island — glass, text, cards, buttons,
      smiley and notification HUD — between the dark chrome and a light one, and
      the choice is persisted in `settings.json` (`theme`)
- [x] The tray's **Settings…** entry now opens the island, pinned on that section
- [x] The card is wider (468 px) and a notification peeking in the header wraps
      its title (up to two lines) and message (up to three lines) instead of
      cutting it off with an ellipsis; the header grows while the peek is up
- [x] The Alerts list wraps messages instead of truncating them, so the history
      stays readable too

Next: per-app notification filters.

## Try it

```bash
npm run dev
```

- The island appears centred at the top of the primary display.
- Click the pill to open the card; click the header again (or the pin button) to
  keep it open. `Esc` collapses it, and an unpinned card closes when the pointer
  leaves.
- The pill itself is a mini dashboard: artwork + title with play/pause and
  skip buttons, CPU/RAM/GPU, the Caps/Num/Scroll state, or the latest alert.
- `←` / `→` switch sections; the × button (or `Ctrl+Alt+Space`) tucks the island
  up into the top edge — there is no double-click-to-hide any more.
- The **Media** section shows what is playing right now (Edge/Chrome, Spotify,
  Media Player …) with working previous / play-pause / next buttons.
- The **System** section shows live CPU/GPU/RAM cards with model names and
  sparklines plus network, disk free space and battery in the footer.
- The **Keys** section shows Caps/Num/Scroll, the modifiers you are holding and a
  live typing meter — it counts keystrokes but never records what you type.
- The **Alerts** section mirrors your Windows notifications and also lists
  anything posted through the local API (see below); it keeps a red dot on the tab
  while new ones are waiting.
- The **Settings** section switches the island between dark and light, toggles
  start-with-Windows and shows the current hotkey; the tray's **Settings…** entry
  opens it from anywhere.
- `Ctrl+Alt+Space` (or the tray icon) toggles it; right-click the tray icon for
  display selection, launch-at-login and quit.

## Notifications

### Windows notifications

The island mirrors the notifications Windows already shows — WhatsApp, Chrome,
Outlook, Telegram, Discord, whatever sends a toast. The shared PowerShell helper
(the same one that talks to SMTC) reads the notification centre through the WinRT
`UserNotificationListener`, and every toast that arrives while it runs is
forwarded to the Alerts section, labelled with the app that sent it.

- Windows asks for permission the first time ("let this app read your
  notifications"). If it is denied the Alerts section says so instead of staying
  silently empty — re-enable it in **Settings → Privacy & security →
  Notifications**.
- The shared helper runs for the app's whole lifetime — a notification has to be
  able to pop the island open while it is tucked away — and stops when the app
  quits.
- The first pass after the bridge starts imports what is already sitting in the
  notification centre, exactly once: entries are de-duplicated by `app +
  notification id + timestamp`, and anything older than the app start is ignored.
- Text and app names stay in memory (last 24) and are never sent anywhere; the
  helper writes no files, just one JSON line per toast over the pipe.

### Local API and CLI

The app listens on `http://127.0.0.1:43110` (it walks up to `:43119` when the
port is taken) and only binds to loopback — nothing is exposed to the network.

```bash
npm run notify -- -t "Build finished" -m "42 tests passed" -l success -a ci
curl -X POST http://127.0.0.1:43110/notify \
  -H "Content-Type: application/json" \
  -d '{"title":"Coffee is ready","level":"info"}'
curl http://127.0.0.1:43110/health
```

`level` is one of `info`, `success`, `warning`, `error`. New notifications pop the
card open for ~4 s, land in the Alerts list and mark the tab with a dot — even when
the island is collapsed or hidden, in which case it slides back down to show them.
The list is kept in memory only (last 24) and is cleared when the app quits.

The island has to be running for the CLI to find it (otherwise it exits with
`no Dynamic Island API found … is the app running?`), and the flags need the `--`
separator — `npm run notify -t "Hi"` makes npm swallow `-t` and the message.

Windows 11 keeps new tray icons in the overflow flyout; drag the island icon onto the
taskbar if you want it permanently visible.

## Commands

```bash
npm install       # install dependencies
npm run dev       # run in development (HMR for the renderer)
npm run build     # production bundle into ./out
npm run typecheck # type-check main/preload and renderer
npm run smoke     # build + launch with --smoke-test, prints diagnostics and exits
npm run dist      # type-check, build and wrap it into a Windows installer
npm run dist:dir  # build + package into ./release/win-unpacked (no installer)
npm run notify    # post a notification to the running island (see Notifications)
npm run icons     # regenerate tray/app icons in ./resources
```

## Build installer

```bash
npm run dist
```

That writes `release/Dynamic Island KW Setup 0.1.0.exe` (NSIS, x64, ~116 MB).
Run it and the app installs per-user into
`%LOCALAPPDATA%\Programs\Dynamic Island KW` — no admin prompt — with a desktop
shortcut and a Start Menu entry.

- The installer is unsigned, so SmartScreen shows "Windows protected your PC" the
  first time: **More info → Run anyway**. Removing that needs a code signing
  certificate.
- `npm run dist:dir` stops after `release/win-unpacked`, which is the fastest way
  to check a packaging change. Run `release\win-unpacked\Dynamic Island KW.exe`
  and look at the tray icons, the Keys tab (Caps/Num/Scroll) and a real Windows
  notification: those three need the tray PNGs from `extraResources` and the koffi
  native addon from `asarUnpack`, and they stay silent if either is missing.
- Uninstalling keeps `%APPDATA%\Dynamic Island KW` (your settings plus the
  generated PowerShell helper).
- The first build downloads Electron and the NSIS tooling into
  `%LOCALAPPDATA%\electron-builder\Cache`, so give it a few minutes and a network
  connection.

## Layout

```
src/
  main/                 Electron main process
    index.ts            lifecycle, single instance, hotkey, IPC
    services/media.ts   media subscription lifecycle, JSON parser, commands
    services/winrt.ts   shared WinRT helper lifecycle + message dispatch
    services/winrt.ps1  SMTC + UserNotificationListener bridge (PowerShell 5.1)
    services/audio.ts   Core Audio volume/mute + peak meter (koffi COM)
    services/keyboard.ts lock/modifier state + key-down hook (koffi user32)
    services/notifications.ts local HTTP API (POST /notify) + in-memory list
    services/toasts.ts  Windows notification-centre parser + subscription
    services/system.ts  system sampler (os + koffi + systeminformation)
    settings.ts         tiny JSON settings store (no dependency)
    autostart.ts        Windows "run at login" sync
    tray.ts             tray icon + context menu
    windows/island.ts   transparent island BrowserWindow
  preload/index.ts      contextBridge API (window.island)
  renderer/             React UI
  shared/               types + IPC channel names shared by both sides
scripts/gen-icons.mjs   dependency-free PNG icon generator
scripts/notify.mjs      CLI for the local notification API
resources/              generated icons (committed)
```

## Notes

- `sandbox: false` is required for the preload to use Node's `require`; the
  renderer itself still runs with `contextIsolation: true` and
  `nodeIntegration: false`.
- The window has `movable: false` and `resizable: false`; position is derived
  from the display work area plus `topOffset`.
- The window is created at the expanded 468×260 footprint and never moves or
  resizes. `island:set-expanded` only changes the window **shape**
  (`win.setShape`): the full card while open, the 300×46 pill rect while
  collapsed, so clicks around the pill fall through to the desktop. Resizing a
  visible transparent window makes Windows present one stale frame at the new
  origin (the pill jumped ~108 px for a frame and looked like a blink).
- Hiding is a two-part move: `island:hiding` folds the island toward its top edge
  (scale + fade, `transform-origin: center top`) while the main process tweens the
  window up `78` DIP and then hides it; `island:showing` runs the same path
  backwards. The tween uses `setBounds` per frame — `setPosition` on a transparent
  frameless window nudges its reported size by a pixel per call, which grew the
  island by ~16 px over a single slide.
- The pill is a mini dashboard, so it has to open on a click rather than on
  hover — otherwise moving the pointer onto a play button would expand the card
  and move the button out from under the cursor. Hover only animates the face.
  The mini view is rendered *only* while collapsed; the open card has its own
  full panel and a `face · clock · pin · close` header instead of a strip.
- Sampling follows *visibility*, not the card: `island:visibility` is sent on
  show/hide and the sections subscribe while the island is on screen (the mini
  view needs live data). Hiding the island releases everything again, except the
  toast bridge — that one stays up so a notification can wake the island.
- The notification API binds to `127.0.0.1` only, caps bodies at 16 KB, trims
  every field and keeps the last 24 entries in memory. The CLI probes
  `/health` across the port range to find the running instance.
- Windows toast mirroring uses `Windows.UI.Notifications.Management.UserNotificationListener`
  from an unpackaged PowerShell process; the first call to `RequestAccessAsync()`
  is what triggers the Windows consent prompt. The listener returns the same
  entries the notification centre shows, so the bridge polls it (~600 ms) and
  emits only keys it has not seen; the main process filters out anything created
  before the app started so old history does not flood the list. It stays up for
  the app's lifetime — a hidden island still has to be able to pop open — and only
  the renderer unmounting (quit) stops it.
- The face's nod reads the default output's peak level from Core Audio
  (`IAudioMeterInformation::GetPeakValue`) in the main process — one cheap COM call
  per frame — and sends it to the renderer over IPC only while the face is on
  screen. The renderer applies the same floor/ceiling auto-gain and smoothing as
  before and writes the result to a `MotionValue` every sample, so the face
  animates without a React re-render. Nothing is captured or recorded, and no
  desktop-capture graph or audio utility process is involved.
- Hover feedback on the light "primary" buttons never animates `background`: the
  base is a gradient, so a `background` transition fades `background-color` from
  `transparent` and the white circle blinks through the dark pill for the length of
  the transition. They brighten an inset `box-shadow` instead.
- The volume and alert HUDs cover the header edge to edge in both modes (only the
  content is padded to clear the pin/close buttons, which sit at `z-index: 5` on
  top). Insetting the panel itself left a hard seam that made the expanded header
  look lopsided.
- No native `title` tooltips inside the island — Windows renders them as a separate
  always-on-top window that covers the card.
- `systeminformation` is slow on Windows (its `currentLoad`/`networkStats` wait
  ~1.3 s per call), so the 1 s path uses `os` for CPU/RAM and raw `GetIfTable`
  counters through **koffi** for network. Only GPU (5 s), disk/battery/temp (15 s)
  use `systeminformation`. Sampling is paused unless the System tab is visible.
- SMTC and Windows' notification centre have no Node binding, so both run in a
  single background **Windows PowerShell 5.1** process (`-NonInteractive`,
  hidden) and talk JSON-over-stdio with it. The script is inlined into the
  bundle with `?raw` and written to
  `%APPDATA%\Dynamic Island KW\winrt-helper.ps1` at runtime. One process instead
  of one per feature saves a whole CLR + PowerShell baseline (~45 MB); on 64-bit
  Windows the helper is launched from `SysWOW64` (32-bit), which halves its
  private memory again (~33 MB vs ~52 MB) without changing the WinRT APIs.
  Media polling (~750 ms) is gated by `media:on` / `media:off`, so after the
  media panel idles out the process only keeps the toast listener alive.
- Cover art arrives as an `IRandomAccessStreamReference`; the helper converts it
  once per track to a `data:` URL (skipping anything over 4 MB) so the renderer
  never touches the filesystem. The cache keeps only the last four covers, so a
  long listening session cannot grow the helper's heap. PowerShell cannot bind
  WinRT streams to method parameters, so the code hands the stream to
  `WindowsRuntimeStreamExtensions.AsStreamForRead` through reflection.
- `koffi` ships a prebuilt N-API binary; when packaging, its `.node` file must be
  unpacked from the asar archive (Milestone 7).
- COM interfaces have no Node binding either, so the volume watcher calls the
  `IMMDeviceEnumerator` / `IAudioEndpointVolume` vtable slots through `koffi`
  (`koffi.decode` on the vtable, `koffi.proto` for the calling convention). The
  poll is a couple of microseconds, so it runs for the whole app lifetime and
  only sends IPC when the level or mute flag actually changes.
- The ambient colour is computed in the renderer: the artwork data URL is drawn
  onto a 24×24 canvas, near-black/near-white pixels are ignored, and the rest is
  averaged with a saturation weight. The result is written to the `--ambient`
  CSS variable, so nothing about the track leaves the window.
- The Keys section installs a `WH_KEYBOARD_LL` hook (through koffi) while it is
  visible. The callback only increments a counter and reads the virtual key code
  to flip Caps/Num/Scroll; no key code, character or timing is kept once the
  frame has been sent, and the hook is removed as soon as the section closes.
  The lock state starts from `GetKeyState` and is then maintained from the hook,
  because the thread-local toggle bits can go stale in a background app.
- The mini views share the panel subscriptions (`useMedia`, `useSystemStats`,
  `useKeyboard`, `useNotifications` are owned by the island), so nothing is
  sampled twice. The media side of the shared helper subscribes whenever the
  island is *visible* (the face reacts to the song on every tab) and idles out
  30 s after the island is hidden; System and Keys still subscribe only while
  their own section is up.
- **Memory:** the WinRT work is one 32-bit PowerShell process (~31 MB instead of
  two 64-bit processes at ~97 MB), and `systeminformation` only loads when the
  System tab is opened (saving a few MB in the main process otherwise). The dancing
  face reads Core Audio's peak meter, so a song adds no capture buffers and no
  audio utility process. What remains is Chromium's process baseline: ~50 MB for
  the renderer and ~55–80 MB for the GPU process (hardware-accelerated compositing,
  which keeps the animation smooth); the renderer's own JS heap is only ~7 MB.
  Measured on the dev machine: ~158 MB total with no media, ~200 MB while a song
  is on the mini bar.
- CPU temperature needs admin rights or an OHM-compatible sensor; when
  `systeminformation` returns `null` the UI shows thread count instead.
- The Settings section edits the same `settings.json` the tray writes; the theme
  is applied by setting `data-theme` on `<html>`, so one attribute repaints the
  whole island (including the light smiley ink) without a reload. The card was
  widened to 468 px for exactly that reason: a peeking notification wraps its
  title and message rather than ending in an ellipsis.
- If `npm install` finishes without `node_modules/electron/dist`, download the
  runtime manually: `node node_modules/electron/install.js`.