'use client'

import { Check, Loader2, RefreshCw } from 'lucide-react'
import type { AutoSaveStatus } from '@shomee/core/hooks/useAutoSave'

interface AutoSaveIndicatorProps {
  status: AutoSaveStatus
  isDirty: boolean
  error?: string | null
  onRetry: () => void
}

/**
 * Bottom-bar slot for the editor. The Sauvegarder CTA stays clickable as
 * long as there are unsaved changes, even between debounce ticks, so the
 * agent can force a flush at any time.
 */
export default function AutoSaveIndicator({
  status,
  isDirty,
  error,
  onRetry,
}: AutoSaveIndicatorProps) {
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

  if (status === 'saved' && !isDirty) {
    return (
      <div className="w-full py-3 rounded-xl border border-gray-200 flex items-center justify-center gap-2 text-gray-500 text-[13px]">
        <Check size={14} className="text-emerald-600" />
        Sauvegardé
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
