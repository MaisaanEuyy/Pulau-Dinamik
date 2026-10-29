import { Moon, Sun } from 'lucide-react'
import type { Settings, ThemeMode } from '@shared/settings'

const THEMES: { value: ThemeMode; label: string; icon: typeof Moon }[] = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun }
]

/** "Control+Alt+Space" → "Ctrl + Alt + Space" */
function readableHotkey(accelerator: string | undefined): string {
  if (!accelerator) return '—'
  return accelerator
    .replace(/CommandOrControl|Control/gi, 'Ctrl')
    .replace(/\+/g, ' + ')
}

export function SettingsPanel({
  settings,
  patch
}: {
  settings: Settings | null
  patch: (patch: Partial<Settings>) => void
}) {
  const theme = settings?.theme ?? 'dark'
  const launchAtLogin = settings?.launchAtLogin ?? false

  return (
    <div className="settings-panel">
      <div className="settings-row">
        <span className="settings-text">
          <span className="settings-label">Appearance</span>
          <span className="settings-hint">Colour scheme of the island</span>
        </span>
        <div className="theme-switch" role="group" aria-label="Appearance">
          {THEMES.map((entry) => {
            const Icon = entry.icon
            const active = theme === entry.value
            return (
              <button
                key={entry.value}
                type="button"
                className="theme-option"
                data-active={active}
                aria-pressed={active}
                onClick={() => patch({ theme: entry.value })}
              >
                <Icon size={11} strokeWidth={2} />
                {entry.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="settings-row">
        <span className="settings-text">
          <span className="settings-label">Start with Windows</span>
          <span className="settings-hint">Open the island after you sign in</span>
        </span>
        <button
          type="button"
          className="settings-toggle"
          role="switch"
          aria-checked={launchAtLogin}
          aria-label="Start with Windows"
          data-on={launchAtLogin}
          onClick={() => patch({ launchAtLogin: !launchAtLogin })}
        />
      </div>

      <div className="settings-row">
        <span className="settings-text">
          <span className="settings-label">Toggle hotkey</span>
          <span className="settings-hint">Shows or hides the island from anywhere</span>
        </span>
        <span className="settings-hotkey">{readableHotkey(settings?.hotkey)}</span>
      </div>

      <span className="settings-foot">Display selection and notification access live in the tray menu.</span>
    </div>
  )
}