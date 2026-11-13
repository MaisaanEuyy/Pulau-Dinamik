# Dynamic Island KW

MacBook-style **Dynamic Island** for Windows 11.

A small always-on-top pill at the top of the screen that shows what is playing, your system stats, your Caps Lock state and your Windows notifications — with a little white smiley that dances to the music. Click it to open the full card.

Built with Electron + React + TypeScript.

## Download

1. Go to the [**Releases**](https://github.com/MaisaanEuyy/Pulau-Dinamik/releases) page.
2. Download the latest **`Dynamic Island KW Setup x.y.z.exe`**.
3. Run it. It installs for the current user only — no admin rights needed.

> Windows SmartScreen may show "Windows protected your PC" because the installer is not code-signed. Click **More info → Run anyway**.

Requires **Windows 11** (64-bit).

## How to use

The island sits centred at the top of your screen. Closing it does not quit the app — it lives in the tray.

### The pill (collapsed)

Shows a live mini view of the section you are on: the current song with play/pause and skip buttons, CPU/RAM/GPU, the Caps/Num/Scroll state, or your latest notification.

### The card (expanded)

**Click the pill** to open the card. Click the header again to pin it open. `Esc` or the × closes it, and an unpinned card closes when your pointer leaves.

| Section | What it shows |
| --- | --- |
| **Media** | Track, artist, cover art and working previous / play-pause / next buttons for whatever Windows is playing |
| **System** | Live CPU / GPU / RAM cards with sparklines, plus network, disk space and battery |
| **Keys** | Caps / Num / Scroll, the modifiers you are holding and a typing speed meter |
| **Alerts** | Your Windows notifications, mirrored as they arrive |
| **Modules** | One switch per feature, plus **Audio only** and **Everything on** presets |
| **Settings** | Light/dark theme, start with Windows, playful smiley, low memory mode, hotkey |

### Controls

- **`Ctrl+Alt+Space`** — show or hide the island.
- **`←` / `→`** — switch sections.
- **Right-click the tray icon** — display selection, Modules submenu, start with Windows, quit.
- **Poke the smiley** — it reacts. It also yawns and falls asleep when left alone, and looks glum when the battery is low.

## Features

- **Now playing** — reads the Windows media session, so it works with Spotify, Chrome, Edge, Media Player and anything else that shows up in the Windows media controls.
- **Dancing face** — the smiley nods and sways to the actual audio levels of your default output. Nothing is recorded and no capture stream is opened.
- **Real notifications** — mirrors the toasts Windows already shows (WhatsApp, Chrome, Outlook, Telegram, Discord …) and pops the card open when one arrives.
- **System monitor** — CPU, GPU, RAM, network, disk and battery, sampled only while the System section is open.
- **Module switches** — turn features off and their timers, hooks and helper process really stop.
- **Low memory mode** — trades smoothness for a much smaller GPU footprint. Takes effect after a restart.
- **Tray resident** — starts with Windows, hides instead of quitting, single instance.

### Local notification API (optional)

The app also accepts your own notifications on `http://127.0.0.1:43110` (loopback only):

```bash
curl -X POST http://127.0.0.1:43110/notify \
  -H "Content-Type: application/json" \
  -d '{"title":"Build finished","message":"42 tests passed","level":"success"}'
```

`level` is one of `info`, `success`, `warning`, `error`. `GET /health` reports whether the island is running.

## Build from source

```bash
npm install
npm run dev       # development
npm run build     # production bundle into ./out
npm run dist      # type-check, build and produce the Windows installer
```

The installer is written to `release/Dynamic Island KW Setup x.y.z.exe`. `npm run typecheck` and `npm run smoke` check the app without packaging it.

## Privacy

Everything stays on your machine. Notifications, track titles and artwork are kept in memory only, nothing is sent anywhere, and the local API listens on loopback only.

## License

MIT
