import { useConnection } from '../store/connection.js'

export function HostLine() {
  const line = useConnection(s => s.hostLine)
  if (!line) return null
  return (
    <p style={{ color: 'var(--shell-muted)', fontStyle: 'italic', textAlign: 'center' }}>
      {line}
    </p>
  )
}
