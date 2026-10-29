import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/api'
import type { Settings } from '@shared/settings'
import { Island } from './components/Island'

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let alive = true

    void (async () => {
      const [nextSettings, nextInfo] = await Promise.all([
        window.island.getSettings(),
        window.island.getAppInfo()
      ])
      if (!alive) return
      setSettings(nextSettings)
      setInfo(nextInfo)
      window.island.reportReady()
    })()

    const unsubscribe = window.island.onSettingsChanged(setSettings)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  // The whole stylesheet keys off this attribute, so switching the setting
  // repaints the island without a reload.
  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? 'dark'
  }, [settings?.theme])

  return (
    <div className="island-root">
      <Island settings={settings} info={info} />
    </div>
  )
}