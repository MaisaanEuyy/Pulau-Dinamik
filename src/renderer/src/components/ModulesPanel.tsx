import { Activity, AudioWaveform, Bell, Gamepad2, Headphones, Keyboard, RotateCcw } from 'lucide-react'
import {
  ALL_FEATURES,
  AUDIO_ONLY_FEATURES,
  DEFAULT_FEATURES,
  FEATURE_KEYS,
  FEATURE_META,
  allFeaturesOn,
  isAudioOnly,
  type FeatureKey
} from '@shared/features'
import type { Settings } from '@shared/settings'

const ICONS: Record<FeatureKey, typeof Activity> = {
  system: Activity,
  keyboard: Keyboard,
  notifications: Bell,
  beat: AudioWaveform
}

/**
 * Module switches. Turning one off does not merely hide its section: the main
 * process stops the sampler, the hook or the bridge behind it, so the island
 * really does get lighter.
 */
export function ModulesPanel({
  settings,
  patch
}: {
  settings: Settings | null
  patch: (patch: Partial<Settings>) => void
}) {
  const features = settings?.features ?? DEFAULT_FEATURES
  const discordPresence = settings?.discordPresence ?? true

  const audioOnly = isAudioOnly(features, discordPresence)
  const everything = allFeaturesOn(features, discordPresence)

  const setFeature = (key: FeatureKey, value: boolean): void => {
    patch({ features: { ...features, [key]: value } })
  }

  return (
    <div className="modules-panel">
      {FEATURE_KEYS.map((key) => {
        const Icon = ICONS[key]
        return (
          <div
            className="settings-row module-row"
            data-on={features[key]}
            data-feature={key}
            key={key}
          >
            <span className="module-icon" aria-hidden="true">
              <Icon size={11} strokeWidth={2} />
            </span>
            <span className="settings-text">
              <span className="settings-label">{FEATURE_META[key].label}</span>
              <span className="settings-hint">{FEATURE_META[key].hint}</span>
            </span>
            <button
              type="button"
              className="settings-toggle"
              role="switch"
              aria-checked={features[key]}
              aria-label={FEATURE_META[key].label}
              data-on={features[key]}
              onClick={() => setFeature(key, !features[key])}
            />
          </div>
        )
      })}

      <div className="settings-row module-row" data-on={discordPresence} data-feature="discord">
        <span className="module-icon" aria-hidden="true">
          <Gamepad2 size={11} strokeWidth={2} />
        </span>
        <span className="settings-text">
          <span className="settings-label">Discord activity</span>
          <span className="settings-hint">Show the current track on your profile</span>
        </span>
        <button
          type="button"
          className="settings-toggle"
          role="switch"
          aria-checked={discordPresence}
          aria-label="Discord activity"
          data-on={discordPresence}
          onClick={() => patch({ discordPresence: !discordPresence })}
        />
      </div>

      <div className="modules-presets">
        <button
          type="button"
          className="modules-preset"
          data-active={audioOnly}
          aria-pressed={audioOnly}
          onClick={() => patch({ features: { ...AUDIO_ONLY_FEATURES }, discordPresence: false })}
        >
          <Headphones size={11} strokeWidth={2} />
          Audio only
        </button>
        <button
          type="button"
          className="modules-preset"
          data-active={everything}
          aria-pressed={everything}
          onClick={() => patch({ features: { ...ALL_FEATURES }, discordPresence: true })}
        >
          <RotateCcw size={11} strokeWidth={2} />
          Everything on
        </button>
      </div>
    </div>
  )
}
