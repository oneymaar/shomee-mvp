'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, RefreshCw } from 'lucide-react'
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
  onRetry: () => void
}

/**
 * Full-width slot that replaces the "Sauvegarder" button on the editor bottom
 * bar. Morphs between idle / saving / saved / error and exposes a retry
 * affordance when a save has failed.
 */
export default function AutoSaveIndicator({
  status,
  lastSavedAt,
  error,
  onRetry,
}: AutoSaveIndicatorProps) {
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    if (status !== 'saved' || !lastSavedAt) return
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [status, lastSavedAt])

  if (status === 'saving') {
    return (
      <div className="w-full py-3 rounded-xl border border-gray-200 flex items-center justify-center gap-2 text-gray-500 text-[13px]">
        <Loader2 size={14} className="animate-spin" />
        Sauvegarde…
      </div>
    )
  }

  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={error ?? undefined}
        className="w-full py-3 rounded-xl border border-red-300 text-red-600 font-semibold text-[14px] flex items-center justify-center gap-2 active:bg-red-50"
      >
        <RefreshCw size={14} />
        Réessayer
      </button>
    )
  }

  if (status === 'saved' && lastSavedAt) {
    return (
      <div className="w-full py-3 rounded-xl border border-gray-200 flex items-center justify-center gap-2 text-gray-500 text-[13px]">
        <Check size={14} className="text-emerald-600" />
        Sauvegardé {formatAgo(lastSavedAt, now)}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onRetry}
      className="w-full py-3 rounded-xl border border-[#0a0a0a] text-[#0a0a0a] font-semibold text-[14px] active:bg-[#0a0a0a]/[0.03]"
    >
      Sauvegarder
    </button>
  )
}
