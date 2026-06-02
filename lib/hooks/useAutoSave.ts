'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface UseAutoSaveOptions<T> {
  data: T
  onSave: (data: T) => Promise<void>
  debounceMs?: number
  enabled?: boolean
}

interface UseAutoSaveResult {
  status: AutoSaveStatus
  isDirty: boolean
  error: string | null
  saveNow: () => Promise<void>
}

// Stable JSON for cheap equality. Sufficient for plain Property-like objects;
// callers must not include File objects or other non-serialisable values.
const stableStringify = (v: unknown): string => {
  return JSON.stringify(v, (_, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k]
          return acc
        }, {})
    }
    return val
  })
}

export function useAutoSave<T>({
  data,
  onSave,
  debounceMs = 3000,
  enabled = true,
}: UseAutoSaveOptions<T>): UseAutoSaveResult {
  const [status, setStatus] = useState<AutoSaveStatus>('idle')
  const [isDirty, setIsDirty] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedSnapshot = useRef<string>(stableStringify(data))
  const lastDataRef = useRef<T>(data)
  const onSaveRef = useRef(onSave)

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const flush = useCallback(async () => {
    const snapshot = stableStringify(lastDataRef.current)
    if (snapshot === lastSavedSnapshot.current) {
      // Nothing changed since the last successful save.
      return
    }
    setStatus('saving')
    setError(null)
    try {
      await onSaveRef.current(lastDataRef.current)
      lastSavedSnapshot.current = snapshot
      setIsDirty(false)
      setStatus('saved')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erreur inconnue'
      setError(message)
      setStatus('error')
    }
  }, [])

  const saveNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!enabled) return
    // Yield one tick so React-flushed state updates land in lastDataRef before
    // we serialise — callers can `setState(...); saveNow()` safely.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await flush()
  }, [enabled, flush])

  useEffect(() => {
    lastDataRef.current = data
    if (!enabled) return

    const snapshot = stableStringify(data)
    if (snapshot === lastSavedSnapshot.current) {
      setIsDirty(false)
      return
    }
    setIsDirty(true)

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void flush()
    }, debounceMs)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [data, debounceMs, enabled, flush])

  return { status, isDirty, error, saveNow }
}
