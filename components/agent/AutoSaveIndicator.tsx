'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, AlertCircle } from 'lucide-react'
import type { AutoSaveStatus } from '@/lib/hooks/useAutoSave'

function formatAgo(date: Date, now: number): string {
  const diffSec = Math.max(0, Math.round((now - date.getTime()) / 1000))
  if (diffSec < 5)   return 'à l’instant'
  if (diffSec < 60)  return `il y a ${diffSec} s`
  const min = Math.floor(diffSec / 60)
  if (min < 60)      return `il y a ${min} min`
  const h = Math.floor(min / 60)
  return `il y a ${h} h`
}

interface AutoSaveIndicatorProps {
  status: AutoSaveStatus
  lastSavedAt: Date | null
  error?: string | null
}

export default function AutoSaveIndicator({ status, lastSavedAt, error }: AutoSaveIndicatorProps) {
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    if (status !== 'saved' || !lastSavedAt) return
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [status, lastSavedAt])

  if (status === 'idle' && !lastSavedAt) return null

  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
        <Loader2 size={12} className="animate-spin" />
        Sauvegarde…
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11px] text-red-600"
        title={error ?? undefined}
      >
        <AlertCircle size={12} />
        Erreur de sauvegarde
      </span>
    )
  }

  if (lastSavedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
        <Check size={12} className="text-emerald-600" />
        Sauvegardé {formatAgo(lastSavedAt, now)}
      </span>
    )
  }

  return null
}
