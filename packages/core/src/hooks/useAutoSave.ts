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
  const inFlightRef = useRef<boolean>(false)
  const onSaveRef = useRef(onSave)
  const debounceMsRef = useRef(debounceMs)
  // flushRef lets the scheduled timer self-reference the latest flush
  // without TDZ issues — initialised right after flush is declared.
  const flushRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => { onSaveRef.current = onSave }, [onSave])
  useEffect(() => { debounceMsRef.current = debounceMs }, [debounceMs])

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void flushRef.current()
    }, debounceMsRef.current)
  }, [])

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    // Single in-flight save at a time — the post-save check picks up any
    // edits that happened while the previous save was running.
    if (inFlightRef.current) return

    const dataToSave = lastDataRef.current
    const snapshot = stableStringify(dataToSave)
    if (snapshot === lastSavedSnapshot.current) {
      setIsDirty(false)
      return
    }

    inFlightRef.current = true
    setStatus('saving')
    setError(null)
    try {
      await onSaveRef.current(dataToSave)
      lastSavedSnapshot.current = snapshot
      inFlightRef.current = false
      // Did the agent edit something while the PATCH was in flight?
      const latestSnapshot = stableStringify(lastDataRef.current)
      const stillDirty = latestSnapshot !== snapshot
      setIsDirty(stillDirty)
      setStatus('saved')
      if (stillDirty) scheduleFlush()
    } catch (e) {
      inFlightRef.current = false
      const message = e instanceof Error ? e.message : 'Erreur inconnue'
      setError(message)
      setStatus('error')
    }
  }, [scheduleFlush])

  useEffect(() => { flushRef.current = flush }, [flush])

  const saveNow = useCallback(async () => {
    if (!enabled) return
    // Yield one tick so React-flushed state updates land in lastDataRef
    // before we serialise — callers can `setState(...); saveNow()` safely.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await flush()
  }, [enabled, flush])

  useEffect(() => {
    lastDataRef.current = data
    if (!enabled) return

    const snapshot = stableStringify(data)
    if (snapshot === lastSavedSnapshot.current) {
      // Don't reset dirty while a save is mid-flight — the post-save
      // check owns the dirty flag in that window.
      if (!inFlightRef.current) setIsDirty(false)
      return
    }
    setIsDirty(true)
    scheduleFlush()
  }, [data, enabled, scheduleFlush])

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  return { status, isDirty, error, saveNow }
}
