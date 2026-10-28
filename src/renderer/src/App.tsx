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

  return (
    <div className="island-root">
      <Island settings={settings} info={info} />
    </div>
  )
}