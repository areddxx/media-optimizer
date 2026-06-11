import { useEffect, useState } from 'react'

const KEY_PREFIX = 'image-optimizer:'

export function usePersistedState(key, initial) {
  const [val, setVal] = useState(() => {
    if (typeof window === 'undefined') return initial
    try {
      const raw = localStorage.getItem(KEY_PREFIX + key)
      return raw == null ? initial : JSON.parse(raw)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try { localStorage.setItem(KEY_PREFIX + key, JSON.stringify(val)) } catch {}
  }, [key, val])
  return [val, setVal]
}
