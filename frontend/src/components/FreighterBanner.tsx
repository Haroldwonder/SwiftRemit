import { FC, useEffect, useState } from 'react'

const FREIGHTER_INSTALL_URL = 'https://www.freighter.app/'

function isFreighterAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.freighter !== 'undefined'
}

/**
 * Shows a banner when the Freighter wallet extension is not installed.
 * Moved from the unused frontend/src/main.ts entry point.
 */
const FreighterBanner: FC = () => {
  const [available, setAvailable] = useState(true)

  useEffect(() => {
    setAvailable(isFreighterAvailable())
  }, [])

  if (available) return null

  return (
    <div
      id="freighter-banner"
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        padding: 12,
        background: '#f59e0b',
        color: '#000',
        textAlign: 'center',
        zIndex: 9999,
        fontFamily: 'sans-serif',
      }}
    >
      Freighter wallet extension is not installed.{' '}
      <a
        href={FREIGHTER_INSTALL_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontWeight: 'bold', textDecoration: 'underline' }}
      >
        Install Freighter
      </a>{' '}
      to use this application.
    </div>
  )
}

export default FreighterBanner
