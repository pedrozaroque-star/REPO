
import { useState, useEffect } from 'react'

export function useSystemUpdate(checkIntervalMs = 60000) {
    const [hasUpdate, setHasUpdate] = useState(false)
    const [updateMessage, setUpdateMessage] = useState('')
    const [currentVersion, setCurrentVersion] = useState<string | null>(null)

    useEffect(() => {
        let isMounted = true

        const checkVersion = async () => {
            try {
                // Add timestamp to prevent caching
                const res = await fetch(`/api/system/version?t=${Date.now()}`)
                if (!res.ok) return

                const data = await res.json()
                const remoteVersion = data.version

                if (isMounted) {
                    if (!currentVersion) {
                        // First load: Set baseline
                        setCurrentVersion(remoteVersion)
                    } else if (remoteVersion !== currentVersion) {
                        // Subsequent load: Detected change
                        // Ignore if both are 'dev' (local dev mode usually returns stable 'dev')
                        if (currentVersion !== 'dev' || remoteVersion !== 'dev') {
                            setHasUpdate(true)
                            setUpdateMessage(data.message || 'Mejoras y correcciones')
                        }
                    }
                }
            } catch (e) {
                console.error('Failed to check system version', e)
            }
        }

        // Initial check immediately? No, we set baseline on first load logic above.
        // Actually, we need to fetch immediately to set currentVersion.
        checkVersion()

        // Polling
        const intervalId = setInterval(checkVersion, checkIntervalMs)

        // Visibility Change (User comes back to tab)
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                checkVersion()
            }
        }
        document.addEventListener('visibilitychange', onVisibilityChange)

        return () => {
            isMounted = false
            clearInterval(intervalId)
            document.removeEventListener('visibilitychange', onVisibilityChange)
        }
    }, [currentVersion, checkIntervalMs])

    return { hasUpdate, updateMessage, triggerUpdate: () => window.location.reload() }
}
